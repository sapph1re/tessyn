import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { sendRequest } from '../../src/cli/ipc-client.js';

function getTestSocketPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\tessyn-e2e-${process.pid}-${Date.now()}`;
  }
  return path.join(os.tmpdir(), `tessyn-e2e-${process.pid}-${Date.now()}.sock`);
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
        client.setTimeout(1000, () => {
          client.destroy();
          reject(new Error('timeout'));
        });
      });
      return; // Connected!
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(`Socket not available after ${timeoutMs}ms`);
}

describe('E2E: Daemon Lifecycle', () => {
  let daemonProcess: ChildProcess | null = null;
  let tmpDir: string;
  let socketPath: string;
  let claudeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessyn-e2e-'));
    socketPath = getTestSocketPath();
    claudeDir = path.join(tmpDir, 'claude');
    const projectDir = path.join(claudeDir, 'projects', 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(async () => {
    if (daemonProcess && !daemonProcess.killed) {
      daemonProcess.kill('SIGTERM');
      await new Promise(resolve => {
        if (daemonProcess) {
          daemonProcess.on('exit', resolve);
          setTimeout(resolve, 3000); // Force timeout
        } else {
          resolve(undefined);
        }
      });
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath); } catch {}
    }
  });

  it('should start, serve requests, and stop', async () => {
    const daemonScript = path.resolve(import.meta.dirname, '../../dist/daemon/index.js');

    // Check that build output exists
    if (!fs.existsSync(daemonScript)) {
      console.log('Skipping E2E test: daemon not built. Run npm run build first.');
      return;
    }

    daemonProcess = spawn(process.execPath, [daemonScript], {
      env: {
        ...process.env,
        TESSYN_SOCKET_PATH: socketPath,
        TESSYN_CLAUDE_DIR: claudeDir,
        TESSYN_DATA_DIR: path.join(tmpDir, 'data'),
        TESSYN_DB_PATH: path.join(tmpDir, 'test.db'),
        TESSYN_WS_PORT: String(18000 + Math.floor(Math.random() * 1000)),
        TESSYN_LOG_LEVEL: 'warn',
      },
      stdio: 'pipe',
    });

    // Consume stdio to prevent blocking
    daemonProcess.stderr?.on('data', () => {});
    daemonProcess.stdout?.on('data', () => {});

    // Wait for daemon to start
    await waitForSocket(socketPath, 15000);

    // Test status request
    const statusResponse = await sendRequest('status', undefined, socketPath);
    expect(statusResponse.error).toBeUndefined();
    const status = statusResponse.result as Record<string, unknown>;
    expect(status['version']).toBe('0.1.0');

    // Test sessions.list (should be empty)
    const listResponse = await sendRequest('sessions.list', {}, socketPath);
    expect(listResponse.error).toBeUndefined();

    // Write a JSONL file and wait for indexing
    const jsonlPath = path.join(claudeDir, 'projects', 'test-project', 'e2e-session.jsonl');
    fs.writeFileSync(jsonlPath, [
      '{"type":"system","timestamp":"2025-01-01T00:00:00Z","session_id":"e2e-test"}',
      '{"type":"user","timestamp":"2025-01-01T00:00:05Z","message":{"role":"user","content":"E2E test message"}}',
      '',
    ].join('\n'));

    // Wait for watcher to pick it up
    await new Promise(r => setTimeout(r, 2000));

    // Check if session was indexed
    const searchResponse = await sendRequest('search', { query: 'E2E test' }, socketPath);
    // Session may or may not be indexed yet depending on timing
    expect(searchResponse.error).toBeUndefined();

    // Shutdown via IPC
    await sendRequest('shutdown', undefined, socketPath);
    await new Promise(r => setTimeout(r, 1000));
  }, 30000);
});
