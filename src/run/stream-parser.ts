import { createLogger } from '../shared/logger.js';
import type { RunEvent, RunUsage } from './types.js';

const log = createLogger('stream-parser');

/**
 * Stateful stream parser that buffers tool input deltas and
 * captures tool results across content blocks.
 */
export class StreamParserState {
  // Buffer input_json_delta chunks per block index
  private inputBuffers = new Map<number, string>();
  // Track tool_use_id per block index for matching results
  private toolUseIds = new Map<number, string>();
  // Store completed tool inputs per tool_use_id
  private completedInputs = new Map<string, Record<string, unknown>>();
  // Store tool_use_id → block index mapping for result enrichment
  private toolBlockIndex = new Map<string, number>();

  /**
   * Feed an input_json_delta chunk for a block.
   */
  addInputDelta(blockIndex: number, partialJson: string): void {
    const existing = this.inputBuffers.get(blockIndex) ?? '';
    this.inputBuffers.set(blockIndex, existing + partialJson);
  }

  /**
   * Get the accumulated tool input for a block, parsed as JSON.
   */
  getToolInput(blockIndex: number): Record<string, unknown> | null {
    const buffer = this.inputBuffers.get(blockIndex);
    if (!buffer) return null;
    try {
      return JSON.parse(buffer) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Register a completed tool_use block from the full assistant message.
   */
  registerToolUse(toolUseId: string, blockIndex: number, input: Record<string, unknown>): void {
    this.toolUseIds.set(blockIndex, toolUseId);
    this.completedInputs.set(toolUseId, input);
    this.toolBlockIndex.set(toolUseId, blockIndex);
  }

  /**
   * Get tool result enrichment data for a tool_use_id.
   */
  getToolBlockIndex(toolUseId: string): number | undefined {
    return this.toolBlockIndex.get(toolUseId);
  }

  /**
   * Clean up buffer for a block when it's done.
   */
  clearBlock(blockIndex: number): void {
    this.inputBuffers.delete(blockIndex);
  }

  /**
   * Reset all state (between turns).
   */
  reset(): void {
    this.inputBuffers.clear();
    this.toolUseIds.clear();
    this.completedInputs.clear();
    this.toolBlockIndex.clear();
  }
}

// Auth error patterns — tested against real Claude CLI output.
// The most reliable signal is the "error":"authentication_failed" field
// on assistant messages, but we also check result text for robustness.
const AUTH_ERROR_PATTERNS = [
  /not logged in/i,
  /authentication[_ ](?:failed|required|error)/i,
  /please\s+run\s+.*login/i,
  /token.*(?:expired|invalid|revoked)/i,
  /(?:credentials?\s+(?:not found|invalid|expired|missing)|invalid\s+credentials?)/i,
  /\b401\b.*unauthorized/i,
  /oauth.*(?:error|expired|invalid|failed)/i,
];

/**
 * Check if an error string indicates an authentication problem.
 */
export function isAuthError(errorText: string): boolean {
  return AUTH_ERROR_PATTERNS.some(pattern => pattern.test(errorText));
}

/**
 * Parse a single line of Claude stream-json stdout into RunEvents.
 *
 * Claude outputs newline-delimited JSON when invoked with:
 *   claude -p --output-format stream-json --verbose [--include-partial-messages]
 *
 * Each line is one of: system, assistant, user, stream_event, result, rate_limit_event
 * A single line can produce 0 or more RunEvents.
 */
export function parseStreamLine(runId: string, line: string, state?: StreamParserState): RunEvent[] {
  if (!line.trim()) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    log.warn('Malformed stream-json line', { runId, preview: line.substring(0, 100) });
    return [];
  }

  const type = parsed['type'] as string | undefined;
  if (!type) return [];

  switch (type) {
    case 'system':
      return parseSystemEvent(runId, parsed);
    case 'assistant':
      return parseAssistantEvent(runId, parsed, state);
    case 'user':
      return parseUserEvent(runId, parsed, state);
    case 'stream_event':
      return parseStreamEvent(runId, parsed, state);
    case 'result':
      return parseResultEvent(runId, parsed);
    case 'rate_limit_event':
      return parseRateLimitEvent(runId, parsed);
    default:
      return []; // Ignore unknown types (progress, etc.)
  }
}

function parseSystemEvent(runId: string, event: Record<string, unknown>): RunEvent[] {
  const sessionId = event['session_id'] as string | undefined;
  const model = event['model'] as string | undefined;
  const tools = (event['tools'] ?? []) as string[];
  const mcpServers = ((event['mcp_servers'] ?? []) as Array<Record<string, unknown>>).map(s => ({
    name: s['name'] as string,
    status: s['status'] as string,
  }));

  if (sessionId) {
    return [{
      type: 'run.system',
      runId,
      externalId: sessionId,
      model: model ?? 'unknown',
      tools,
      mcpServers,
    }];
  }
  return [];
}

function parseAssistantEvent(runId: string, event: Record<string, unknown>, state?: StreamParserState): RunEvent[] {
  const message = event['message'] as Record<string, unknown> | undefined;
  if (!message) return [];

  // Check for auth error
  const errorField = event['error'] as string | undefined;
  if (errorField === 'authentication_failed') {
    const content = message['content'];
    const errorText = Array.isArray(content)
      ? (content[0] as Record<string, unknown>)?.['text'] as string ?? 'Not logged in'
      : 'Not logged in';
    return [{
      type: 'run.auth_required',
      runId,
      error: errorText,
    }];
  }

  const content = message['content'];
  if (Array.isArray(content)) {
    // Register tool_use blocks with state for result matching
    if (state) {
      for (let i = 0; i < content.length; i++) {
        const block = content[i] as Record<string, unknown>;
        if (block?.['type'] === 'tool_use' && block['id']) {
          state.registerToolUse(
            block['id'] as string,
            i,
            (block['input'] as Record<string, unknown>) ?? {},
          );
        }
      }
    }
    return [{
      type: 'run.message',
      runId,
      role: 'assistant',
      content: content as unknown[],
    }];
  }
  return [];
}

function parseUserEvent(runId: string, event: Record<string, unknown>, state?: StreamParserState): RunEvent[] {
  const message = event['message'] as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message['content'];
  const events: RunEvent[] = [];

  if (Array.isArray(content)) {
    events.push({
      type: 'run.message',
      runId,
      role: 'user',
      content: content as unknown[],
    });

    // Extract tool results and emit as enriched block_stop events
    if (state) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block?.['type'] === 'tool_result' && block['tool_use_id']) {
          const toolUseId = block['tool_use_id'] as string;
          const blockIndex = state.getToolBlockIndex(toolUseId);
          if (blockIndex !== undefined) {
            const resultContent = block['content'];
            const resultText = typeof resultContent === 'string' ? resultContent
              : Array.isArray(resultContent) ? (resultContent as Array<Record<string, unknown>>).map(b => b['text'] ?? '').join('')
              : String(resultContent ?? '');
            events.push({
              type: 'run.block_stop',
              runId,
              blockIndex,
              toolResult: resultText,
              isError: block['is_error'] === true,
            });
          }
        }
      }
    }
  } else if (typeof content === 'string') {
    events.push({
      type: 'run.message',
      runId,
      role: 'user',
      content: [{ type: 'text', text: content }],
    });
  }

  return events;
}

