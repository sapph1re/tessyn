import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/schema.js';
import { startIpcServer, stopIpcServer } from '../../src/daemon/ipc-server.js';
import { sendRequest } from '../../src/cli/ipc-client.js';
import * as queries from '../../src/db/queries.js';

function getTestSocketPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\tessyn-test-${process.pid}-${Date.now()}`;
  }
  return path.join(os.tmpdir(), `tessyn-test-${process.pid}-${Date.now()}.sock`);
}

describe('IPC Server/Client', () => {
  let db: Database.Database;
  let socketPath: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    socketPath = getTestSocketPath();
    await startIpcServer(db, socketPath);
  });

  afterEach(async () => {
    await stopIpcServer();
    db.close();
    // Clean up socket file on Unix
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath); } catch {}
    }
  });

  it('should respond to status request', async () => {
    const response = await sendRequest('status', undefined, socketPath);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.result).toBeTruthy();
    const result = response.result as Record<string, unknown>;
    expect(result['version']).toBe('0.1.0');
  });

  it('should list sessions (empty)', async () => {
    const response = await sendRequest('sessions.list', {}, socketPath);
    expect(response.error).toBeUndefined();
    const result = response.result as { sessions: unknown[] };
    expect(result.sessions).toEqual([]);
  });

  it('should return error for unknown method', async () => {
    const response = await sendRequest('nonexistent', {}, socketPath);
    expect(response.error).toBeTruthy();
    expect(response.error!.code).toBe(-32601);
  });

  it('should search across indexed sessions', async () => {
    // Add a session with a message
    const sessionId = queries.upsertSession(db, {
      provider: 'claude',
      externalId: 'test-search-session',
      projectSlug: 'test-project',
      projectPath: null,
      jsonlPath: '/fake/path.jsonl',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    queries.insertMessages(db, sessionId, [
      {
        role: 'user',
        content: 'How do I fix the authentication bug?',
        toolName: null,
        toolInput: null,
        timestamp: Date.now(),
        sequence: 1,
        blockType: 'text',
      },
    ]);

    const response = await sendRequest('search', { query: 'authentication' }, socketPath);
    expect(response.error).toBeUndefined();
    const result = response.result as { results: unknown[]; total: number };
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('should handle sessions.get with messages', async () => {
    const sessionId = queries.upsertSession(db, {
      provider: 'claude',
      externalId: 'test-get-session',
      projectSlug: 'test-project',
      projectPath: null,
      jsonlPath: '/fake/path.jsonl',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    queries.insertMessages(db, sessionId, [
      {
        role: 'user',
        content: 'Hello',
        toolName: null,
        toolInput: null,
        timestamp: Date.now(),
        sequence: 1,
        blockType: 'text',
      },
    ]);

    const response = await sendRequest('sessions.get', { id: sessionId }, socketPath);
    expect(response.error).toBeUndefined();
    const result = response.result as { session: unknown; messages: unknown[] };
    expect(result.session).toBeTruthy();
    expect(result.messages.length).toBe(1);
  });

  it('should return error for nonexistent session', async () => {
    const response = await sendRequest('sessions.get', { id: 99999 }, socketPath);
    expect(response.error).toBeTruthy();
    expect(response.error!.code).toBe(-32001);
  });
});
