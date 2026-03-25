import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseStreamLine } from '../../src/run/stream-parser.js';
import type { RunEvent } from '../../src/run/types.js';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/stream-json');

function parseFixture(filename: string, runId: string = 'test-run'): RunEvent[] {
  const content = fs.readFileSync(path.join(FIXTURES, filename), 'utf-8');
  const events: RunEvent[] = [];
  for (const line of content.split('\n')) {
    events.push(...parseStreamLine(runId, line));
  }
  return events;
}

describe('Stream Parser', () => {
  describe('simple response', () => {
    it('should parse system init event', () => {
      const events = parseFixture('simple-response.ndjson');
      const system = events.find(e => e.type === 'run.system');
      expect(system).toBeTruthy();
      if (system?.type === 'run.system') {
        expect(system.externalId).toBe('stream-test-001');
        expect(system.model).toBe('claude-haiku-4-20250414');
        expect(system.tools).toContain('Read');
      }
    });

    it('should parse text deltas', () => {
      const events = parseFixture('simple-response.ndjson');
      const deltas = events.filter(e => e.type === 'run.delta');
      expect(deltas.length).toBe(2);
      if (deltas[0]?.type === 'run.delta') {
        expect(deltas[0].delta).toBe('Hello');
        expect(deltas[0].blockType).toBe('text');
      }
    });

    it('should parse block start/stop', () => {
      const events = parseFixture('simple-response.ndjson');
      const blockStarts = events.filter(e => e.type === 'run.block_start');
      const blockStops = events.filter(e => e.type === 'run.block_stop');
      expect(blockStarts.length).toBe(1);
      expect(blockStops.length).toBe(1);
    });

    it('should parse full assistant message', () => {
      const events = parseFixture('simple-response.ndjson');
      const messages = events.filter(e => e.type === 'run.message');
      expect(messages.length).toBe(1);
      if (messages[0]?.type === 'run.message') {
        expect(messages[0].role).toBe('assistant');
      }
    });

    it('should parse result/completion', () => {
      const events = parseFixture('simple-response.ndjson');
      const completed = events.find(e => e.type === 'run.completed');
      expect(completed).toBeTruthy();
      if (completed?.type === 'run.completed') {
        expect(completed.externalId).toBe('stream-test-001');
        expect(completed.stopReason).toBe('end_turn');
        expect(completed.usage.durationMs).toBe(1500);
        expect(completed.usage.costUsd).toBe(0.001);
        expect(completed.usage.inputTokens).toBe(100);
        expect(completed.usage.outputTokens).toBe(5);
      }
    });
  });

  describe('tool use', () => {
    it('should parse tool_use block start', () => {
      const events = parseFixture('tool-use.ndjson');
      const toolStart = events.find(
        e => e.type === 'run.block_start' && e.blockType === 'tool_use'
      );
      expect(toolStart).toBeTruthy();
    });

    it('should parse user message with tool results', () => {
      const events = parseFixture('tool-use.ndjson');
      const userMsg = events.find(e => e.type === 'run.message' && e.role === 'user');
      expect(userMsg).toBeTruthy();
    });
  });

  describe('error response', () => {
    it('should parse error result', () => {
      const events = parseFixture('error-response.ndjson');
      const failed = events.find(e => e.type === 'run.failed');
      expect(failed).toBeTruthy();
      if (failed?.type === 'run.failed') {
        expect(failed.error).toContain('Rate limit');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty lines', () => {
      const events = parseStreamLine('test', '');
      expect(events.length).toBe(0);
    });

    it('should handle malformed JSON', () => {
      const events = parseStreamLine('test', 'not json at all');
      expect(events.length).toBe(0);
    });

    it('should handle unknown event types', () => {
      const events = parseStreamLine('test', '{"type":"progress","data":"something"}');
      expect(events.length).toBe(0);
    });

    it('should set runId on all events', () => {
      const events = parseFixture('simple-response.ndjson', 'my-run-id');
      for (const event of events) {
        expect(event.runId).toBe('my-run-id');
      }
    });
  });
});
