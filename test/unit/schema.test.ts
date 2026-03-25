import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getCurrentVersion } from '../../src/db/schema.js';

describe('Schema & Migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('should create schema_version table', () => {
    runMigrations(db);
    const version = getCurrentVersion(db);
    expect(version).toBe(2);
  });

  it('should create sessions table', () => {
    runMigrations(db);
    const info = db.prepare("SELECT * FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    expect(info).toBeTruthy();
  });

  it('should create messages table', () => {
    runMigrations(db);
    const info = db.prepare("SELECT * FROM sqlite_master WHERE type='table' AND name='messages'").get();
    expect(info).toBeTruthy();
  });

  it('should create messages_fts table', () => {
    runMigrations(db);
    const info = db.prepare("SELECT * FROM sqlite_master WHERE type='table' AND name='messages_fts'").get();
    expect(info).toBeTruthy();
  });

  it('should be idempotent (running migrations twice is safe)', () => {
    runMigrations(db);
    const v1 = getCurrentVersion(db);
    runMigrations(db);
    const v2 = getCurrentVersion(db);
    expect(v1).toBe(v2);
  });

  it('should enforce UNIQUE(provider, external_id) on sessions', () => {
    runMigrations(db);
    db.prepare('INSERT INTO sessions (provider, external_id, project_slug, jsonl_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('claude', 'sess-1', 'proj', '/path/a.jsonl', Date.now(), Date.now());

    expect(() => {
      db.prepare('INSERT INTO sessions (provider, external_id, project_slug, jsonl_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('claude', 'sess-1', 'proj', '/path/b.jsonl', Date.now(), Date.now());
    }).toThrow();
  });

  it('should enforce UNIQUE(session_id, sequence) on messages', () => {
    runMigrations(db);
    db.prepare('INSERT INTO sessions (provider, external_id, project_slug, jsonl_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('claude', 'sess-1', 'proj', '/path/a.jsonl', Date.now(), Date.now());

    const session = db.prepare('SELECT id FROM sessions WHERE external_id = ?').get('sess-1') as { id: number };

    db.prepare('INSERT INTO messages (session_id, role, content, timestamp, sequence) VALUES (?, ?, ?, ?, ?)')
      .run(session.id, 'user', 'hello', Date.now(), 1);

    expect(() => {
      db.prepare('INSERT INTO messages (session_id, role, content, timestamp, sequence) VALUES (?, ?, ?, ?, ?)')
        .run(session.id, 'user', 'duplicate', Date.now(), 1);
    }).toThrow();
  });

  it('should cascade delete messages when session is deleted', () => {
    runMigrations(db);
    db.prepare('INSERT INTO sessions (provider, external_id, project_slug, jsonl_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('claude', 'sess-del', 'proj', '/path/a.jsonl', Date.now(), Date.now());

    const session = db.prepare('SELECT id FROM sessions WHERE external_id = ?').get('sess-del') as { id: number };

    db.prepare('INSERT INTO messages (session_id, role, content, timestamp, sequence) VALUES (?, ?, ?, ?, ?)')
      .run(session.id, 'user', 'hello', Date.now(), 1);

    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);

    const count = db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(session.id) as { c: number };
    expect(count.c).toBe(0);
  });
});
