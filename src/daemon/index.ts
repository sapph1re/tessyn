#!/usr/bin/env node

import { createLogger, setLogLevel } from '../shared/logger.js';
import { installSignalHandlers, onShutdown } from '../platform/signals.js';
import { acquireLock, setState, setIndexProgress } from './lifecycle.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { fullScan } from '../indexer/index.js';
import { startWatcher, stopWatcher } from '../watcher/index.js';
import { startIpcServer, stopIpcServer } from './ipc-server.js';
import { startWsServer, stopWsServer, broadcastNotification } from './ws-server.js';
import { sessionCreated, sessionUpdated, sessionDeleted, indexStateChanged } from '../protocol/events.js';
import { generateMissingTitles } from '../assist/titles.js';

const log = createLogger('daemon');

export async function startDaemon(): Promise<void> {
  // Configure log level from env
  const logLevel = process.env['TESSYN_LOG_LEVEL'];
  if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
    setLogLevel(logLevel);
  }

  log.info('Starting Tessyn daemon');

  // Acquire single-instance lock
  await acquireLock();

  // Register shutdown handlers (LIFO order — last registered = first called)
  installSignalHandlers();

  // Initialize database
  const db = initDatabase();
  onShutdown(() => closeDatabase());

  // Build handler context (shared by IPC and WebSocket servers)
  const ctx = { db };

  // Start servers
  await startIpcServer(ctx);
  onShutdown(() => stopIpcServer());

  await startWsServer(ctx);
  onShutdown(() => stopWsServer());

  // Daemon is now serving (in cold state)
  setState('scanning');
  broadcastNotification(indexStateChanged('scanning', 0, 0));

  // Perform initial scan
  const { indexed, total } = fullScan(db);
  setIndexProgress(total, total);
  setState('caught_up');
  broadcastNotification(indexStateChanged('caught_up', total, total));
  log.info('Initial scan complete', { indexed, total });

  // Generate titles for sessions that don't have them (background, non-blocking)
  generateMissingTitles(db).catch((err) => {
    log.warn('Title generation failed', { error: err instanceof Error ? err.message : String(err) });
  });

  // Start file watcher for ongoing changes
  await startWatcher(db, (event) => {
    switch (event.type) {
      case 'session.created':
        broadcastNotification(sessionCreated(event.projectSlug, event.sessionFile));
        break;
      case 'session.updated':
        broadcastNotification(sessionUpdated(event.projectSlug, event.sessionFile));
        break;
      case 'session.deleted':
        broadcastNotification(sessionDeleted(event.projectSlug, event.sessionFile));
        break;
    }
  });
  onShutdown(() => stopWatcher());

  log.info('Tessyn daemon is running');
}

// Run if this is the entry point
const isMainModule = process.argv[1]?.endsWith('daemon/index.js') ||
                     process.argv[1]?.endsWith('daemon/index.ts');
if (isMainModule) {
  startDaemon().catch((err) => {
    log.error('Failed to start daemon', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