function parseStreamEvent(runId: string, event: Record<string, unknown>, state?: StreamParserState): RunEvent[] {
  const inner = event['event'] as Record<string, unknown> | undefined;
  if (!inner) return [];

  const eventType = inner['type'] as string | undefined;
  if (!eventType) return [];

  switch (eventType) {
    case 'content_block_start': {
      const index = inner['index'] as number;
      const block = inner['content_block'] as Record<string, unknown> | undefined;
      const blockType = block?.['type'] as string ?? 'text';
      return [{
        type: 'run.block_start' as const,
        runId,
        blockType,
        blockIndex: index,
        ...(blockType === 'tool_use' && block ? {
          toolName: block['name'] as string,
          toolInput: block['input'] as Record<string, unknown>,
        } : {}),
      }];
    }

    case 'content_block_delta': {
      const index = inner['index'] as number;
      const delta = inner['delta'] as Record<string, unknown> | undefined;
      if (!delta) return [];

      const deltaType = delta['type'] as string;
      if (deltaType === 'text_delta' && delta['text']) {
        return [{
          type: 'run.delta',
          runId,
          blockType: 'text',
          delta: delta['text'] as string,
          blockIndex: index,
        }];
      }
      if (deltaType === 'thinking_delta' && delta['thinking']) {
        return [{
          type: 'run.delta',
          runId,
          blockType: 'thinking',
          delta: delta['thinking'] as string,
          blockIndex: index,
        }];
      }
      // Buffer tool input JSON deltas
      if (deltaType === 'input_json_delta' && delta['partial_json'] !== undefined && state) {
        state.addInputDelta(index, delta['partial_json'] as string);
      }
      return [];
    }

    case 'content_block_stop': {
      const index = inner['index'] as number;
      // For tool_use blocks, include the accumulated input
      const toolInput = state?.getToolInput(index);
      state?.clearBlock(index);
      return [{
        type: 'run.block_stop',
        runId,
        blockIndex: index,
        ...(toolInput ? { toolResult: undefined } : {}),
      }];
    }

    // message_start, message_delta, message_stop — absorbed into result
    default:
      return [];
  }
}

