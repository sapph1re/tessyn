import type { Disposable } from 'vscode';
import type { TessynClient } from '../protocol/client.js';
import type { StateStore } from './store.js';
import type { DaemonStatus, SessionSummary, Run } from '../protocol/types.js';

/**
 * Wires WebSocket events from the TessynClient to StateStore mutations.
 * Also handles initial state fetch and reconnect reconciliation.
 */
export class StateSync implements Disposable {
  private disposables: Disposable[] = [];
  private currentProjectSlug: string | undefined;

  constructor(
    private client: TessynClient,
    private store: StateStore,
  ) {}

  /**
   * Start syncing. Call after connection is established.
   */
  start(projectSlug?: string): void {
    this.currentProjectSlug = projectSlug;

    // Wire connection state
    this.disposables.push(
      this.client.onConnectionChange((connected) => {
        this.store.setConnected(connected);
      })
    );

    // Wire notifications
    this.disposables.push(
      this.client.onNotification((method, params) => {
        this.handleNotification(method, params);
      })
    );
  }

  /**
   * Fetch full state from daemon. Called on initial connect and after reconnect.
   */
  async fetchFullState(): Promise<void> {
    try {
      // Fetch daemon status
      const status = await this.client.call<DaemonStatus>('status');
      this.store.updateDaemonStatus(status);

      // Fetch sessions for current project (or all)
      const result = await this.client.call<{ sessions: SessionSummary[] }>('sessions.list', {
        projectSlug: this.currentProjectSlug,
        limit: 200,
      });
      this.store.updateSessions(result.sessions);

      // Fetch active runs
      const runResult = await this.client.call<{ runs: Run[] }>('run.list');
      for (const run of runResult.runs) {
        this.store.setActiveRun(run);
      }
    } catch {
      // Connection may have dropped during fetch — silently handled by reconnect
    }
  }

  /**
   * Set the current project filter. Refetches sessions.
   */
  async setProject(projectSlug: string | undefined): Promise<void> {
    this.currentProjectSlug = projectSlug;
    if (this.client.connected) {
      await this.fetchFullState();
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private handleNotification(method: string, params: Record<string, unknown> | undefined): void {
    switch (method) {
      case 'index.state_changed':
        if (params) {
          this.store.updateDaemonStatus(params as unknown as DaemonStatus);
          // Refetch sessions when index finishes scanning
          if (params['state'] === 'caught_up') {
            this.fetchFullState().catch(() => {});
          }
        }
        break;

      case 'session.created':
      case 'session.updated':
        // Refetch session list to get the updated data
        this.refetchSessions().catch(() => {});
        break;

      case 'session.deleted':
        // Could extract externalId from params if available
        this.refetchSessions().catch(() => {});
        break;

      case 'run.started':
        if (params) {
          this.store.setActiveRun({
            runId: params['runId'] as string,
            externalId: null,
            provider: 'claude',
            projectPath: '',
            model: null,
            state: 'spawning',
            startedAt: Date.now(),
            completedAt: null,
            error: null,
            usage: null,
          });
        }
        break;

      case 'run.system':
        if (params) {
          const existing = this.store.getActiveRun(params['runId'] as string);
          if (existing) {
            this.store.setActiveRun({
              ...existing,
              externalId: params['externalId'] as string,
              model: params['model'] as string,
              state: 'streaming',
            });
          }
        }
        break;

      case 'run.completed':
        if (params) {
          const runId = params['runId'] as string;
          const externalId = params['externalId'] as string;
          const usage = params['usage'] as Run['usage'];
          if (usage && externalId) {
            this.store.accumulateUsage(externalId, usage);
          }
          this.store.removeActiveRun(runId);
          // Refetch session to get updated message count
          this.refetchSessions().catch(() => {});
        }
        break;

      case 'run.failed':
      case 'run.cancelled':
        if (params) {
          this.store.removeActiveRun(params['runId'] as string);
        }
        break;

      // run.delta, run.block_start, run.block_stop, run.message are handled
      // directly by the webview via postMessage forwarding (Phase 2)
    }
  }

  private async refetchSessions(): Promise<void> {
    try {
      const result = await this.client.call<{ sessions: SessionSummary[] }>('sessions.list', {
        projectSlug: this.currentProjectSlug,
        limit: 200,
      });
      this.store.updateSessions(result.sessions);
    } catch {
      // Ignore — reconnect will handle it
    }
  }
}
