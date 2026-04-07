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
import type { Run, RunEvent, RunSendParams } from './types.js';

const log = createLogger('run-manager');

const DEFAULT_MAX_CONCURRENT = 3;

interface ActiveRun {
  run: Run;
  process: ChildProcess;
}

type RunEventCallback = (event: RunEvent) => void;

/**
 * Manages Claude Code subprocess lifecycles.
 * Spawns `claude -p`, streams events, handles cancel.
 */
export class RunManager {
  private runs = new Map<string, ActiveRun>();
  private listeners: RunEventCallback[] = [];
  private maxConcurrent: number;
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    const envMax = process.env['TESSYN_MAX_CONCURRENT_RUNS'];
    this.maxConcurrent = envMax ? parseInt(envMax, 10) || DEFAULT_MAX_CONCURRENT : DEFAULT_MAX_CONCURRENT;
  }

  /**
   * Subscribe to run events. Returns unsubscribe function.
   */
  onEvent(callback: RunEventCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private emit(event: RunEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        log.error('Run event listener error', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /**
   * Spawn a new Claude session.
   * Returns the runId immediately. Events stream via onEvent().
   */
  async send(params: RunSendParams): Promise<string> {
    if (this.runs.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent runs (${this.maxConcurrent}) reached`);
    }

    const runId = crypto.randomUUID();
    const now = Date.now();

    // Load toggles if resuming an existing session
    let appendInstructions: string | null = null;
    if (params.externalId) {
      const toggles = queries.getSessionToggles(this.db, 'claude', params.externalId);
      const meta = queries.getSessionMeta(this.db, 'claude', params.externalId);
      appendInstructions = buildInstructions(toggles, meta?.customInstructions);
    }

    // Build the prompt with optional instructions
    let prompt = params.prompt;
    if (appendInstructions) {
      prompt += appendInstructions;
    }

    // Build CLI args
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (params.externalId) {
      args.push('--resume', params.externalId);
    }
    if (params.model) {
      args.push('--model', params.model);
    }
    if (params.permissionMode === 'auto-approve') {
      args.push('--dangerously-skip-permissions');
    }
    if (params.reasoningEffort) {
      args.push('--effort', params.reasoningEffort);
    }

    // Resolve profile to config directory
    let resolvedConfigDir: string | null = null;
    if (params.profile) {
      resolvedConfigDir = resolveConfigDir(params.profile);
      if (!resolvedConfigDir) {
        throw new Error(`Profile not found: ${params.profile}`);
      }
    }

    const run: Run = {
      runId,
      externalId: params.externalId ?? null,
      provider: 'claude',
      projectPath: params.projectPath,
      model: params.model ?? null,
      profile: params.profile ?? null,
      configDir: resolvedConfigDir,
      state: 'spawning',
      startedAt: now,
      completedAt: null,
      error: null,
      usage: null,
    };

    // Emit started event
    this.emit({ type: 'run.started', runId });

    // Spawn the process
    const env = { ...process.env };
    // Prevent Claude from refusing to run inside another Claude
    delete env['CLAUDECODE'];
    // Set profile-specific config directory
    if (resolvedConfigDir) {
      env['CLAUDE_CONFIG_DIR'] = resolvedConfigDir;
    }

    // On Windows, spawn with shell:true so .cmd shims work
    // (shell:true is safe here because args are passed as an array, not a string)
    const proc = spawn('claude', args, {
      cwd: params.projectPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const activeRun: ActiveRun = { run, process: proc };
    this.runs.set(runId, activeRun);

    run.state = 'streaming';

    // Parse stdout line by line
    let stdoutBuffer = '';
    proc.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      let newlineIdx: number;
      while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.substring(0, newlineIdx);
        stdoutBuffer = stdoutBuffer.substring(newlineIdx + 1);

        const events = parseStreamLine(runId, line);
        for (const event of events) {
          // Capture external ID from system event
          if (event.type === 'run.system') {
            run.externalId = event.externalId;
            run.model = event.model;
          }
          // Capture completion data
          if (event.type === 'run.completed') {
            run.state = 'completed';
            run.completedAt = Date.now();
            run.usage = event.usage;
            run.externalId = event.externalId || run.externalId;
          }
          if (event.type === 'run.failed') {
            run.state = 'failed';
            run.completedAt = Date.now();
            run.error = event.error;
          }
          if (event.type === 'run.auth_required') {
            run.state = 'failed';
            run.completedAt = Date.now();
            run.error = event.error;
          }
          this.emit(event);
        }
      }
    });

    // Buffer stderr for auth error detection on exit
    let stderrBuffer = '';
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrBuffer += text;
      log.debug('Claude stderr', { runId, data: text.substring(0, 200) });
    });

    // Handle process exit
    proc.on('exit', (code, signal) => {
      if (run.state === 'streaming') {
        // Process exited without a result event
        if (signal === 'SIGINT' || signal === 'SIGTERM') {
          run.state = 'cancelled';
          run.completedAt = Date.now();
          this.emit({ type: 'run.cancelled', runId });
        } else if (code !== 0) {
          run.state = 'failed';
          run.completedAt = Date.now();
          // Check stderr for auth errors (Claude may write to stderr and exit without a JSON result)
          if (isAuthError(stderrBuffer)) {
            run.error = stderrBuffer.trim() || `Authentication failed (exit code ${code})`;
            this.emit({ type: 'run.auth_required', runId, error: run.error });
          } else {
            run.error = `Process exited with code ${code}`;
            this.emit({ type: 'run.failed', runId, error: run.error });
          }
        }
      }
      this.runs.delete(runId);
      log.info('Run completed', { runId, state: run.state, code, signal });

      // Re-index the session's JSONL to pick up new messages written by Claude CLI.
      // We compute the JSONL path directly rather than looking up by externalId,
      // because for new sessions the DB entry may not exist yet or the externalId
      // from the stream may not match the filename-based one.
      const eid = run.externalId;
      if (eid && run.projectPath) {
        try {
          const slug = computeProjectSlug(run.projectPath);
          // Use profile-specific projects dir if a profile was used
          const projectsDir = run.configDir
            ? path.join(run.configDir, 'projects')
            : getClaudeProjectsDir();
          const jsonlPath = path.join(projectsDir, slug, `${eid}.jsonl`);
          const event = indexSession(this.db, jsonlPath, slug);
          log.info('Post-run reindex', { externalId: eid, jsonlPath, event });
        } catch (err) {
          log.warn('Post-run reindex failed', {
            externalId: eid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    proc.on('error', (err) => {
      run.state = 'failed';
      run.completedAt = Date.now();
      run.error = err.message;
      this.runs.delete(runId);
      this.emit({ type: 'run.failed', runId, error: err.message });
      log.error('Run spawn error', { runId, error: err.message });
    });

    log.info('Run started', { runId, projectPath: params.projectPath, resume: !!params.externalId });
    return runId;
  }

  /**
   * Cancel an active run by sending SIGINT.
   */
  cancel(runId: string): boolean {
    const active = this.runs.get(runId);
    if (!active) return false;

    const { process: proc } = active;
    log.info('Cancelling run', { runId });

    // Send SIGINT (graceful cancel, like Ctrl+C)
    proc.kill('SIGINT');

    // Fallback: force kill after 5 seconds
    setTimeout(() => {
      if (this.runs.has(runId)) {
        log.warn('Force killing run after timeout', { runId });
        proc.kill('SIGKILL');
      }
    }, 5000);

    return true;
  }

  /**
   * Get a run by ID (active or recently completed).
   */
  getRun(runId: string): Run | null {
    return this.runs.get(runId)?.run ?? null;
  }

  /**
   * Get all active runs.
   */
  getActiveRuns(): Run[] {
    return Array.from(this.runs.values()).map(a => a.run);
  }

  /**
   * Cancel all active runs. Called during daemon shutdown.
   */
  cancelAll(): void {
    for (const [runId] of this.runs) {
      this.cancel(runId);
    }
  }
}
