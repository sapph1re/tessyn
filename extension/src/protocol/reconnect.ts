import type { Disposable } from 'vscode';
import { TessynClient } from './client.js';

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const JITTER_FACTOR = 0.3;

/**
 * Manages automatic reconnection to the Tessyn daemon with exponential backoff.
 * On reconnect, executes the documented handshake:
 * 1. Re-read auth token (it rotates on daemon restart)
 * 2. Connect
 * 3. status — verify daemon state
 * 4. subscribe — re-subscribe all topics
 * 5. run.list — discover active runs
 * 6. Notify listeners for state reconciliation
 */
export class ReconnectManager implements Disposable {
  private delay = INITIAL_DELAY_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private reconnectListeners: Array<() => void> = [];

  constructor(
    private client: TessynClient,
    private topics: string[] = ['session.*', 'run.*', 'index.*'],
  ) {
    this.client.onConnectionChange((connected) => {
      if (!connected && !this.disposed) {
        this.scheduleReconnect();
      } else if (connected) {
        this.resetDelay();
      }
    });
  }

  /**
   * Perform initial connection with the full handshake.
   */
  async connectWithHandshake(): Promise<void> {
    await this.client.connect();
    await this.performHandshake();
  }

  /**
   * Register a listener called after successful reconnection + handshake.
   * Listeners should refetch any state they care about.
   */
  onReconnect(handler: () => void): Disposable {
    this.reconnectListeners.push(handler);
    return {
      dispose: () => {
        const idx = this.reconnectListeners.indexOf(handler);
        if (idx >= 0) this.reconnectListeners.splice(idx, 1);
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.reconnectListeners = [];
  }

  private async performHandshake(): Promise<void> {
    // Step 1: Verify daemon state
    await this.client.call('status');

    // Step 2: Subscribe to all topics
    await this.client.subscribe(this.topics);
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.timer) return;

    const jitter = 1 + (Math.random() * 2 - 1) * JITTER_FACTOR;
    const delayWithJitter = Math.round(this.delay * jitter);

    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.disposed) return;

      try {
        await this.connectWithHandshake();
        // Notify listeners to reconcile state
        for (const listener of this.reconnectListeners) {
          try {
            listener();
          } catch {
            // Don't let one listener break others
          }
        }
      } catch {
        // Connection failed — back off and retry
        this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
        this.scheduleReconnect();
      }
    }, delayWithJitter);
  }

  private resetDelay(): void {
    this.delay = INITIAL_DELAY_MS;
  }
}
