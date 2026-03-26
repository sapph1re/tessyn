import type { Disposable } from 'vscode';
import type { DaemonStatus, SessionSummary, Run, RunUsage } from '../protocol/types.js';

export type StoreAspect = 'connection' | 'status' | 'sessions' | 'runs';

type ChangeHandler = (aspect: StoreAspect) => void;

export class StateStore implements Disposable {
  private _connected = false;
  private _daemonStatus: DaemonStatus | null = null;
  private _sessions: Map<string, SessionSummary> = new Map(); // keyed by externalId
  private _activeRuns: Map<string, Run> = new Map(); // keyed by runId
  private _sessionUsage: Map<string, RunUsage> = new Map(); // cumulative per externalId
  private handlers: ChangeHandler[] = [];

  // === Getters ===

  get connected(): boolean { return this._connected; }
  get daemonStatus(): DaemonStatus | null { return this._daemonStatus; }

  getSessions(projectSlug?: string): SessionSummary[] {
    const all = Array.from(this._sessions.values());
    const filtered = projectSlug
      ? all.filter(s => s.projectSlug === projectSlug)
      : all;
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(externalId: string): SessionSummary | undefined {
    return this._sessions.get(externalId);
  }

  getActiveRuns(): Run[] {
    return Array.from(this._activeRuns.values());
  }

  getActiveRun(runId: string): Run | undefined {
    return this._activeRuns.get(runId);
  }

  getSessionUsage(externalId: string): RunUsage | undefined {
    return this._sessionUsage.get(externalId);
  }

  // === Mutations ===

  setConnected(connected: boolean): void {
    if (this._connected === connected) return;
    this._connected = connected;
    if (!connected) {
      this._activeRuns.clear();
    }
    this.emit('connection');
  }

  updateDaemonStatus(status: DaemonStatus): void {
    this._daemonStatus = status;
    this.emit('status');
  }

  updateSessions(sessions: SessionSummary[]): void {
    this._sessions.clear();
    for (const session of sessions) {
      this._sessions.set(session.externalId, session);
    }
    this.emit('sessions');
  }

  updateSession(session: SessionSummary): void {
    this._sessions.set(session.externalId, session);
    this.emit('sessions');
  }

  removeSession(externalId: string): void {
    this._sessions.delete(externalId);
    this.emit('sessions');
  }

  setActiveRun(run: Run): void {
    this._activeRuns.set(run.runId, run);
    this.emit('runs');
  }

  removeActiveRun(runId: string): void {
    this._activeRuns.delete(runId);
    this.emit('runs');
  }

  accumulateUsage(externalId: string, usage: RunUsage): void {
    const existing = this._sessionUsage.get(externalId);
    if (existing) {
      this._sessionUsage.set(externalId, {
        inputTokens: existing.inputTokens + usage.inputTokens,
        outputTokens: existing.outputTokens + usage.outputTokens,
        cacheReadInputTokens: existing.cacheReadInputTokens + usage.cacheReadInputTokens,
        cacheCreationInputTokens: existing.cacheCreationInputTokens + usage.cacheCreationInputTokens,
        costUsd: (existing.costUsd ?? 0) + (usage.costUsd ?? 0),
        durationMs: existing.durationMs + usage.durationMs,
      });
    } else {
      this._sessionUsage.set(externalId, { ...usage });
    }
  }

  // === Subscriptions ===

  onChange(handler: ChangeHandler): Disposable {
    this.handlers.push(handler);
    return {
      dispose: () => {
        const idx = this.handlers.indexOf(handler);
        if (idx >= 0) this.handlers.splice(idx, 1);
      },
    };
  }

  dispose(): void {
    this.handlers = [];
    this._sessions.clear();
    this._activeRuns.clear();
    this._sessionUsage.clear();
  }

  private emit(aspect: StoreAspect): void {
    for (const handler of this.handlers) {
      try {
        handler(aspect);
      } catch {
        // Don't let handler errors propagate
      }
    }
  }
}
