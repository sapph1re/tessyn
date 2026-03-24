import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '../../src/db/schema.js';
import { indexSession, fullScan, fullReindex } from '../../src/indexer/index.js';
import * as queries from '../../src/db/queries.js';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/conversations');

describe('Indexer Integration', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessyn-test-indexer-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('indexSession', () => {
    it('should index a simple chat', () => {
      const changed = indexSession(db, path.join(FIXTURES, 'simple-chat.jsonl'), 'test-project');
      expect(changed).not.toBe('unchanged');

      const sessions = queries.listSessions(db);
      expect(sessions.length).toBe(1);
      expect(sessions[0]!.projectSlug).toBe('test-project');

      const session = queries.getSessionById(db, sessions[0]!.id);
      expect(session).toBeTruthy();

      const messages = queries.getMessages(db, sessions[0]!.id);
      expect(messages.length).toBeGreaterThan(0);

      // Should have user and assistant messages
      const roles = new Set(messages.map(m => m.role));
      expect(roles.has('user')).toBe(true);
      expect(roles.has('assistant')).toBe(true);
    });

    it('should index multi-turn with tools', () => {
      indexSession(db, path.join(FIXTURES, 'multi-turn-with-tools.jsonl'), 'test-project');

      const sessions = queries.listSessions(db);
      const messages = queries.getMessages(db, sessions[0]!.id);

      const toolMessages = messages.filter(m => m.blockType === 'tool_use');
      expect(toolMessages.length).toBeGreaterThan(0);
    });

    it('should handle malformed lines gracefully', () => {
      const changed = indexSession(db, path.join(FIXTURES, 'malformed-lines.jsonl'), 'test-project');
      expect(changed).not.toBe('unchanged');

      const sessions = queries.listSessions(db);
      const messages = queries.getMessages(db, sessions[0]!.id);

      // Should still have valid messages despite malformed lines
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should skip unchanged files on re-index', () => {
      indexSession(db, path.join(FIXTURES, 'simple-chat.jsonl'), 'test-project');
      const changed = indexSession(db, path.join(FIXTURES, 'simple-chat.jsonl'), 'test-project');
      expect(changed).toBe('unchanged'); // No changes
    });

    it('should incrementally index when file grows', () => {
      // Create a file with one message
      const filePath = path.join(tmpDir, 'growing.jsonl');
      const line1 = '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"role":"user","content":"First"}}\n';
      fs.writeFileSync(filePath, line1);

      indexSession(db, filePath, 'test-project');
      let sessions = queries.listSessions(db);
      let messages = queries.getMessages(db, sessions[0]!.id);
      const count1 = messages.length;

      // Append another message
      const line2 = '{"type":"user","timestamp":"2025-01-01T00:01:00Z","message":{"role":"user","content":"Second"}}\n';
      fs.appendFileSync(filePath, line2);

      const changed = indexSession(db, filePath, 'test-project');
      expect(changed).not.toBe('unchanged');

      sessions = queries.listSessions(db);
      messages = queries.getMessages(db, sessions[0]!.id);
      expect(messages.length).toBeGreaterThan(count1);
    });
  });

  describe('fullScan', () => {
    it('should discover and index sessions from directory structure', () => {
      // Create a mock Claude projects directory
      const projectDir = path.join(tmpDir, 'my-project');
      fs.mkdirSync(projectDir, { recursive: true });

      // Copy fixture files
      fs.copyFileSync(
        path.join(FIXTURES, 'simple-chat.jsonl'),
        path.join(projectDir, 'session-001.jsonl'),
      );
      fs.copyFileSync(
        path.join(FIXTURES, 'multi-turn-with-tools.jsonl'),
        path.join(projectDir, 'session-002.jsonl'),
      );

      const { indexed, total } = fullScan(db, tmpDir);
      expect(total).toBe(2);
      expect(indexed).toBeGreaterThan(0);

      const sessions = queries.listSessions(db);
      expect(sessions.length).toBe(2);
    });
  });

  describe('fullReindex', () => {
    it('should clear and rebuild all data', () => {
      const projectDir = path.join(tmpDir, 'my-project');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.copyFileSync(
        path.join(FIXTURES, 'simple-chat.jsonl'),
        path.join(projectDir, 'session-001.jsonl'),
      );

      // Initial index
      fullScan(db, tmpDir);
      const countBefore = queries.getSessionCount(db);

      // Full reindex
      const { total } = fullReindex(db, tmpDir);
      const countAfter = queries.getSessionCount(db);

      expect(countAfter).toBe(countBefore);
      expect(total).toBe(1);
    });
  });

  describe('search', () => {
    it('should find messages via FTS5', () => {
      indexSession(db, path.join(FIXTURES, 'simple-chat.jsonl'), 'test-project');

      const results = queries.searchMessages(db, { query: 'auth module' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by role', () => {
      indexSession(db, path.join(FIXTURES, 'simple-chat.jsonl'), 'test-project');

      const userResults = queries.searchMessages(db, { query: 'auth', role: 'user' });
      const allResults = queries.searchMessages(db, { query: 'auth' });

      // User-only results should be <= all results
      expect(userResults.length).toBeLessThanOrEqual(allResults.length);
      for (const r of userResults) {
        expect(r.role).toBe('user');
      }
    });
  });
});
