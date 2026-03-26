import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../../state/store.js';
import type { SessionSummary, RunUsage } from '../../protocol/types.js';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 1,
    provider: 'claude',
    externalId: 'ext-1',
    projectSlug: 'test-project',
    title: 'Test Session',
    firstPrompt: 'Hello',
    createdAt: 1000,
    updatedAt: 2000,
    messageCount: 5,
    state: 'active',
    ...overrides,
  };
}

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  describe('connection', () => {
    it('starts disconnected', () => {
      expect(store.connected).toBe(false);
    });

    it('emits on connection change', () => {
      const events: string[] = [];
      store.onChange((aspect) => events.push(aspect));
      store.setConnected(true);
      expect(events).toEqual(['connection']);
    });

    it('does not emit for same state', () => {
      const events: string[] = [];
      store.onChange((aspect) => events.push(aspect));
      store.setConnected(false); // Already false
      expect(events).toEqual([]);
    });

    it('clears active runs on disconnect', () => {
      store.setConnected(true);
      store.setActiveRun({
        runId: 'run-1', externalId: null, provider: 'claude',
        projectPath: '/test', model: null, state: 'streaming',
        startedAt: 1000, completedAt: null, error: null, usage: null,
      });
      expect(store.getActiveRuns()).toHaveLength(1);
      store.setConnected(false);
      expect(store.getActiveRuns()).toHaveLength(0);
    });
  });

  describe('sessions', () => {
    it('starts with empty sessions', () => {
      expect(store.getSessions()).toEqual([]);
    });

    it('stores sessions keyed by externalId', () => {
      store.updateSessions([
        makeSession({ externalId: 'ext-1' }),
        makeSession({ externalId: 'ext-2', title: 'Second' }),
      ]);
      expect(store.getSessions()).toHaveLength(2);
      expect(store.getSession('ext-1')).toBeDefined();
      expect(store.getSession('ext-2')?.title).toBe('Second');
    });

    it('filters by projectSlug', () => {
      store.updateSessions([
        makeSession({ externalId: 'ext-1', projectSlug: 'proj-a' }),
        makeSession({ externalId: 'ext-2', projectSlug: 'proj-b' }),
        makeSession({ externalId: 'ext-3', projectSlug: 'proj-a' }),
      ]);
      expect(store.getSessions('proj-a')).toHaveLength(2);
      expect(store.getSessions('proj-b')).toHaveLength(1);
    });

    it('sorts by updatedAt descending', () => {
      store.updateSessions([
        makeSession({ externalId: 'ext-1', updatedAt: 1000 }),
        makeSession({ externalId: 'ext-2', updatedAt: 3000 }),
        makeSession({ externalId: 'ext-3', updatedAt: 2000 }),
      ]);
      const sorted = store.getSessions();
      expect(sorted.map(s => s.externalId)).toEqual(['ext-2', 'ext-3', 'ext-1']);
    });

    it('updates individual sessions', () => {
      store.updateSessions([makeSession({ externalId: 'ext-1', title: 'Old' })]);
      store.updateSession(makeSession({ externalId: 'ext-1', title: 'New' }));
      expect(store.getSession('ext-1')?.title).toBe('New');
    });

    it('removes sessions', () => {
      store.updateSessions([makeSession({ externalId: 'ext-1' })]);
      store.removeSession('ext-1');
      expect(store.getSessions()).toHaveLength(0);
    });
  });

  describe('usage accumulation', () => {
    const usage1: RunUsage = {
      inputTokens: 100, outputTokens: 50,
      cacheReadInputTokens: 10, cacheCreationInputTokens: 5,
      costUsd: 0.01, durationMs: 1000,
    };

    const usage2: RunUsage = {
      inputTokens: 200, outputTokens: 100,
      cacheReadInputTokens: 20, cacheCreationInputTokens: 10,
      costUsd: 0.02, durationMs: 2000,
    };

    it('stores first usage', () => {
      store.accumulateUsage('ext-1', usage1);
      const stored = store.getSessionUsage('ext-1');
      expect(stored?.inputTokens).toBe(100);
      expect(stored?.costUsd).toBe(0.01);
    });

    it('accumulates across runs', () => {
      store.accumulateUsage('ext-1', usage1);
      store.accumulateUsage('ext-1', usage2);
      const stored = store.getSessionUsage('ext-1');
      expect(stored?.inputTokens).toBe(300);
      expect(stored?.outputTokens).toBe(150);
      expect(stored?.costUsd).toBe(0.03);
      expect(stored?.durationMs).toBe(3000);
    });

    it('tracks per session', () => {
      store.accumulateUsage('ext-1', usage1);
      store.accumulateUsage('ext-2', usage2);
      expect(store.getSessionUsage('ext-1')?.inputTokens).toBe(100);
      expect(store.getSessionUsage('ext-2')?.inputTokens).toBe(200);
    });
  });

  describe('subscriptions', () => {
    it('emits on state changes', () => {
      const events: string[] = [];
      store.onChange((aspect) => events.push(aspect));

      store.setConnected(true);
      store.updateSessions([makeSession()]);
      store.setActiveRun({
        runId: 'run-1', externalId: null, provider: 'claude',
        projectPath: '/test', model: null, state: 'spawning',
        startedAt: 1000, completedAt: null, error: null, usage: null,
      });

      expect(events).toEqual(['connection', 'sessions', 'runs']);
    });

    it('can dispose subscriptions', () => {
      const events: string[] = [];
      const sub = store.onChange((aspect) => events.push(aspect));

      store.setConnected(true);
      sub.dispose();
      store.setConnected(false);

      expect(events).toEqual(['connection']); // Only first event
    });

    it('handles handler errors gracefully', () => {
      store.onChange(() => { throw new Error('boom'); });
      const events: string[] = [];
      store.onChange((aspect) => events.push(aspect));

      store.setConnected(true); // Should not throw
      expect(events).toEqual(['connection']);
    });
  });
});
