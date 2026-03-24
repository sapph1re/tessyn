import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import { getDatabasePath } from '../platform/paths.js';
import { runMigrations } from './schema.js';

const log = createLogger('db');

let db: Database.Database | null = null;

/**
 * Initialize the database connection.
 * Creates the data directory if needed, opens SQLite with WAL mode,
 * and runs any pending migrations.
 */
export function initDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? getDatabasePath();

  // Ensure parent directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  log.info('Opening database', { path: resolvedPath });
  db = new Database(resolvedPath);

  // Enable WAL mode for concurrent read/write
  db.pragma('journal_mode = WAL');
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  // Reasonable busy timeout for concurrent access
  db.pragma('busy_timeout = 5000');

  // Run migrations
  runMigrations(db);

  log.info('Database initialized');
  return db;
}

/**
 * Get the current database connection.
 * Throws if not initialized.
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    log.info('Closing database');
    db.close();
    db = null;
  }
}
