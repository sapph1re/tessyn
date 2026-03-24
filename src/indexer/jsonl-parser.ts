import fs from 'node:fs';
import { createLogger } from '../shared/logger.js';
import type { JsonlEvent, JsonlContentBlock } from '../shared/types.js';

const log = createLogger('jsonl-parser');

/**
 * Parsed message extracted from a JSONL event line.
 * One JSONL event can produce multiple ParsedMessages (e.g., an assistant
 * response with both text and tool_use blocks).
 */
export interface ParsedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolName: string | null;
  toolInput: string | null;
  timestamp: number; // Unix epoch ms
  blockType: 'text' | 'tool_use' | 'thinking' | 'tool_result' | null;
  lineNumber: number;
}

/**
 * Result of parsing a JSONL file or portion of a file.
 */
export interface ParseResult {
  messages: ParsedMessage[];
  sessionId: string | null;
  lastByteOffset: number;
  linesProcessed: number;
  linesFailed: number;
}

/**
 * Parse a JSONL file from a given byte offset.
 * Returns parsed messages and the byte offset of the last complete line.
 *
 * Handles:
 * - Both \n and \r\n line endings
 * - Malformed lines (skipped with warning)
 * - Partial trailing lines (ignored — only complete lines processed)
 * - Concurrent reads (opens with read-only, shared access)
 */
export function parseJsonlFile(filePath: string, fromByteOffset: number = 0): ParseResult {
  let fd: number | null = null;
  try {
    // Open read-only. On Windows, this allows concurrent reading while Claude writes.
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;

    if (fromByteOffset >= fileSize) {
      return { messages: [], sessionId: null, lastByteOffset: fromByteOffset, linesProcessed: 0, linesFailed: 0 };
    }

    // Read from offset to end
    const bytesToRead = fileSize - fromByteOffset;
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, fromByteOffset);

    const content = buffer.subarray(0, bytesRead).toString('utf-8');

    // Split into lines. Only process complete lines (ending with \n).
    const lines = content.split('\n');

    // If the content doesn't end with \n, the last element is a partial line — skip it
    const hasTrailingNewline = content.endsWith('\n');
    const completeLines = hasTrailingNewline ? lines.slice(0, -1) : lines.slice(0, -1);

    // Calculate byte offset for the last complete line
    let processedBytes = 0;
    const messages: ParsedMessage[] = [];
    let sessionId: string | null = null;
    let linesProcessed = 0;
    let linesFailed = 0;

    // Count lines already processed (rough estimate from offset for line numbering)
    let lineNumberBase = 0;
    if (fromByteOffset > 0) {
      // We don't know exact line count before offset, use a placeholder
      lineNumberBase = -1; // Will be set per-message
    }

    for (let i = 0; i < completeLines.length; i++) {
      const rawLine = completeLines[i]!;
      const line = rawLine.replace(/\r$/, ''); // Handle \r\n
      const lineBytes = Buffer.byteLength(rawLine + '\n', 'utf-8');
      processedBytes += lineBytes;

      if (line.trim() === '') continue;

      const lineNumber = lineNumberBase >= 0 ? lineNumberBase + i + 1 : i + 1;

      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const parsed = parseEvent(event, lineNumber);

        if (parsed.messages.length > 0) {
          messages.push(...parsed.messages);
        }
        if (parsed.sessionId) {
          sessionId = parsed.sessionId;
        }
        linesProcessed++;
      } catch (err) {
        linesFailed++;
        log.warn('Malformed JSONL line', {
          file: filePath,
          lineNumber,
          error: err instanceof Error ? err.message : String(err),
          linePreview: line.substring(0, 100),
        });
      }
    }

    return {
      messages,
      sessionId,
      lastByteOffset: fromByteOffset + processedBytes,
      linesProcessed,
      linesFailed,
    };
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

interface EventParseResult {
  messages: ParsedMessage[];
  sessionId: string | null;
}

