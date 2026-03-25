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
    return `\\\\.\\pipe\\tessyn-test-meta-${process.pid}-${Date.now()}`;
  }
  return path.join(os.tmpdir(), `tessyn-test-meta-${process.pid}-${Date.now()}.sock`);
}

describe('Session Metadata APIs via IPC', () => {
  let db: Database.Database;
  let socketPath: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    // Create a test session in the index
    queries.upsertSession(db, {
      provider: 'claude',
      externalId: 'test-ext-001',
      projectSlug: 'test-project',
      projectPath: null,
      jsonlPath: '/fake/path.jsonl',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    socketPath = getTestSocketPath();
    await startIpcServer({ db }, socketPath);
  });

  afterEach(async () => {
    await stopIpcServer();
    db.close();
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath); } catch {}
    }
  });

  it('should get session by externalId', async () => {
    const response = await sendRequest('sessions.get', { externalId: 'test-ext-001' }, socketPath);
    expect(response.error).toBeUndefined();
    const result = response.result as { session: { externalId: string } };
    expect(result.session.externalId).toBe('test-ext-001');
  });

  it('should rename a session', async () => {
    const response = await sendRequest('sessions.rename', {
      externalId: 'test-ext-001',
      title: 'My Custom Title',
    }, socketPath);
    expect(response.error).toBeUndefined();

    // Verify via direct query
    const meta = queries.getSessionMeta(db, 'claude', 'test-ext-001');
    expect(meta!.title).toBe('My Custom Title');
  });

  it('should hide and unhide a session', async () => {
    await sendRequest('sessions.hide', { externalId: 'test-ext-001', hidden: true }, socketPath);
    let meta = queries.getSessionMeta(db, 'claude', 'test-ext-001');
    expect(meta!.hidden).toBe(true);

    await sendRequest('sessions.hide', { externalId: 'test-ext-001', hidden: false }, socketPath);
    meta = queries.getSessionMeta(db, 'claude', 'test-ext-001');
    expect(meta!.hidden).toBe(false);
  });

  it('should archive and unarchive a session', async () => {
    await sendRequest('sessions.archive', { externalId: 'test-ext-001', archived: true }, socketPath);
    let meta = queries.getSessionMeta(db, 'claude', 'test-ext-001');
    expect(meta!.archived).toBe(true);

    await sendRequest('sessions.archive', { externalId: 'test-ext-001', archived: false }, socketPath);
    meta = queries.getSessionMeta(db, 'claude', 'test-ext-001');
    expect(meta!.archived).toBe(false);
  });

  it('should set and get toggles', async () => {
    const setResponse = await sendRequest('sessions.toggles.set', {
      externalId: 'test-ext-001',
      autoCommit: true,
      autoBranch: false,
    }, socketPath);
    expect(setResponse.error).toBeUndefined();
    const setResult = setResponse.result as { toggles: { autoCommit: boolean } };
    expect(setResult.toggles.autoCommit).toBe(true);

    const getResponse = await sendRequest('sessions.toggles.get', {
      externalId: 'test-ext-001',
    }, socketPath);
    expect(getResponse.error).toBeUndefined();
    const getResult = getResponse.result as { toggles: { autoCommit: boolean; autoBranch: boolean; autoCompact: null } };
    expect(getResult.toggles.autoCommit).toBe(true);
    expect(getResult.toggles.autoBranch).toBe(false);
    expect(getResult.toggles.autoCompact).toBeNull();
  });

  it('should save and load drafts', async () => {
    await sendRequest('sessions.draft.save', {
      externalId: 'test-ext-001',
      content: 'My unsaved message',
    }, socketPath);

    const response = await sendRequest('sessions.draft.get', {
      externalId: 'test-ext-001',
    }, socketPath);
    expect(response.error).toBeUndefined();
    const result = response.result as { content: string };
    expect(result.content).toBe('My unsaved message');
  });

  it('should return null draft for session without draft', async () => {
    const response = await sendRequest('sessions.draft.get', {
      externalId: 'no-draft-session',
    }, socketPath);
    expect(response.error).toBeUndefined();
    const result = response.result as { content: null };
    expect(result.content).toBeNull();
  });

  it('should preserve metadata after reindex', async () => {
    // Set metadata
    await sendRequest('sessions.rename', {
      externalId: 'test-ext-001',
      title: 'Survives Reindex',
    }, socketPath);
    await sendRequest('sessions.toggles.set', {
      externalId: 'test-ext-001',
      autoCommit: true,
    }, socketPath);

    // Simulate reindex
    queries.deleteAllData(db);

    // Metadata should survive
    const meta = queries.getSessionMeta(db, 'claude', 'test-ext-001');
    expect(meta!.title).toBe('Survives Reindex');
    expect(meta!.autoCommit).toBe(true);
  });
});
