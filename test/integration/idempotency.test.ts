import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/schema.js';
import { fullScan, fullReindex } from '../../src/indexer/index.js';
import * as queries from '../../src/db/queries.js';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/conversations');

describe('Idempotency', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessyn-test-idempotency-'));

    // Set up mock Claude projects directory
    const projectDir = path.join(tmpDir, 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURES, 'simple-chat.jsonl'),
      path.join(projectDir, 'session-001.jsonl'),
    );
    fs.copyFileSync(
      path.join(FIXTURES, 'multi-turn-with-tools.jsonl'),
      path.join(projectDir, 'session-002.jsonl'),
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should produce identical state after multiple fullScans', () => {
    fullScan(db, tmpDir);
    const sessions1 = queries.listSessions(db);
    const msgCount1 = sessions1.reduce((sum, s) => sum + s.messageCount, 0);

    fullScan(db, tmpDir);
    const sessions2 = queries.listSessions(db);
    const msgCount2 = sessions2.reduce((sum, s) => sum + s.messageCount, 0);

    expect(sessions2.length).toBe(sessions1.length);
    expect(msgCount2).toBe(msgCount1);
  });

  it('should produce identical state after fullReindex', () => {
    fullScan(db, tmpDir);
    const sessions1 = queries.listSessions(db);
    // Collect message counts by externalId (IDs change after reindex)
    const msgCounts1 = new Map<string, number>();
    for (const s of sessions1) {
      const msgs = queries.getMessages(db, s.id);
      msgCounts1.set(s.externalId, msgs.length);
    }

    fullReindex(db, tmpDir);
    const sessions2 = queries.listSessions(db);

    expect(sessions2.length).toBe(sessions1.length);

    // Message counts should match by externalId
    for (const s of sessions2) {
      const msgs = queries.getMessages(db, s.id);
      const expected = msgCounts1.get(s.externalId);
      expect(msgs.length).toBe(expected);
    }
  });

  it('should not create duplicate sessions on repeated indexing', () => {
    fullScan(db, tmpDir);
    fullScan(db, tmpDir);
    fullScan(db, tmpDir);

    const sessions = queries.listSessions(db);
    // Should still have exactly 2 sessions, not 6
    expect(sessions.length).toBe(2);
  });
});
