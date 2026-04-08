import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { parseStreamLine, isAuthError } from './stream-parser.js';
import { buildInstructions } from './instructions.js';
import path from 'node:path';
import { indexSession } from '../indexer/index.js';
import { computeProjectSlug } from '../indexer/session-discovery.js';
import { getClaudeProjectsDir } from '../platform/paths.js';
import { resolveConfigDir } from '../platform/profiles.js';
import * as queries from '../db/queries.js';
import type { Run, RunEvent, RunSendParams, SessionProcess, ContentBlock } from './types.js';

const log = createLogger('run-manager');

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface ActiveSession {
  session: SessionProcess;
  process: ChildProcess;
  stderrBuffer: string;
  cancelledRunId: string | null;  // Track cancelled run to drop stale events
  lastRun: Run | null;            // Last completed/failed run for run.get backward compat
}

type RunEventCallback = (event: RunEvent) => void;

export interface RunManagerOptions {
  idleTimeoutMs?: number;
}

/**
 * Manages persistent per-session Claude Code processes.
 *
 * Each session (identified by externalId) has one long-lived Claude process.
 * Messages are written to stdin as JSON content blocks; responses stream on stdout.
 * Processes are reused across multiple messages within the same session.
 */
export class RunManager {
  private sessions = new Map<string, ActiveSession>();
  private runs = new Map<string, string>(); // runId → externalId
  private idleTimers = new Map<string, NodeJS.Timeout>();
  private listeners: RunEventCallback[] = [];
  private maxConcurrent: number;
  private idleTimeoutMs: number;
  private db: Database.Database;

  constructor(db: Database.Database, options?: RunManagerOptions) {
    this.db = db;
    const envMax = process.env['TESSYN_MAX_CONCURRENT_RUNS'];
    this.maxConcurrent = envMax ? parseInt(envMax, 10) || DEFAULT_MAX_CONCURRENT : DEFAULT_MAX_CONCURRENT;
    const envTimeout = parseInt(process.env['TESSYN_SESSION_IDLE_TIMEOUT'] ?? '', 10);
    this.idleTimeoutMs = options?.idleTimeoutMs ?? (envTimeout > 0 ? envTimeout : DEFAULT_IDLE_TIMEOUT_MS);
  }

  onEvent(callback: RunEventCallback): () => void {
    this.listeners.push(callback);
    return () => { this.listeners = this.listeners.filter(l => l !== callback); };
  }

