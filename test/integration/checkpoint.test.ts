import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/schema.js';
import { indexSession } from '../../src/indexer/index.js';
import * as queries from '../../src/db/queries.js';

describe('Checkpoint Edge Cases', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessyn-test-cp-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle file truncation (full reparse)', () => {
    const filePath = path.join(tmpDir, 'truncate.jsonl');

    // Write initial content
    fs.writeFileSync(filePath, [
      '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"role":"user","content":"Message one"}}',
      '{"type":"user","timestamp":"2025-01-01T00:01:00Z","message":{"role":"user","content":"Message two"}}',
      '',
    ].join('\n'));

    indexSession(db, filePath, 'test-project');

    let sessions = queries.listSessions(db);
    let messages = queries.getMessages(db, sessions[0]!.id);
    expect(messages.length).toBe(2);

    // Truncate to just one message
    fs.writeFileSync(filePath, '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"role":"user","content":"Only message"}}\n');

    indexSession(db, filePath, 'test-project');

    sessions = queries.listSessions(db);
    messages = queries.getMessages(db, sessions[0]!.id);
    expect(messages.length).toBe(1);
    expect(messages[0]!.content).toBe('Only message');
  });

  it('should handle file replacement (different content, same path)', () => {
    const filePath = path.join(tmpDir, 'replace.jsonl');

    // Write original content with enough data for different identity
    fs.writeFileSync(filePath, '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"role":"user","content":"Original content that is long enough to produce a different hash"}}\n');
    indexSession(db, filePath, 'test-project');

    let sessions = queries.listSessions(db);
    let messages = queries.getMessages(db, sessions[0]!.id);
    expect(messages[0]!.content).toContain('Original');

    // Replace with different content
    fs.writeFileSync(filePath, '{"type":"user","timestamp":"2025-02-01T00:00:00Z","message":{"role":"user","content":"Completely replaced content that should be totally different from before"}}\n');
    indexSession(db, filePath, 'test-project');

    sessions = queries.listSessions(db);
    messages = queries.getMessages(db, sessions[0]!.id);
    expect(messages[0]!.content).toContain('replaced');
  });

  it('should handle duplicate index calls (idempotent)', () => {
    const filePath = path.join(tmpDir, 'idempotent.jsonl');
    fs.writeFileSync(filePath, '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"role":"user","content":"Hello"}}\n');

    indexSession(db, filePath, 'test-project');
    indexSession(db, filePath, 'test-project');
    indexSession(db, filePath, 'test-project');

    const sessions = queries.listSessions(db);
    expect(sessions.length).toBe(1);
    const messages = queries.getMessages(db, sessions[0]!.id);
    expect(messages.length).toBe(1);
  });

  it('should handle partial line at end of file', () => {
    const filePath = path.join(tmpDir, 'partial.jsonl');

    // Write complete line + partial line (no trailing newline)
    const completeLine = '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"role":"user","content":"Complete"}}\n';
    const partialLine = '{"type":"user","timestamp":"2025-01-01T00:01:00Z","mess';
    fs.writeFileSync(filePath, completeLine + partialLine);

    indexSession(db, filePath, 'test-project');

    const sessions = queries.listSessions(db);
    const messages = queries.getMessages(db, sessions[0]!.id);

    // Should only have the complete message, not the partial one
    expect(messages.length).toBe(1);
    expect(messages[0]!.content).toBe('Complete');
  });

  it('should handle deleted file gracefully', () => {
    const filePath = path.join(tmpDir, 'deleted.jsonl');
    fs.writeFileSync(filePath, '{"type":"user","timestamp":"2025-01-01T00:00:00Z","message":{"role":"user","content":"Temporary"}}\n');

    indexSession(db, filePath, 'test-project');

    // Delete the file
    fs.unlinkSync(filePath);

    // Re-index should mark as deleted
    indexSession(db, filePath, 'test-project');

    const sessions = queries.listSessions(db, { state: 'deleted' });
    expect(sessions.length).toBe(1);
  });
});
