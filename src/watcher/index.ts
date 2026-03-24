import path from 'node:path';
import fs from 'node:fs';
import watcher from '@parcel/watcher';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { getClaudeProjectsDir } from '../platform/paths.js';
import { ChangeDebouncer } from './debounce.js';
import { isClaudeJsonlFile, parseJsonlPath } from './claude-paths.js';
import { indexSession } from '../indexer/index.js';

const log = createLogger('watcher');

export type WatcherEventCallback = (event: {
  type: 'session.created' | 'session.updated' | 'session.deleted';
  projectSlug: string;
  sessionFile: string;
  jsonlPath: string;
}) => void;

let subscription: watcher.AsyncSubscription | null = null;

/**
 * Start watching the Claude projects directory for JSONL changes.
 */
export async function startWatcher(
  db: Database.Database,
  onEvent?: WatcherEventCallback,
  projectsDir?: string,
): Promise<void> {
  const dir = projectsDir ?? getClaudeProjectsDir();

  if (!fs.existsSync(dir)) {
    log.warn('Claude projects directory does not exist, creating', { path: dir });
    fs.mkdirSync(dir, { recursive: true });
  }

  const debouncer = new ChangeDebouncer((paths) => {
    for (const filePath of paths) {
      const parsed = parseJsonlPath(filePath, dir);
      if (!parsed) continue;

      try {
        const changed = indexSession(db, filePath, parsed.projectSlug);
        if (changed && onEvent) {
          // Determine event type based on whether file exists
          const exists = fs.existsSync(filePath);
          onEvent({
            type: exists ? 'session.updated' : 'session.deleted',
            projectSlug: parsed.projectSlug,
            sessionFile: parsed.sessionFile,
            jsonlPath: filePath,
          });
        }
      } catch (err) {
        log.error('Failed to process file change', {
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, 200);

  subscription = await watcher.subscribe(dir, (err, events) => {
    if (err) {
      log.error('Watcher error', { error: err.message });
      return;
    }

    for (const event of events) {
      // Only process JSONL files
      if (!event.path.endsWith('.jsonl')) continue;
      if (!isClaudeJsonlFile(event.path, dir)) continue;

      debouncer.add(event.path);
    }
  });

  log.info('Watcher started', { path: dir });
}

/**
 * Stop the file watcher.
 */
export async function stopWatcher(): Promise<void> {
  if (subscription) {
    await subscription.unsubscribe();
    subscription = null;
    log.info('Watcher stopped');
  }
}