  private emit(event: RunEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch (err) {
        log.error('Run event listener error', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // === Public API ===

  /**
   * Send a message to a session. Reuses existing process or spawns a new one.
   * Returns runId immediately; events stream via onEvent().
   */
  async send(params: RunSendParams): Promise<string> {
    // Normalize content blocks
    const content = this.normalizeContent(params);
    const runId = crypto.randomUUID();
    const now = Date.now();

    // Check if we have an existing session process
    const existingSession = params.externalId ? this.sessions.get(params.externalId) : null;

    if (existingSession && !existingSession.process.killed) {
      // Reuse existing process
      return this.sendToExistingSession(existingSession, content, runId, params);
    }

    // Spawn new process
    if (this.sessions.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent sessions (${this.maxConcurrent}) reached`);
    }

    return this.spawnAndSend(content, runId, params, now);
  }

  /**
   * Cancel an active run. Sends SIGINT to interrupt the current turn.
   * The process stays alive for future messages.
   */
  cancel(runId: string): boolean {
    const externalId = this.runs.get(runId);
    if (!externalId) return false;

    const active = this.sessions.get(externalId);
    if (!active || active.session.activeRunId !== runId) return false;

    log.info('Cancelling run', { runId, externalId });

    // Track the cancelled runId so stdout handler drops stale events from this turn.
    // Don't mark idle yet — wait for the result/exit event from the interrupted turn.
    active.cancelledRunId = runId;
    active.session.activeRunId = null;
    active.session.state = 'idle';
    active.session.lastActivityAt = Date.now();
    this.runs.delete(runId);
    this.emit({ type: 'run.cancelled', runId });
    this.startIdleTimer(externalId);

    active.process.kill('SIGINT');

    return true;
  }

  /**
   * Close a session — kill the process and clean up.
   */
  closeSession(externalId: string): boolean {
    const active = this.sessions.get(externalId);
    if (!active) return false;

    log.info('Closing session', { externalId });
    const runId = active.session.activeRunId;
    // Clear state BEFORE killing so exit handler doesn't double-emit
    active.session.activeRunId = null;
    active.session.state = 'idle';
    if (runId) {
      this.runs.delete(runId);
      this.emit({ type: 'run.cancelled', runId });
    }
    active.process.kill('SIGTERM');
    this.cleanupSession(externalId);
    return true;
  }

  /**
   * Create a session (spawn process) without sending a message.
   */
  async createSession(params: Omit<RunSendParams, 'prompt' | 'content'> & { projectPath: string }): Promise<string> {
    // Check for duplicate — don't spawn a second process for same externalId
    if (params.externalId && this.sessions.has(params.externalId)) {
      return params.externalId; // Already running
    }
    if (this.sessions.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent sessions (${this.maxConcurrent}) reached`);
    }

    const now = Date.now();
    const resolvedConfigDir = params.profile ? resolveConfigDir(params.profile) : null;
    if (params.profile && !resolvedConfigDir) {
      throw new Error(`Profile not found: ${params.profile}`);
    }

    const args = this.buildSpawnArgs(params);
    const env = this.buildEnv(resolvedConfigDir);
    const proc = this.spawnProcess(args, params.projectPath, env);

    // Register session immediately with the provided externalId or a generated one.
    // The Claude CLI only emits the system event after the first message, not on spawn.
    // The stdout handler will update model/tools when the system event eventually arrives.
    const externalId = params.externalId ?? crypto.randomUUID();

    const session: SessionProcess = {
      externalId,
      projectPath: params.projectPath,
      model: params.model ?? null,
      profile: params.profile ?? null,
      configDir: resolvedConfigDir,
      permissionMode: params.permissionMode ?? 'default',
      state: 'idle',
      activeRunId: null,
      spawnedAt: now,
      lastActivityAt: now,
      instructionsSent: false,
    };

    const activeSession: ActiveSession = { session, process: proc, stderrBuffer: '', cancelledRunId: null, lastRun: null };
    this.sessions.set(externalId, activeSession);
    this.setupStdoutHandler(activeSession, 'create');
    this.setupStderrHandler(activeSession);
    this.setupExitHandler(activeSession);
    this.startIdleTimer(externalId);

    log.info('Session created', { externalId, projectPath: params.projectPath });
    return externalId;
  }

  getRun(runId: string): Run | null {
    // Check active runs first
    const externalId = this.runs.get(runId);
    if (externalId) {
      const active = this.sessions.get(externalId);
      if (active) return this.buildRunFromSession(active.session, runId);
    }
    // Check last completed run on any session
    for (const active of this.sessions.values()) {
      if (active.lastRun?.runId === runId) return active.lastRun;
    }
    return null;
  }

  getActiveRuns(): Run[] {
    const runs: Run[] = [];
    for (const active of this.sessions.values()) {
      if (active.session.activeRunId) {
        runs.push(this.buildRunFromSession(active.session, active.session.activeRunId));
      }
    }
    return runs;
  }

  getActiveSessions(): SessionProcess[] {
    return Array.from(this.sessions.values()).map(a => a.session);
  }

  cancelAll(): void {
    for (const active of this.sessions.values()) {
      if (active.session.activeRunId) {
        this.emit({ type: 'run.cancelled', runId: active.session.activeRunId });
      }
      active.process.kill('SIGTERM');
    }
    this.sessions.clear();
    this.runs.clear();
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
  }

  // === Private Methods ===

  private normalizeContent(params: RunSendParams): ContentBlock[] {
    if (params.content && params.content.length > 0) {
      return params.content;
    }
    if (params.prompt) {
      return [{ type: 'text', text: params.prompt }];
    }
    throw new Error('Either prompt or content is required');
  }

  private sendToExistingSession(
    active: ActiveSession,
    content: ContentBlock[],
    runId: string,
    _params: RunSendParams,
  ): string {
    const { session } = active;

    if (session.state === 'streaming') {
      throw new Error(`Session busy: ${session.externalId}`);
    }

    session.state = 'streaming';
    session.activeRunId = runId;
    this.runs.set(runId, session.externalId);
    this.clearIdleTimer(session.externalId);

    this.emit({ type: 'run.started', runId });
    this.writeMessage(active, content);

    log.info('Message sent to existing session', { runId, externalId: session.externalId });
    return runId;
  }

  private async spawnAndSend(
    content: ContentBlock[],
    runId: string,
    params: RunSendParams,
    now: number,
  ): Promise<string> {
    const resolvedConfigDir = params.profile ? resolveConfigDir(params.profile) : null;
    if (params.profile && !resolvedConfigDir) {
      throw new Error(`Profile not found: ${params.profile}`);
    }

    // Build instructions for first message
    let contentWithInstructions = content;
    if (params.externalId) {
      const toggles = queries.getSessionToggles(this.db, 'claude', params.externalId);
      const meta = queries.getSessionMeta(this.db, 'claude', params.externalId);
      const instructions = buildInstructions(toggles, meta?.customInstructions);
      if (instructions && content.length > 0 && content[0]!.type === 'text') {
        contentWithInstructions = [
          { type: 'text', text: content[0]!.text + instructions },
          ...content.slice(1),
        ];
      }
    }

    const args = this.buildSpawnArgs(params);
    const env = this.buildEnv(resolvedConfigDir);
    const proc = this.spawnProcess(args, params.projectPath, env);

    // Temporary key until system event gives us externalId
    const tempKey = params.externalId ?? `pending-${runId}`;
    const session: SessionProcess = {
      externalId: tempKey,
      projectPath: params.projectPath,
      model: params.model ?? null,
      profile: params.profile ?? null,
      configDir: resolvedConfigDir,
      permissionMode: params.permissionMode ?? 'default',
      state: 'streaming',
      activeRunId: runId,
      spawnedAt: now,
      lastActivityAt: now,
      instructionsSent: true,
    };

    const active: ActiveSession = { session, process: proc, stderrBuffer: '', cancelledRunId: null, lastRun: null };
    this.sessions.set(tempKey, active);
    this.runs.set(runId, tempKey);

    this.emit({ type: 'run.started', runId });

    // Set up stdout/stderr handlers
    this.setupStdoutHandler(active, runId);
    this.setupStderrHandler(active);
    this.setupExitHandler(active);

    // Write the first user message
    this.writeMessage(active, contentWithInstructions);

    log.info('New session spawned', { runId, tempKey, projectPath: params.projectPath });
    return runId;
  }

  private buildSpawnArgs(params: Partial<RunSendParams>): string[] {
    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    // Session identity
    if (params.continueLastConversation) {
      args.push('--continue');
    } else if (params.externalId) {
      args.push('--resume', params.externalId);
    }
    if (params.forkSession) {
      args.push('--fork-session');
    }
    if (params.sessionName) {
      args.push('--name', params.sessionName);
    }

    // Model and reasoning
    if (params.model) {
      args.push('--model', params.model);
    }
    if (params.reasoningEffort) {
      args.push('--effort', params.reasoningEffort);
    }

    // Permissions
    if (params.permissionMode === 'auto-approve') {
      args.push('--dangerously-skip-permissions');
    }

    // Tool restrictions
    if (params.allowedTools && params.allowedTools.length > 0) {
      args.push('--allowedTools', ...params.allowedTools);
    }
    if (params.disallowedTools && params.disallowedTools.length > 0) {
      args.push('--disallowedTools', ...params.disallowedTools);
    }

    // Additional directories
    if (params.addDirs && params.addDirs.length > 0) {
      args.push('--add-dir', ...params.addDirs);
    }

    // MCP servers
    if (params.mcpConfig && params.mcpConfig.length > 0) {
      args.push('--mcp-config', ...params.mcpConfig);
    }

    // Custom agents
    if (params.agents && Object.keys(params.agents).length > 0) {
      args.push('--agents', JSON.stringify(params.agents));
    }

    // Plugin directories
    if (params.pluginDirs && params.pluginDirs.length > 0) {
      for (const dir of params.pluginDirs) {
        args.push('--plugin-dir', dir);
      }
    }

    // System prompt
    if (params.systemPromptAppend) {
      args.push('--append-system-prompt', params.systemPromptAppend);
    }

    // Budget limit
    if (params.maxBudgetUsd !== undefined && params.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', String(params.maxBudgetUsd));
    }

    // Structured output
    if (params.jsonSchema) {
      args.push('--json-schema', params.jsonSchema);
    }

    return args;
  }

  private buildEnv(resolvedConfigDir: string | null): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env['CLAUDECODE'];
    if (resolvedConfigDir) {
      env['CLAUDE_CONFIG_DIR'] = resolvedConfigDir;
    }
    return env;
  }

  private spawnProcess(args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
    return spawn('claude', args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'], // stdin: pipe (NOT ignore!)
      shell: process.platform === 'win32',
    });
  }

