import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { MigrationError } from '../shared/errors.js';
import * as migration001 from './migrations/001-initial.js';
import * as migration002 from './migrations/002-durable-metadata.js';

const log = createLogger('schema');

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  { version: migration001.version, up: migration001.up },
  { version: migration002.version, up: migration002.up },
];

/**
 * Initialize schema versioning table if it doesn't exist.
 */
function ensureSchemaVersion(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

/**
 * Get the current schema version.
 */
export function getCurrentVersion(db: Database.Database): number {
  ensureSchemaVersion(db);
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

/**
 * Run all pending migrations.
 * Each migration runs in its own transaction.
 * Migration failures are fatal.
 */
export function runMigrations(db: Database.Database): void {
  ensureSchemaVersion(db);
  const currentVersion = getCurrentVersion(db);

  const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    log.debug('Schema is up to date', { version: currentVersion });
    return;
  }

  log.info(`Running ${pendingMigrations.length} migration(s)`, {
    from: currentVersion,
    to: pendingMigrations[pendingMigrations.length - 1]!.version,
  });

  for (const migration of pendingMigrations) {
    const runMigration = db.transaction(() => {
      try {
        migration.up(db);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          Date.now(),
        );
        log.info(`Applied migration ${migration.version}`);
      } catch (err) {
        throw new MigrationError(migration.version, err);
      }
    });

    runMigration();
  }
}