function parseEvent(event: Record<string, unknown>, lineNumber: number): EventParseResult {
  const type = event['type'] as string | undefined;
  const messages: ParsedMessage[] = [];
  let sessionId: string | null = null;

  // Extract timestamp
  const timestamp = parseTimestamp(event['timestamp'] as string | undefined);

  switch (type) {
    case 'user': {
      const msg = event['message'] as Record<string, unknown> | undefined;
      if (msg) {
        const content = extractUserContent(msg);
        if (content) {
          messages.push({
            role: 'user',
            content,
            toolName: null,
            toolInput: null,
            timestamp,
            blockType: 'text',
            lineNumber,
          });
        }
      }
      break;
    }

    case 'assistant': {
      const msg = event['message'] as Record<string, unknown> | undefined;
      if (msg) {
        const contentBlocks = msg['content'];
        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks as JsonlContentBlock[]) {
            const parsed = parseContentBlock(block, timestamp, lineNumber);
            if (parsed) {
              messages.push(parsed);
            }
          }
        } else if (typeof contentBlocks === 'string') {
          messages.push({
            role: 'assistant',
            content: contentBlocks,
            toolName: null,
            toolInput: null,
            timestamp,
            blockType: 'text',
            lineNumber,
          });
        }
      }
      break;
    }

    case 'system': {
      // System messages — may include session init with session_id
      const sid = event['session_id'] as string | undefined;
      if (sid) {
        sessionId = sid;
      }
      const msg = event['message'] as Record<string, unknown> | undefined;
      const summary = (event['summary'] ?? msg?.['content'] ?? msg?.['text']) as string | undefined;
      if (summary && typeof summary === 'string') {
        messages.push({
          role: 'system',
          content: summary,
          toolName: null,
          toolInput: null,
          timestamp,
          blockType: 'text',
          lineNumber,
        });
      }
      break;
    }

    case 'result': {
      // Result events carry session_id
      const sid = event['session_id'] as string | undefined;
      if (sid) {
        sessionId = sid;
      }
      break;
    }

    // Skipped types: progress, file-history-snapshot, queue-operation, pr-link
    default:
      break;
  }

  return { messages, sessionId };
}

function extractUserContent(msg: Record<string, unknown>): string | null {
  const content = msg['content'];
  if (typeof content === 'string') {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    // User content can be an array of blocks
    const textParts: string[] = [];
    for (const block of content as JsonlContentBlock[]) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
    }
    const result = textParts.join('\n').trim();
    return result || null;
  }
  return null;
}

function parseContentBlock(block: JsonlContentBlock, timestamp: number, lineNumber: number): ParsedMessage | null {
  switch (block.type) {
    case 'text':
      if (block.text && block.text.trim()) {
        return {
          role: 'assistant',
          content: block.text,
          toolName: null,
          toolInput: null,
          timestamp,
          blockType: 'text',
          lineNumber,
        };
      }
      return null;

    case 'tool_use':
      return {
        role: 'assistant',
        content: `[Tool: ${block.name ?? 'unknown'}]`,
        toolName: block.name ?? null,
        toolInput: block.input ? JSON.stringify(block.input) : null,
        timestamp,
        blockType: 'tool_use',
        lineNumber,
      };

    case 'thinking':
      if (block.thinking && block.thinking.trim()) {
        return {
          role: 'assistant',
          content: block.thinking,
          toolName: null,
          toolInput: null,
          timestamp,
          blockType: 'thinking',
          lineNumber,
        };
      }
      return null;

    case 'tool_result':
      return {
        role: 'system',
        content: block.text ?? '[Tool result]',
        toolName: null,
        toolInput: null,
        timestamp,
        blockType: 'tool_result',
        lineNumber,
      };

    default:
      return null;
  }
}

function parseTimestamp(ts: string | undefined): number {
  if (!ts) return Date.now();
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? Date.now() : parsed;
}

/**
 * Get the size of a file safely.
 * Returns 0 if the file doesn't exist or can't be read.
 */
export function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
