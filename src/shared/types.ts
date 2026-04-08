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
  createdAt: number; // Unix epoch ms
  updatedAt: number; // Unix epoch ms
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

// === Session Metadata (durable, survives reindex) ===

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
  timestamp: number; // Unix epoch ms
  sequence: number;
  blockType: BlockType | null;
}

// === JSONL Content Block (used by parser) ===

export interface JsonlContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  thinking?: string;
}

// === Checkpoint ===

export interface Checkpoint {
  byteOffset: number;
  fileSize: number;
  identity: string | null;
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

export interface SearchOptions {
  query: string;
  projectSlug?: string;
  role?: MessageRole;
  limit?: number;
  offset?: number;
}

// === Protocol ===

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

// Standard JSON-RPC error codes
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom codes
  DAEMON_NOT_READY: -32000,
  SESSION_NOT_FOUND: -32001,
  RUN_NOT_FOUND: -32002,
  RUN_LIMIT_REACHED: -32003,
  CLAUDE_NOT_AVAILABLE: -32004,
  AUTH_REQUIRED: -32005,
  PROFILE_NOT_FOUND: -32006,
  SESSION_BUSY: -32007,
} as const;
