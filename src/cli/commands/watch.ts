import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { getWebSocketPort, getDataDir } from '../../platform/paths.js';
import type { JsonRpcNotification } from '../../shared/types.js';

/**
 * Read the WebSocket auth token from the data directory.
 */
function readAuthToken(): string | null {
  const tokenPath = path.join(getDataDir(), 'ws-auth-token');
  try {
    return fs.readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

export async function watchCommand(): Promise<void> {
  const token = readAuthToken();
  if (!token) {
    console.error('Could not read auth token. Is the daemon running?');
    console.error('Start it with: tessyn start');
    process.exit(1);
  }

  const port = getWebSocketPort();
  const url = `ws://127.0.0.1:${port}?token=${token}`;

  console.log('Connecting to Tessyn daemon...');

  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('Connected. Streaming events (Ctrl+C to stop):\n');

    // Subscribe to all events
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'subscribe',
      params: { topics: ['*'] },
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as JsonRpcNotification & { id?: unknown; result?: unknown };

      // Skip the initial status message and subscription confirmation
      if (msg.id !== undefined) return;

      const method = msg.method;
      const params = msg.params ?? {};
      const time = new Date().toLocaleTimeString();

      switch (method) {
        case 'status':
          console.log(`  [${time}] daemon status: ${params['state']} (${params['sessionsIndexed']} sessions)`);
          break;
        case 'session.created':
          console.log(`  [${time}] + session created: ${params['projectSlug']}/${params['sessionFile']}`);
          break;
        case 'session.updated':
          console.log(`  [${time}] ~ session updated: ${params['projectSlug']}/${params['sessionFile']}`);
          break;
        case 'session.deleted':
          console.log(`  [${time}] - session deleted: ${params['projectSlug']}/${params['sessionFile']}`);
          break;
        case 'index.state_changed':
          console.log(`  [${time}] index state: ${params['state']} (${params['sessionsIndexed']}/${params['sessionsTotal']})`);
          break;
        default:
          console.log(`  [${time}] ${method}: ${JSON.stringify(params)}`);
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error('Could not connect to daemon. Is it running?');
      console.error('Start it with: tessyn start');
      process.exit(1);
    }
    console.error('WebSocket error:', err.message);
  });

  ws.on('close', (code) => {
    if (code === 4001) {
      console.error('Authentication failed. Try restarting the daemon.');
    } else {
      console.log('\nDisconnected from daemon.');
    }
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\nStopping...');
    ws.close();
  });

  // Keep the process alive
  await new Promise(() => {});
}
