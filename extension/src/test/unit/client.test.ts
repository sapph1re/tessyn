import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockDaemon } from '../mock-daemon.js';
import WebSocket from 'ws';

/** Helper: collect messages into a queue for sequential consumption */
function createMessageQueue(ws: WebSocket) {
  const queue: string[] = [];
  const waiters: Array<(msg: string) => void> = [];

  ws.on('message', (data) => {
    const msg = data.toString();
    const waiter = waiters.shift();
    if (waiter) {
      waiter(msg);
    } else {
      queue.push(msg);
    }
  });

  return {
    next(): Promise<string> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => { waiters.push(resolve); });
    },
  };
}

describe('JSON-RPC 2.0 protocol', () => {
  let daemon: MockDaemon;
  let port: number;

  beforeEach(async () => {
    daemon = new MockDaemon();
    port = await daemon.start();
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('connects with valid auth token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('rejects invalid auth token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=bad-token`);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });
    expect(code).toBe(4001);
  });

  it('sends initial status notification on connect', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    const mq = createMessageQueue(ws);
    await new Promise<void>((resolve) => { ws.on('open', resolve); });

    const msg = await mq.next();
    const parsed = JSON.parse(msg);
    expect(parsed.method).toBe('index.state_changed');
    expect(parsed.params.state).toBe('caught_up');
    ws.close();
  });

  it('handles request/response for status', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    const mq = createMessageQueue(ws);
    await new Promise<void>((resolve) => { ws.on('open', resolve); });

    // Consume initial notification
    await mq.next();

    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'status' }));
    const response = await mq.next();
    const parsed = JSON.parse(response);
    expect(parsed.id).toBe(1);
    expect(parsed.result.state).toBe('caught_up');
    expect(parsed.result.version).toBe('0.2.2');
    ws.close();
  });

  it('handles subscribe', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    const mq = createMessageQueue(ws);
    await new Promise<void>((resolve) => { ws.on('open', resolve); });
    await mq.next(); // Skip initial notification

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'subscribe',
      params: { topics: ['session.*', 'run.*'] },
    }));
    const response = await mq.next();
    const parsed = JSON.parse(response);
    expect(parsed.id).toBe(2);
    expect(parsed.result.subscribed).toEqual(['session.*', 'run.*']);
    ws.close();
  });

  it('returns method not found for unknown methods', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    const mq = createMessageQueue(ws);
    await new Promise<void>((resolve) => { ws.on('open', resolve); });
    await mq.next();

    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'unknown.method' }));
    const response = await mq.next();
    const parsed = JSON.parse(response);
    expect(parsed.id).toBe(3);
    expect(parsed.error.code).toBe(-32601);
    ws.close();
  });

  it('supports custom RPC handlers', async () => {
    daemon.onRpc('custom.echo', (params) => ({ echo: params }));

    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    const mq = createMessageQueue(ws);
    await new Promise<void>((resolve) => { ws.on('open', resolve); });
    await mq.next();

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'custom.echo',
      params: { hello: 'world' },
    }));
    const response = await mq.next();
    const parsed = JSON.parse(response);
    expect(parsed.id).toBe(4);
    expect(parsed.result.echo).toEqual({ hello: 'world' });
    ws.close();
  });

  it('pushes events to connected clients', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    const mq = createMessageQueue(ws);
    await new Promise<void>((resolve) => { ws.on('open', resolve); });
    await mq.next(); // Skip initial notification

    daemon.pushEvent({
      jsonrpc: '2.0',
      method: 'session.created',
      params: { projectSlug: 'test', sessionFile: 'test.jsonl' },
    });

    const msg = await mq.next();
    const parsed = JSON.parse(msg);
    expect(parsed.method).toBe('session.created');
    expect(parsed.params.projectSlug).toBe('test');
    ws.close();
  });

  it('disconnects all clients on disconnectAll', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    await new Promise<void>((resolve) => { ws.on('open', resolve); });

    const closePromise = new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
    });

    daemon.disconnectAll();
    await closePromise;
    expect(daemon.clientCount).toBe(0);
  });

  it('rejects next auth on rejectNextAuth', async () => {
    daemon.rejectNextAuth();
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });
    expect(code).toBe(4001);

    // Next connection should work
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}?token=${daemon.authToken}`);
    await new Promise<void>((resolve, reject) => {
      ws2.on('open', resolve);
      ws2.on('error', reject);
    });
    expect(ws2.readyState).toBe(WebSocket.OPEN);
    ws2.close();
  });

  it('rotates auth token', async () => {
    const oldToken = daemon.authToken;
    const newToken = daemon.rotateToken();
    expect(newToken).not.toBe(oldToken);

    // Old token should fail
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}?token=${oldToken}`);
    const code = await new Promise<number>((resolve) => {
      ws1.on('close', (code) => resolve(code));
    });
    expect(code).toBe(4001);

    // New token should work
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}?token=${newToken}`);
    await new Promise<void>((resolve, reject) => {
      ws2.on('open', resolve);
      ws2.on('error', reject);
    });
    expect(ws2.readyState).toBe(WebSocket.OPEN);
    ws2.close();
  });
});
