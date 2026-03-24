import path from 'node:path';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { parseJsonlFile } from './jsonl-parser.js';
import { decideCheckpointAction, buildCheckpoint, computeFileIdentity } from './checkpoint.js';
import { discoverSessions, type DiscoveredSession } from './session-discovery.js';
import { slugToPath } from './session-discovery.js';
import * as queries from '../db/queries.js';
import type { Checkpoint } from '../shared/types.js';

const log = createLogger('indexer');

/**
 * Index a single JSONL file into the database.
 * Handles both initial indexing and incremental updates.
 */
export function indexSession(db: Database.Database, jsonlPath: string, projectSlug: string): boolean {
  const externalId = path.basename(jsonlPath, '.jsonl');

  // Check if we already have this session
  const existingSession = queries.findSessionByJsonlPath(db, jsonlPath);
  const storedCheckpoint: Checkpoint | null = existingSession
    ? {
        byteOffset: existingSession.jsonlByteOffset,
        fileSize: existingSession.jsonlSize,
        identity: existingSession.jsonlIdentity,
      }
    : null;

  // Decide what to do based on checkpoint
  const decision = decideCheckpointAction(jsonlPath, storedCheckpoint);

  switch (decision.action) {
    case 'skip':
      return false;

    case 'deleted': {
      if (existingSession) {
        queries.updateSessionMeta(db, existingSession.id, { state: 'deleted', updatedAt: Date.now() });
        log.info('Session marked as deleted', { externalId, path: jsonlPath });
      }
      return true;
    }

    case 'full': {
      // Full reparse — delete existing messages if any
      if (existingSession) {
        queries.deleteSessionMessages(db, existingSession.id);
      }
      return doIndex(db, jsonlPath, projectSlug, externalId, 0, existingSession?.id ?? null);
    }

    case 'incremental': {
      return doIndex(db, jsonlPath, projectSlug, externalId, decision.fromByte, existingSession?.id ?? null);
    }
  }
}

function doIndex(
  db: Database.Database,
  jsonlPath: string,
  projectSlug: string,
  externalId: string,
  fromByte: number,
  existingSessionId: number | null,
): boolean {
  const result = parseJsonlFile(jsonlPath, fromByte);

  if (result.messages.length === 0 && !result.sessionId) {
    // Nothing to index
    return false;
  }

  const now = Date.now();

  // Use session_id from JSONL if discovered, otherwise use filename
  const effectiveExternalId = result.sessionId ?? externalId;

  // Upsert session
  const projectPath = slugToPath(projectSlug);
  const sessionId = existingSessionId ?? queries.upsertSession(db, {
    provider: 'claude',
    externalId: effectiveExternalId,
    projectSlug,
    projectPath,
    jsonlPath,
    createdAt: result.messages[0]?.timestamp ?? now,
    updatedAt: now,
  });

  if (result.messages.length > 0) {
    // Compute sequence numbers based on existing message count + line position
    const existingCount = existingSessionId ? queries.getMessageCount(db, sessionId) : 0;

    const messagesWithSequence = result.messages.map((msg, i) => ({
      role: msg.role,
      content: msg.content,
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      timestamp: msg.timestamp,
      sequence: existingCount + i + 1,
      blockType: msg.blockType,
    }));

    queries.insertMessages(db, sessionId, messagesWithSequence);

    // Update session metadata
    const firstUserMessage = result.messages.find(m => m.role === 'user');
    const totalMessages = queries.getMessageCount(db, sessionId);

    queries.updateSessionMeta(db, sessionId, {
      messageCount: totalMessages,
      updatedAt: now,
      ...(firstUserMessage && !existingSessionId ? { firstPrompt: firstUserMessage.content.substring(0, 500) } : {}),
    });
  }

  // Update checkpoint
  const identity = computeFileIdentity(jsonlPath);
  const checkpoint = buildCheckpoint(result.lastByteOffset, result.lastByteOffset, identity);
  queries.updateSessionCheckpoint(db, sessionId, checkpoint);

  log.info('Indexed session', {
    externalId: effectiveExternalId,
    messages: result.messages.length,
    fromByte,
    toByte: result.lastByteOffset,
    linesProcessed: result.linesProcessed,
    linesFailed: result.linesFailed,
  });

  return true;
}

/**
 * Perform a full scan and index of all discovered sessions.
 * Returns the count of sessions indexed/updated.
 */
export function fullScan(db: Database.Database, projectsDir?: string): { indexed: number; total: number } {
  const discovered = discoverSessions(projectsDir);
  let indexed = 0;

  for (const session of discovered) {
    try {
      const changed = indexSession(db, session.jsonlPath, session.projectSlug);
      if (changed) indexed++;
    } catch (err) {
      log.error('Failed to index session', {
        path: session.jsonlPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Check for sessions in DB that no longer exist on disk
  const dbPaths = queries.getAllSessionJsonlPaths(db);
  const diskPaths = new Set(discovered.map(s => s.jsonlPath));
  for (const dbPath of dbPaths) {
    if (!diskPaths.has(dbPath)) {
      const session = queries.findSessionByJsonlPath(db, dbPath);
      if (session && session.state === 'active') {
        queries.updateSessionMeta(db, session.id, { state: 'deleted', updatedAt: Date.now() });
        log.info('Session marked as deleted (file missing)', { path: dbPath });
        indexed++;
      }
    }
  }

  return { indexed, total: discovered.length };
}

/**
 * Full reindex — delete all data and re-scan everything.
 */
export function fullReindex(db: Database.Database, projectsDir?: string): { indexed: number; total: number } {
  log.info('Starting full reindex — clearing all data');
  queries.deleteAllData(db);
  return fullScan(db, projectsDir);
}
