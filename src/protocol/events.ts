import { createNotification, type JsonRpcNotification } from './types.js';

// === Event Types ===

export function sessionCreated(projectSlug: string, sessionFile: string): JsonRpcNotification {
  return createNotification('session.created', { projectSlug, sessionFile });
}

export function sessionUpdated(projectSlug: string, sessionFile: string): JsonRpcNotification {
  return createNotification('session.updated', { projectSlug, sessionFile });
}

export function sessionDeleted(projectSlug: string, sessionFile: string): JsonRpcNotification {
  return createNotification('session.deleted', { projectSlug, sessionFile });
}

export function indexStateChanged(state: string, sessionsIndexed: number, sessionsTotal: number): JsonRpcNotification {
  return createNotification('index.state_changed', { state, sessionsIndexed, sessionsTotal });
}

// === Subscription Manager ===

export class SubscriptionManager {
  private subscriptions = new Map<string, Set<string>>(); // clientId -> Set<topic pattern>

  subscribe(clientId: string, topics: string[]): void {
    let subs = this.subscriptions.get(clientId);
    if (!subs) {
      subs = new Set();
      this.subscriptions.set(clientId, subs);
    }
    for (const topic of topics) {
      subs.add(topic);
    }
  }

  unsubscribe(clientId: string, topics: string[]): void {
    const subs = this.subscriptions.get(clientId);
    if (!subs) return;
    for (const topic of topics) {
      subs.delete(topic);
    }
    if (subs.size === 0) {
      this.subscriptions.delete(clientId);
    }
  }

  removeClient(clientId: string): void {
    this.subscriptions.delete(clientId);
  }

  /**
   * Get all client IDs that are subscribed to a given event method.
   */
  getSubscribers(method: string): string[] {
    const subscribers: string[] = [];
    for (const [clientId, topics] of this.subscriptions) {
      for (const pattern of topics) {
        if (matchTopic(pattern, method)) {
          subscribers.push(clientId);
          break;
        }
      }
    }
    return subscribers;
  }
}

/**
 * Match a topic pattern against an event method.
 * Supports wildcards: 'session.*' matches 'session.created', 'session.updated', etc.
 */
function matchTopic(pattern: string, method: string): boolean {
  if (pattern === '*') return true;
  if (pattern === method) return true;

  // Simple wildcard matching: 'session.*' matches 'session.anything'
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return method.startsWith(prefix + '.');
  }

  return false;
}
