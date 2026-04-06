import { createLogger } from '../shared/logger.js';
import type { RunEvent, RunUsage } from './types.js';

const log = createLogger('stream-parser');

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
export function parseStreamLine(runId: string, line: string): RunEvent[] {
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
      return parseAssistantEvent(runId, parsed);
    case 'user':
      return parseUserEvent(runId, parsed);
    case 'stream_event':
      return parseStreamEvent(runId, parsed);
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

  if (sessionId) {
    return [{
      type: 'run.system',
      runId,
      externalId: sessionId,
      model: model ?? 'unknown',
      tools,
    }];
  }
  return [];
}

function parseAssistantEvent(runId: string, event: Record<string, unknown>): RunEvent[] {
  const message = event['message'] as Record<string, unknown> | undefined;
  if (!message) return [];

  // Check for auth error — Claude CLI sets "error":"authentication_failed" on the
  // assistant message when not logged in. This is the most reliable signal.
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
    return [{
      type: 'run.message',
      runId,
      role: 'assistant',
      content: content as unknown[],
    }];
  }
  return [];
}

function parseUserEvent(runId: string, event: Record<string, unknown>): RunEvent[] {
  const message = event['message'] as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message['content'];
  if (Array.isArray(content) || typeof content === 'string') {
    return [{
      type: 'run.message',
      runId,
      role: 'user',
      content: Array.isArray(content) ? content as unknown[] : [{ type: 'text', text: content }],
    }];
  }
  return [];
}

function parseStreamEvent(runId: string, event: Record<string, unknown>): RunEvent[] {
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
      return [];
    }

    case 'content_block_stop': {
      const index = inner['index'] as number;
      return [{
        type: 'run.block_stop',
        runId,
        blockIndex: index,
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
  }];
}
