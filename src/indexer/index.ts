import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { parseJsonlFile, getFileSize } from './jsonl-parser.js';
import { decideCheckpointAction, buildCheckpoint, computeFileIdentity } from './checkpoint.js';
import { discoverSessions } from './session-discovery.js';
import * as queries from '../db/queries.js';
import type { Checkpoint } from '../shared/types.js';

const log = createLogger('indexer');

export type IndexEvent = 'created' | 'updated' | 'deleted' | 'unchanged';

/**
 * Index a single JSONL file into the database.
 * Handles both initial indexing and incremental updates.
 * Returns the type of change that occurred.
 */
export function indexSession(db: Database.Database, jsonlPath: string, projectSlug: string): IndexEvent {
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

  const isNew = !existingSession;

  // Decide what to do based on checkpoint
  const decision = decideCheckpointAction(jsonlPath, storedCheckpoint);

  switch (decision.action) {
    case 'skip':
      return 'unchanged';

    case 'deleted': {
      if (existingSession) {
        queries.updateSessionMeta(db, existingSession.id, { state: 'deleted', updatedAt: Date.now() });
        log.info('Session marked as deleted', { externalId, path: jsonlPath });
      }
      return 'deleted';
    }

    case 'full': {
      // Full reparse: parse FIRST, then replace in a single transaction
      const result = parseJsonlFile(jsonlPath, 0);
      if (result.messages.length === 0 && !result.sessionId) {
        return 'unchanged';
      }
      const actualFileSize = getFileSize(jsonlPath);

      const runTransaction = db.transaction(() => {
        // Delete old messages only after successful parse
        if (existingSession) {
          queries.deleteSessionMessages(db, existingSession.id);
        }
        return doIndex(db, jsonlPath, projectSlug, externalId, result, actualFileSize, existingSession?.id ?? null);
      });

      runTransaction();
      return isNew ? 'created' : 'updated';
    }

    case 'incremental': {
      const result = parseJsonlFile(jsonlPath, decision.fromByte);
      if (result.messages.length === 0 && !result.sessionId) {
        return 'unchanged';
      }
      const actualFileSize = getFileSize(jsonlPath);

      const runTransaction = db.transaction(() => {
        doIndex(db, jsonlPath, projectSlug, externalId, result, actualFileSize, existingSession?.id ?? null);
      });

      runTransaction();
      return isNew ? 'created' : 'updated';
    }
  }
}

function doIndex(
  db: Database.Database,
  jsonlPath: string,
  projectSlug: string,
  externalId: string,
  result: ReturnType<typeof parseJsonlFile>,
  actualFileSize: number,
  existingSessionId: number | null,
): void {
  const now = Date.now();

  // Use session_id from JSONL if discovered, otherwise use filename
  const effectiveExternalId = result.sessionId ?? externalId;

  // Upsert session — store null for projectPath (lossy slug heuristic is unreliable)
  const sessionId = existingSessionId ?? queries.upsertSession(db, {
    provider: 'claude',
    externalId: effectiveExternalId,
    projectSlug,
    projectPath: null,
    jsonlPath,
    createdAt: result.messages[0]?.timestamp ?? now,
    updatedAt: now,
  });

  if (result.messages.length > 0) {
    // Use source line numbers as sequence keys for stable idempotent identity
    const messagesWithSequence = result.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      timestamp: msg.timestamp,
      sequence: msg.lineNumber, // Stable: derived from JSONL line position
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

  // Update checkpoint — store actual file size separately from parsed byte offset
  const identity = computeFileIdentity(jsonlPath);
  const checkpoint = buildCheckpoint(result.lastByteOffset, actualFileSize, identity);
  queries.updateSessionCheckpoint(db, sessionId, checkpoint);

  log.info('Indexed session', {
    externalId: effectiveExternalId,
    messages: result.messages.length,
    toByte: result.lastByteOffset,
    fileSize: actualFileSize,
    linesProcessed: result.linesProcessed,
    linesFailed: result.linesFailed,
  });
}

/**
 * Perform a full scan and index of all discovered sessions.
 */
export function fullScan(db: Database.Database, projectsDir?: string): { indexed: number; total: number } {
  const discovered = discoverSessions(projectsDir);
  let indexed = 0;

  for (const session of discovered) {
    try {
      const event = indexSession(db, session.jsonlPath, session.projectSlug);
      if (event !== 'unchanged') indexed++;
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
