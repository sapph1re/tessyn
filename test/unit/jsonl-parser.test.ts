import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseJsonlFile } from '../../src/indexer/jsonl-parser.js';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/conversations');

describe('JSONL Parser', () => {
  describe('simple chat', () => {
    it('should parse user and assistant messages', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'simple-chat.jsonl'));
      expect(result.messages.length).toBeGreaterThan(0);

      const userMessages = result.messages.filter(m => m.role === 'user');
      const assistantMessages = result.messages.filter(m => m.role === 'assistant');

      expect(userMessages.length).toBe(2);
      expect(assistantMessages.length).toBe(2);
      expect(userMessages[0]!.content).toContain('auth module');
    });

    it('should extract session ID', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'simple-chat.jsonl'));
      expect(result.sessionId).toBe('test-session-001');
    });

    it('should parse timestamps correctly', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'simple-chat.jsonl'));
      const firstMessage = result.messages[0]!;
      // System message content = "Session started"
      const firstUser = result.messages.find(m => m.role === 'user')!;
      expect(firstUser.timestamp).toBe(new Date('2025-01-15T10:00:05Z').getTime());
    });
  });

  describe('multi-turn with tools', () => {
    it('should parse tool_use blocks', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'multi-turn-with-tools.jsonl'));
      const toolMessages = result.messages.filter(m => m.blockType === 'tool_use');
      expect(toolMessages.length).toBeGreaterThan(0);
      expect(toolMessages[0]!.toolName).toBe('Read');
    });

    it('should parse tool_result blocks', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'multi-turn-with-tools.jsonl'));
      const toolResults = result.messages.filter(m => m.blockType === 'tool_result');
      expect(toolResults.length).toBeGreaterThan(0);
    });

    it('should preserve tool input as JSON', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'multi-turn-with-tools.jsonl'));
      const readTool = result.messages.find(m => m.toolName === 'Read')!;
      expect(readTool.toolInput).toBeTruthy();
      const input = JSON.parse(readTool.toolInput!);
      expect(input.file_path).toBe('src/utils.ts');
    });
  });

  describe('thinking blocks', () => {
    it('should parse thinking blocks', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'thinking-blocks.jsonl'));
      const thinkingMessages = result.messages.filter(m => m.blockType === 'thinking');
      expect(thinkingMessages.length).toBe(1);
      expect(thinkingMessages[0]!.content).toContain('trade-offs');
    });
  });

  describe('malformed lines', () => {
    it('should skip malformed lines and continue parsing', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'malformed-lines.jsonl'));
      expect(result.linesFailed).toBe(2); // "this is not valid json at all" and "{truncated json"
      expect(result.messages.length).toBeGreaterThan(0);

      const userMessages = result.messages.filter(m => m.role === 'user');
      expect(userMessages.length).toBe(2);
      expect(userMessages[1]!.content).toContain('Second message');
    });
  });

  describe('mixed line endings', () => {
    it('should handle CRLF line endings', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'mixed-line-endings.jsonl'));
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.linesFailed).toBe(0);
    });
  });

  describe('empty file', () => {
    it('should return empty result for empty file', () => {
      const result = parseJsonlFile(path.join(FIXTURES, 'empty.jsonl'));
      expect(result.messages.length).toBe(0);
      expect(result.sessionId).toBeNull();
    });
  });

  describe('incremental parsing', () => {
    it('should parse from byte offset', () => {
      const filePath = path.join(FIXTURES, 'simple-chat.jsonl');

      // First parse: get all messages
      const fullResult = parseJsonlFile(filePath, 0);
      expect(fullResult.messages.length).toBeGreaterThan(0);

      // Parse from the end: should get nothing new
      const noNewResult = parseJsonlFile(filePath, fullResult.lastByteOffset);
      expect(noNewResult.messages.length).toBe(0);

      // Parse from middle: should get remaining messages
      // Find a byte offset that's partway through the file
      const midOffset = Math.floor(fullResult.lastByteOffset / 2);
      const partialResult = parseJsonlFile(filePath, midOffset);
      // Should have fewer messages than full parse
      expect(partialResult.messages.length).toBeLessThan(fullResult.messages.length);
    });
  });
});
