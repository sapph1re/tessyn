// Protocol types for the Tessyn VS Code extension.
// Keep in sync with daemon: src/shared/types.ts, src/protocol/types.ts, src/run/types.ts
// Run `npm run sync-types` to regenerate (once script handles all edge cases)

// === Daemon State ===

export type DaemonState = 'cold' | 'scanning' | 'caught_up' | 'degraded';

export interface DaemonStatus {
  state: DaemonState;
  sessionsIndexed: number;
  sessionsTotal: number;
  uptime: number;
  version: string;
  protocolVersion: number;
  capabilities: string[];
}

// === Session Types ===

export interface Session {
  id: number;
  provider: string;
  externalId: string;
  projectSlug: string;
  projectPath: string | null;
  title: string | null;
  firstPrompt: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  jsonlPath: string;
  jsonlByteOffset: number;
  jsonlSize: number;
  jsonlIdentity: string | null;
  gitBranch: string | null;
  gitRemote: string | null;
  state: 'active' | 'deleted';
}

export interface SessionSummary {
  id: number;
  provider: string;
  externalId: string;
  projectSlug: string;
  title: string | null;
  firstPrompt: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  state: 'active' | 'deleted';
}

export interface SessionMeta {
  provider: string;
  externalId: string;
  title: string | null;
  hidden: boolean;
  archived: boolean;
  autoCommit: boolean | null;
  autoBranch: boolean | null;
  autoDocument: boolean | null;
  autoCompact: boolean | null;
  draft: string | null;
  modelOverride: string | null;
  customInstructions: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionToggles {
  autoCommit: boolean | null;
  autoBranch: boolean | null;
  autoDocument: boolean | null;
  autoCompact: boolean | null;
}

// === Message Types ===

export type MessageRole = 'user' | 'assistant' | 'system';
export type BlockType = 'text' | 'tool_use' | 'thinking' | 'tool_result';

export interface Message {
  id: number;
  sessionId: number;
  role: MessageRole;
  content: string;
  toolName: string | null;
  toolInput: string | null;
  timestamp: number;
  sequence: number;
  blockType: BlockType | null;
}

// === Search ===

export interface SearchResult {
  sessionId: number;
  messageId: number;
  content: string;
  role: MessageRole;
  timestamp: number;
  sessionTitle: string | null;
  projectSlug: string;
  rank: number;
}

// === Run Types ===

export type RunState = 'spawning' | 'streaming' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  runId: string;
  externalId: string | null;
  provider: string;
  projectPath: string;
  model: string | null;
  state: RunState;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  usage: RunUsage | null;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number | null;
  durationMs: number;
}

export type RunEvent =
  | RunStartedEvent
  | RunSystemEvent
  | RunDeltaEvent
  | RunBlockStartEvent
  | RunBlockStopEvent
  | RunMessageEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent
  | RunRateLimitEvent;

export interface RunStartedEvent { type: 'run.started'; runId: string; }
export interface RunSystemEvent { type: 'run.system'; runId: string; externalId: string; model: string; tools: string[]; }
export interface RunDeltaEvent { type: 'run.delta'; runId: string; blockType: 'text' | 'thinking'; delta: string; blockIndex: number; }
export interface RunBlockStartEvent { type: 'run.block_start'; runId: string; blockType: string; blockIndex: number; toolName?: string; toolInput?: Record<string, unknown>; }
export interface RunBlockStopEvent { type: 'run.block_stop'; runId: string; blockIndex: number; }
export interface RunMessageEvent { type: 'run.message'; runId: string; role: 'assistant' | 'user'; content: unknown[]; }
export interface RunCompletedEvent { type: 'run.completed'; runId: string; externalId: string; stopReason: string; usage: RunUsage; }
export interface RunFailedEvent { type: 'run.failed'; runId: string; error: string; }
export interface RunCancelledEvent { type: 'run.cancelled'; runId: string; }
export interface RunRateLimitEvent { type: 'run.rate_limit'; runId: string; retryAfterMs: number; }

export interface RunSendParams {
  prompt: string;
  projectPath: string;
  externalId?: string;
  model?: string;
  profile?: string;
  allowedTools?: string[];
}

// === RPC Parameter Types ===

export interface SessionsListParams {
  projectSlug?: string;
  state?: 'active' | 'deleted';
  hidden?: boolean;
  archived?: boolean;
  limit?: number;
  offset?: number;
}

export interface SessionsGetParams {
  id?: number;
  externalId?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}

export interface SearchParams {
  query: string;
  projectSlug?: string;
  role?: 'user' | 'assistant' | 'system';
  limit?: number;
  offset?: number;
}

export interface SessionRenameParams {
  externalId: string;
  provider?: string;
  title: string;
}

export interface SessionHideParams {
  externalId: string;
  provider?: string;
  hidden: boolean;
}

export interface SessionArchiveParams {
  externalId: string;
  provider?: string;
  archived: boolean;
}

// === JSON-RPC 2.0 ===

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  DAEMON_NOT_READY: -32000,
  SESSION_NOT_FOUND: -32001,
  RUN_NOT_FOUND: -32002,
  RUN_LIMIT_REACHED: -32003,
  CLAUDE_NOT_AVAILABLE: -32004,
} as const;
