import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isAuthError, parseStreamLine } from '../../src/run/stream-parser.js';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/stream-json');

describe('Auth Error Detection', () => {
  describe('isAuthError', () => {
    it('should detect "Not logged in" messages', () => {
      expect(isAuthError('Not logged in · Please run /login')).toBe(true);
      expect(isAuthError('not logged in')).toBe(true);
    });

    it('should detect authentication_failed', () => {
      expect(isAuthError('authentication_failed')).toBe(true);
      expect(isAuthError('Authentication failed')).toBe(true);
    });

    it('should detect token errors', () => {
      expect(isAuthError('OAuth token has expired')).toBe(true);
      expect(isAuthError('Token expired. Please re-authenticate.')).toBe(true);
      expect(isAuthError('token revoked')).toBe(true);
    });

    it('should detect credential errors', () => {
      expect(isAuthError('credentials not found')).toBe(true);
      expect(isAuthError('Invalid credentials')).toBe(true);
    });

    it('should detect login prompts', () => {
      expect(isAuthError('Please run claude login')).toBe(true);
      expect(isAuthError('please run /login')).toBe(true);
    });

    it('should detect 401 errors', () => {
      expect(isAuthError('401 Unauthorized')).toBe(true);
    });

    it('should NOT match non-auth errors', () => {
      expect(isAuthError('Rate limit exceeded')).toBe(false);
      expect(isAuthError('Connection timeout')).toBe(false);
      expect(isAuthError('File not found')).toBe(false);
      expect(isAuthError('Internal server error')).toBe(false);
      expect(isAuthError('Unknown error')).toBe(false);
    });
  });

  describe('parseStreamLine with auth errors', () => {
    it('should parse auth error fixture into run.auth_required events', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'auth-error.ndjson'), 'utf-8');
      const allEvents = content.split('\n')
        .filter(l => l.trim())
        .flatMap(line => parseStreamLine('test-run', line));

      const authEvents = allEvents.filter(e => e.type === 'run.auth_required');
      expect(authEvents.length).toBeGreaterThanOrEqual(1);

      const first = authEvents[0]!;
      if (first.type === 'run.auth_required') {
        expect(first.error).toContain('Not logged in');
        expect(first.runId).toBe('test-run');
      }
    });

    it('should detect auth error on assistant message with error field', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Not logged in' }] },
        error: 'authentication_failed',
      });
      const events = parseStreamLine('run1', line);
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('run.auth_required');
    });

    it('should detect auth error in result event', () => {
      const line = JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Not logged in · Please run /login',
        session_id: 'test',
      });
      const events = parseStreamLine('run1', line);
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('run.auth_required');
    });

    it('should NOT detect auth error for normal failures', () => {
      const line = JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Rate limit exceeded',
        session_id: 'test',
      });
      const events = parseStreamLine('run1', line);
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('run.failed');
    });
  });
});
