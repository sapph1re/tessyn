// === Content Blocks (matches Anthropic Messages API format) ===

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// === Session Process (persistent per-session Claude process) ===

export interface McpServerInfo {
  name: string;
  status: string;  // "connected", "disconnected", "needs-auth", "error", etc.
}

export interface SessionProcess {
  externalId: string;
  projectPath: string;
  model: string | null;
  profile: string | null;
  configDir: string | null;
  permissionMode: 'default' | 'auto-approve';
  state: 'idle' | 'streaming';
  activeRunId: string | null;
  spawnedAt: number;
  lastActivityAt: number;
  instructionsSent: boolean;
  // MCP data (populated from system init event)
  mcpServers: McpServerInfo[];
  mcpTools: string[];  // full tool names including mcp__* prefix
}

// === Usage Tracking ===

export interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUsd: number;
  }>;
  rateLimit: {
    type: string | null;
    status: string | null;
    resetsAt: number | null;
    overageStatus: string | null;
  };
}

// === Run State Machine ===

export type RunState = 'spawning' | 'streaming' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  runId: string;
  externalId: string | null; // Claude session ID (known after system event)
  provider: string;
  projectPath: string;
  model: string | null;
  profile: string | null;
  configDir: string | null; // resolved config dir for this run
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

// === Run Events (pushed to WebSocket subscribers) ===

export type RunEvent =
  | RunStartedEvent
  | RunSystemEvent
  | RunDeltaEvent
  | RunBlockStartEvent
  | RunBlockStopEvent
  | RunMessageEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunAuthRequiredEvent
  | RunCancelledEvent
  | RunRateLimitEvent;

export interface RunStartedEvent {
  type: 'run.started';
  runId: string;
}

export interface RunSystemEvent {
  type: 'run.system';
  runId: string;
  externalId: string;
  model: string;
  tools: string[];
  mcpServers: McpServerInfo[];
}

export interface RunDeltaEvent {
  type: 'run.delta';
  runId: string;
  blockType: 'text' | 'thinking';
  delta: string;
  blockIndex: number;
}

export interface RunBlockStartEvent {
  type: 'run.block_start';
  runId: string;
  blockType: string;
  blockIndex: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export interface RunBlockStopEvent {
  type: 'run.block_stop';
  runId: string;
  blockIndex: number;
}

export interface RunMessageEvent {
  type: 'run.message';
  runId: string;
  role: 'assistant' | 'user';
  content: unknown[]; // Raw content blocks from Claude
}

export interface RunCompletedEvent {
  type: 'run.completed';
  runId: string;
  externalId: string;
  stopReason: string;
  usage: RunUsage;
}

export interface RunFailedEvent {
  type: 'run.failed';
  runId: string;
  error: string;
}

export interface RunAuthRequiredEvent {
  type: 'run.auth_required';
  runId: string;
  error: string;
  profile?: string;
}

export interface RunCancelledEvent {
  type: 'run.cancelled';
  runId: string;
}

export interface RunRateLimitEvent {
  type: 'run.rate_limit';
  runId: string;
  retryAfterMs: number;
  rateLimitType?: string;
  rateLimitStatus?: string;
  overageStatus?: string;
}

// === Send Parameters ===

export interface RunSendParams {
  prompt?: string;               // Backward compat — converted to text content block
  content?: ContentBlock[];      // Native content blocks (images, text)
  projectPath: string;
  externalId?: string;           // If resuming or sending to existing session
  model?: string;
  profile?: string;
  permissionMode?: 'default' | 'auto-approve';
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max';
  // Spawn-time configuration (used when creating a new session)
  allowedTools?: string[];       // --allowedTools
  disallowedTools?: string[];    // --disallowedTools
  addDirs?: string[];            // --add-dir
  mcpConfig?: string[];          // --mcp-config (file paths or JSON strings)
  agents?: Record<string, unknown>; // --agents (JSON object)
  pluginDirs?: string[];         // --plugin-dir
  systemPromptAppend?: string;   // --append-system-prompt
  maxBudgetUsd?: number;         // --max-budget-usd
  jsonSchema?: string;           // --json-schema (JSON string)
  forkSession?: boolean;         // --fork-session
  continueLastConversation?: boolean; // --continue (instead of --resume)
  sessionName?: string;          // -n / --name
}
