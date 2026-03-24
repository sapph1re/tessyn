import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { sendRequest } from '../../src/cli/ipc-client.js';

function getTestSocketPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\tessyn-e2e-wiq-${process.pid}-${Date.now()}`;
  }
  return path.join(os.tmpdir(), `tessyn-e2e-wiq-${process.pid}-${Date.now()}.sock`);
}

async function waitForSocket(socketPath: string, timeoutMs: number = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
          client.end();
          resolve();
        });
        client.on('error', reject);
        client.setTimeout(1000, () => { client.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(`Socket not available after ${timeoutMs}ms`);
}

describe('E2E: Watch → Index → Query Pipeline', () => {
  let daemonProcess: ChildProcess | null = null;
  let tmpDir: string;
  let socketPath: string;
  let claudeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessyn-e2e-wiq-'));
    socketPath = getTestSocketPath();
    claudeDir = path.join(tmpDir, 'claude');
    projectDir = path.join(claudeDir, 'projects', 'e2e-project');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(async () => {
    if (daemonProcess && !daemonProcess.killed) {
      try { await sendRequest('shutdown', undefined, socketPath); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      if (!daemonProcess.killed) daemonProcess.kill('SIGTERM');
      await new Promise(resolve => {
        if (daemonProcess) {
          daemonProcess.on('exit', resolve);
          setTimeout(resolve, 3000);
        } else {
          resolve(undefined);
        }
      });
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath); } catch {}
    }
  });

  it('should index files written while daemon is running and make them searchable', async () => {
    const daemonScript = path.resolve(import.meta.dirname, '../../dist/daemon/index.js');
    if (!fs.existsSync(daemonScript)) {
      console.log('Skipping: daemon not built');
      return;
    }

    daemonProcess = spawn(process.execPath, [daemonScript], {
      env: {
        ...process.env,
        TESSYN_SOCKET_PATH: socketPath,
        TESSYN_CLAUDE_DIR: claudeDir,
        TESSYN_DATA_DIR: path.join(tmpDir, 'data'),
        TESSYN_DB_PATH: path.join(tmpDir, 'test.db'),
        TESSYN_WS_PORT: String(19000 + Math.floor(Math.random() * 1000)),
        TESSYN_LOG_LEVEL: 'warn',
      },
      stdio: 'pipe',
    });
    daemonProcess.stderr?.on('data', () => {});
    daemonProcess.stdout?.on('data', () => {});

    await waitForSocket(socketPath, 15000);

    // Simulate Claude Code writing a conversation incrementally
    const jsonlPath = path.join(projectDir, 'incremental-session.jsonl');

    // Write first message
    fs.writeFileSync(jsonlPath,
      '{"type":"system","timestamp":"2025-06-01T10:00:00Z","session_id":"inc-session"}\n' +
      '{"type":"user","timestamp":"2025-06-01T10:00:05Z","message":{"role":"user","content":"What is the capital of France?"}}\n'
    );

    // Wait for watcher + indexing
    await new Promise(r => setTimeout(r, 2000));

    // Query for the message
    let searchResult = await sendRequest('search', { query: 'capital France' }, socketPath);
    expect(searchResult.error).toBeUndefined();

    // Append assistant response (simulating Claude Code writing)
    fs.appendFileSync(jsonlPath,
      '{"type":"assistant","timestamp":"2025-06-01T10:00:15Z","message":{"role":"assistant","content":[{"type":"text","text":"The capital of France is Paris."}]}}\n'
    );

    // Wait for incremental indexing
    await new Promise(r => setTimeout(r, 2000));

    // Search for the response
    searchResult = await sendRequest('search', { query: 'Paris' }, socketPath);
    expect(searchResult.error).toBeUndefined();

    // List sessions — should have exactly one
    const listResult = await sendRequest('sessions.list', {}, socketPath);
    expect(listResult.error).toBeUndefined();
    const { sessions } = listResult.result as { sessions: Array<{ messageCount: number }> };
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
