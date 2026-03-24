import { describe, it, expect } from 'vitest';
import { parseRequest, createResponse, createErrorResponse, createNotification, RPC_ERRORS } from '../../src/protocol/types.js';
import { SubscriptionManager } from '../../src/protocol/events.js';

describe('Protocol', () => {
  describe('parseRequest', () => {
    it('should parse valid JSON-RPC request', () => {
      const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'status' });
      const request = parseRequest(raw);
      expect(request).not.toBeNull();
      expect(request!.method).toBe('status');
      expect(request!.id).toBe(1);
    });

    it('should parse request with params', () => {
      const raw = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'search', params: { query: 'auth' } });
      const request = parseRequest(raw);
      expect(request!.params).toEqual({ query: 'auth' });
    });

    it('should return null for invalid JSON', () => {
      expect(parseRequest('not json')).toBeNull();
    });

    it('should return null for missing jsonrpc field', () => {
      expect(parseRequest(JSON.stringify({ id: 1, method: 'status' }))).toBeNull();
    });

    it('should return null for missing method', () => {
      expect(parseRequest(JSON.stringify({ jsonrpc: '2.0', id: 1 }))).toBeNull();
    });
  });

  describe('createResponse', () => {
    it('should create a valid response', () => {
      const response = createResponse(1, { status: 'ok' });
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toEqual({ status: 'ok' });
      expect(response.error).toBeUndefined();
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response', () => {
      const response = createErrorResponse(1, RPC_ERRORS.METHOD_NOT_FOUND, 'Not found');
      expect(response.error).toBeTruthy();
      expect(response.error!.code).toBe(-32601);
      expect(response.error!.message).toBe('Not found');
    });
  });

  describe('createNotification', () => {
    it('should create a notification without id', () => {
      const notification = createNotification('session.updated', { sessionId: 1 });
      expect(notification.jsonrpc).toBe('2.0');
      expect(notification.method).toBe('session.updated');
      expect(notification.params).toEqual({ sessionId: 1 });
      expect('id' in notification).toBe(false);
    });
  });

  describe('SubscriptionManager', () => {
    it('should track subscriptions', () => {
      const manager = new SubscriptionManager();
      manager.subscribe('client-1', ['session.*']);

      const subs = manager.getSubscribers('session.created');
      expect(subs).toContain('client-1');
    });

    it('should match wildcard patterns', () => {
      const manager = new SubscriptionManager();
      manager.subscribe('client-1', ['session.*']);

      expect(manager.getSubscribers('session.created')).toContain('client-1');
      expect(manager.getSubscribers('session.updated')).toContain('client-1');
      expect(manager.getSubscribers('index.state_changed')).not.toContain('client-1');
    });

    it('should match exact patterns', () => {
      const manager = new SubscriptionManager();
      manager.subscribe('client-1', ['session.created']);

      expect(manager.getSubscribers('session.created')).toContain('client-1');
      expect(manager.getSubscribers('session.updated')).not.toContain('client-1');
    });

    it('should match global wildcard', () => {
      const manager = new SubscriptionManager();
      manager.subscribe('client-1', ['*']);

      expect(manager.getSubscribers('session.created')).toContain('client-1');
      expect(manager.getSubscribers('index.state_changed')).toContain('client-1');
    });

    it('should handle unsubscribe', () => {
      const manager = new SubscriptionManager();
      manager.subscribe('client-1', ['session.*']);
      manager.unsubscribe('client-1', ['session.*']);

      expect(manager.getSubscribers('session.created')).not.toContain('client-1');
    });

    it('should handle removeClient', () => {
      const manager = new SubscriptionManager();
      manager.subscribe('client-1', ['session.*', 'index.*']);
      manager.removeClient('client-1');

      expect(manager.getSubscribers('session.created')).not.toContain('client-1');
    });
  });
});
