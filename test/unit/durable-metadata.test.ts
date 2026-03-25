import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getCurrentVersion } from '../../src/db/schema.js';
import * as queries from '../../src/db/queries.js';

describe('Durable Metadata (Migration 002)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create session_meta table', () => {
    const info = db.prepare("SELECT * FROM sqlite_master WHERE type='table' AND name='session_meta'").get();
    expect(info).toBeTruthy();
  });

  it('should be at schema version 2', () => {
    expect(getCurrentVersion(db)).toBe(2);
  });

  it('should upsert and retrieve session metadata', () => {
    queries.upsertSessionMeta(db, 'claude', 'test-session-001', {
      title: 'My custom title',
      hidden: false,
      archived: false,
    });

    const meta = queries.getSessionMeta(db, 'claude', 'test-session-001');
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('My custom title');
    expect(meta!.hidden).toBe(false);
    expect(meta!.archived).toBe(false);
  });

  it('should update metadata fields individually', () => {
    queries.upsertSessionMeta(db, 'claude', 'test-session-002', { title: 'Original' });
    queries.upsertSessionMeta(db, 'claude', 'test-session-002', { title: 'Updated' });

    const meta = queries.getSessionMeta(db, 'claude', 'test-session-002');
    expect(meta!.title).toBe('Updated');
  });

  it('should handle toggle values (null = default, true, false)', () => {
    queries.upsertSessionMeta(db, 'claude', 'toggle-test', {
      autoCommit: true,
      autoBranch: false,
      autoDocument: null,
    });

    const toggles = queries.getSessionToggles(db, 'claude', 'toggle-test');
    expect(toggles.autoCommit).toBe(true);
    expect(toggles.autoBranch).toBe(false);
    expect(toggles.autoDocument).toBeNull();
    expect(toggles.autoCompact).toBeNull();
  });

  it('should persist drafts', () => {
    queries.upsertSessionMeta(db, 'claude', 'draft-test', {
      draft: 'My unsaved message text',
    });

    const meta = queries.getSessionMeta(db, 'claude', 'draft-test');
    expect(meta!.draft).toBe('My unsaved message text');
  });

  it('should return null for nonexistent metadata', () => {
    const meta = queries.getSessionMeta(db, 'claude', 'nonexistent');
    expect(meta).toBeNull();
  });

  it('should return default toggles for nonexistent session', () => {
    const toggles = queries.getSessionToggles(db, 'claude', 'nonexistent');
    expect(toggles.autoCommit).toBeNull();
    expect(toggles.autoBranch).toBeNull();
    expect(toggles.autoDocument).toBeNull();
    expect(toggles.autoCompact).toBeNull();
  });

  describe('reindex survival', () => {
    it('should preserve metadata after deleteAllData', () => {
      // Create a session and its metadata
      queries.upsertSession(db, {
        provider: 'claude',
        externalId: 'survive-test',
        projectSlug: 'test-project',
        projectPath: null,
        jsonlPath: '/fake/path.jsonl',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      queries.upsertSessionMeta(db, 'claude', 'survive-test', {
        title: 'User-set title',
        autoCommit: true,
        draft: 'Important draft',
      });

      // Simulate reindex — this destroys sessions + messages but NOT session_meta
      queries.deleteAllData(db);

      // Verify sessions table is empty
      const sessions = queries.listSessions(db);
      expect(sessions.length).toBe(0);

      // Verify metadata survived
      const meta = queries.getSessionMeta(db, 'claude', 'survive-test');
      expect(meta).not.toBeNull();
      expect(meta!.title).toBe('User-set title');
      expect(meta!.autoCommit).toBe(true);
      expect(meta!.draft).toBe('Important draft');
    });

    it('should seed metadata from existing sessions with titles during migration', () => {
      // This test verifies the migration seed logic.
      // Since we run all migrations in beforeEach, we need a fresh DB
      // with only migration 001, then add a session with title, then run 002.
      const freshDb = new Database(':memory:');
      freshDb.pragma('journal_mode = WAL');
      freshDb.pragma('foreign_keys = ON');

      // Run only migration 001
      freshDb.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);

      // Import and run migration 001 manually
      freshDb.exec(`
        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL DEFAULT 'claude',
          external_id TEXT NOT NULL,
          project_slug TEXT NOT NULL,
          project_path TEXT,
          title TEXT,
          first_prompt TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          message_count INTEGER DEFAULT 0,
          jsonl_path TEXT NOT NULL,
          jsonl_byte_offset INTEGER DEFAULT 0,
          jsonl_size INTEGER DEFAULT 0,
          jsonl_identity TEXT,
          git_branch TEXT,
          git_remote TEXT,
          state TEXT NOT NULL DEFAULT 'active',
          UNIQUE(provider, external_id)
        );
      `);
      freshDb.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)').run(Date.now());

      // Add a session with a title
      freshDb.prepare(`
        INSERT INTO sessions (provider, external_id, project_slug, jsonl_path, title, created_at, updated_at)
        VALUES ('claude', 'seeded-session', 'project', '/path.jsonl', 'Seeded Title', ?, ?)
      `).run(Date.now(), Date.now());

      // Now run migration 002 via the migration runner
      runMigrations(freshDb);

      // Verify the title was seeded into session_meta
      const row = freshDb.prepare(
        "SELECT title FROM session_meta WHERE provider = 'claude' AND external_id = 'seeded-session'"
      ).get() as { title: string } | undefined;
      expect(row).toBeTruthy();
      expect(row!.title).toBe('Seeded Title');

      freshDb.close();
    });
  });
});