function parseResultEvent(runId: string, event: Record<string, unknown>): RunEvent[] {
  const isError = event['is_error'] as boolean;
  const sessionId = event['session_id'] as string | undefined;

  if (isError) {
    const errorResult = event['result'] as string | undefined;
    const errorText = errorResult ?? 'Unknown error';

    // Detect auth errors in result text as a fallback
    // (primary detection is on assistant message "error":"authentication_failed")
    if (isAuthError(errorText)) {
      return [{
        type: 'run.auth_required',
        runId,
        error: errorText,
      }];
    }

    return [{
      type: 'run.failed',
      runId,
      error: errorText,
    }];
  }

  const usage = event['usage'] as Record<string, unknown> | undefined;
  const durationMs = (event['duration_ms'] ?? 0) as number;
  const costUsd = (event['total_cost_usd'] ?? null) as number | null;
  const stopReason = (event['stop_reason'] ?? 'end_turn') as string;

  const runUsage: RunUsage = {
    inputTokens: (usage?.['input_tokens'] ?? 0) as number,
    outputTokens: (usage?.['output_tokens'] ?? 0) as number,
    cacheReadInputTokens: (usage?.['cache_read_input_tokens'] ?? 0) as number,
    cacheCreationInputTokens: (usage?.['cache_creation_input_tokens'] ?? 0) as number,
    costUsd,
    durationMs,
  };

  return [{
    type: 'run.completed',
    runId,
    externalId: sessionId ?? '',
    stopReason,
    usage: runUsage,
  }];
}

function parseRateLimitEvent(runId: string, event: Record<string, unknown>): RunEvent[] {
  const info = event['rate_limit_info'] as Record<string, unknown> | undefined;
  if (!info) return [];

  const resetsAt = info['resetsAt'] as number | undefined;
  const retryAfterMs = resetsAt ? (resetsAt * 1000 - Date.now()) : 60000;

  return [{
    type: 'run.rate_limit',
    runId,
    retryAfterMs: Math.max(0, retryAfterMs),
    rateLimitType: info['rateLimitType'] as string | undefined,
    rateLimitStatus: info['status'] as string | undefined,
    overageStatus: info['overageStatus'] as string | undefined,
  }];
}
