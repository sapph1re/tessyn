// === Run State Machine ===

export type RunState = 'spawning' | 'streaming' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  runId: string;
  externalId: string | null; // Claude session ID (known after system event)
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

export interface RunCancelledEvent {
  type: 'run.cancelled';
  runId: string;
}

export interface RunRateLimitEvent {
  type: 'run.rate_limit';
  runId: string;
  retryAfterMs: number;
}

// === Send Parameters ===

export interface RunSendParams {
  prompt: string;
  projectPath: string;
  externalId?: string;  // If resuming an existing session
  model?: string;
  profile?: string;
  allowedTools?: string[];
}