  private writeMessage(active: ActiveSession, content: ContentBlock[]): void {
    const message = {
      type: 'user',
      message: { role: 'user', content },
    };
    const line = JSON.stringify(message) + '\n';
    active.process.stdin?.write(line, 'utf-8', (err) => {
      if (err) {
        const runId = active.session.activeRunId;
        // Clear state BEFORE cleanup so exit handler doesn't double-emit
        active.session.activeRunId = null;
        active.session.state = 'idle';
        if (runId) {
          this.runs.delete(runId);
          this.emit({ type: 'run.failed', runId, error: `stdin write failed: ${err.message}` });
        }
        this.cleanupSession(active.session.externalId);
      }
    });
  }

  private setupStdoutHandler(active: ActiveSession, initialRunId: string): void {
    let stdoutBuffer = '';
    active.process.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      let newlineIdx: number;
      while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.substring(0, newlineIdx);
        stdoutBuffer = stdoutBuffer.substring(newlineIdx + 1);

        // Use the current activeRunId (may change across turns)
        const runId = active.session.activeRunId ?? initialRunId;
        const events = parseStreamLine(runId, line);

        for (const event of events) {
          // Drop stale events from a cancelled run (trailing output after SIGINT)
          if (active.cancelledRunId && event.runId === active.cancelledRunId) {
            // Clear the cancelled marker on terminal events
            if (event.type === 'run.completed' || event.type === 'run.failed') {
              active.cancelledRunId = null;
            }
            continue; // Don't emit — this event belongs to the cancelled turn
          }
          // Capture externalId from system event (first message only)
          if (event.type === 'run.system') {
            const newExternalId = event.externalId;
            const oldKey = active.session.externalId;

            if (oldKey !== newExternalId) {
              // Re-key the session in the map
              this.sessions.delete(oldKey);
              active.session.externalId = newExternalId;
              this.sessions.set(newExternalId, active);
              // Update runs map
              if (active.session.activeRunId) {
                this.runs.set(active.session.activeRunId, newExternalId);
              }
            }
            active.session.model = event.model;
          }

          // Handle turn completion
          if (event.type === 'run.completed') {
            this.handleTurnComplete(active, event);
          }
          if (event.type === 'run.failed' || event.type === 'run.auth_required') {
            this.handleTurnFailed(active, event);
          }

          this.emit(event);
        }
      }
    });
  }

  private setupStderrHandler(active: ActiveSession): void {
    active.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      active.stderrBuffer += text;
      log.debug('Claude stderr', { externalId: active.session.externalId, data: text.substring(0, 200) });
    });
  }

  private setupExitHandler(active: ActiveSession): void {
    active.process.on('exit', (code, signal) => {
      const runId = active.session.activeRunId;
      const externalId = active.session.externalId;

      if (runId && active.session.state === 'streaming') {
        // Process died while streaming — emit failure
        if (isAuthError(active.stderrBuffer)) {
          this.emit({ type: 'run.auth_required', runId, error: active.stderrBuffer.trim() || 'Authentication failed' });
        } else {
          this.emit({ type: 'run.failed', runId, error: `Process exited unexpectedly (code ${code}, signal ${signal})` });
        }
      }

      log.info('Session process exited', { externalId, code, signal });
      this.cleanupSession(externalId);
    });

    active.process.on('error', (err) => {
      const runId = active.session.activeRunId;
      if (runId) {
        this.emit({ type: 'run.failed', runId, error: err.message });
      }
      log.error('Session process error', { externalId: active.session.externalId, error: err.message });
      this.cleanupSession(active.session.externalId);
    });
  }

  private handleTurnComplete(active: ActiveSession, event: RunEvent & { type: 'run.completed' }): void {
    const runId = active.session.activeRunId;

    // Save last run for run.get backward compat
    if (runId) {
      active.lastRun = {
        ...this.buildRunFromSession(active.session, runId),
        state: 'completed',
        completedAt: Date.now(),
        usage: event.usage,
      };
    }

    active.session.state = 'idle';
    active.session.activeRunId = null;
    active.session.lastActivityAt = Date.now();
    if (runId) this.runs.delete(runId);

    // Reindex the session's JSONL
    const eid = active.session.externalId;
    if (eid && active.session.projectPath) {
      try {
        const slug = computeProjectSlug(active.session.projectPath);
        const projectsDir = active.session.configDir
          ? path.join(active.session.configDir, 'projects')
          : getClaudeProjectsDir();
        const jsonlPath = path.join(projectsDir, slug, `${eid}.jsonl`);
        indexSession(this.db, jsonlPath, slug);
      } catch (err) {
        log.warn('Post-turn reindex failed', { externalId: eid, error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.startIdleTimer(active.session.externalId);
  }

  private handleTurnFailed(active: ActiveSession, event: RunEvent & { type: 'run.failed' | 'run.auth_required' }): void {
    const runId = active.session.activeRunId;
    active.session.state = 'idle';
    active.session.activeRunId = null;
    active.session.lastActivityAt = Date.now();
    if (runId) this.runs.delete(runId);

    // For auth errors, kill the process — it's unrecoverable
    if (event.type === 'run.auth_required') {
      this.cleanupSession(active.session.externalId);
      return;
    }

    this.startIdleTimer(active.session.externalId);
  }

  private startIdleTimer(externalId: string): void {
    this.clearIdleTimer(externalId);
    const timer = setTimeout(() => {
      const active = this.sessions.get(externalId);
      if (active && active.session.state === 'idle') {
        log.info('Idle timeout, closing session', { externalId });
        this.closeSession(externalId);
      }
    }, this.idleTimeoutMs);
    timer.unref();
    this.idleTimers.set(externalId, timer);
  }

  private clearIdleTimer(externalId: string): void {
    const timer = this.idleTimers.get(externalId);
    if (timer) { clearTimeout(timer); this.idleTimers.delete(externalId); }
  }

  private cleanupSession(externalId: string): void {
    const active = this.sessions.get(externalId);
    if (active) {
      if (active.session.activeRunId) {
        this.runs.delete(active.session.activeRunId);
      }
      if (!active.process.killed) {
        active.process.kill('SIGTERM');
      }
    }
    this.sessions.delete(externalId);
    this.clearIdleTimer(externalId);
  }

  private buildRunFromSession(session: SessionProcess, runId: string): Run {
    return {
      runId,
      externalId: session.externalId,
      provider: 'claude',
      projectPath: session.projectPath,
      model: session.model,
      profile: session.profile,
      configDir: session.configDir,
      state: session.state === 'streaming' ? 'streaming' : 'completed',
      startedAt: session.spawnedAt,
      completedAt: session.state === 'idle' ? session.lastActivityAt : null,
      error: null,
      usage: null,
    };
  }
}
