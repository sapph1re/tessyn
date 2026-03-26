import type { Disposable } from 'vscode';
import type { Message, RunUsage } from '../protocol/types.js';

export interface StreamBlock {
  blockIndex: number;
  blockType: string;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  complete: boolean;
}

export interface StreamState {
  runId: string;
  blocks: StreamBlock[];
  active: boolean;
  usage: RunUsage | null;
  error: string | null;
  rateLimitRetryAt: number | null;
}

type SessionStateHandler = () => void;

/**
 * Per-session state: messages from the daemon + active stream state.
 */
export class SessionState implements Disposable {
  private _messages: Message[] = [];
  private _stream: StreamState | null = null;
  private _draft: string = '';
  private handlers: SessionStateHandler[] = [];

  constructor(public readonly externalId: string) {}

  get messages(): Message[] { return this._messages; }
  get stream(): StreamState | null { return this._stream; }
  get draft(): string { return this._draft; }
  get isStreaming(): boolean { return this._stream?.active === true; }

  // === Messages ===

  setMessages(messages: Message[]): void {
    this._messages = messages;
    this.emit();
  }

  appendMessage(message: Message): void {
    this._messages.push(message);
    this.emit();
  }

  // === Streaming ===

  startStream(runId: string): void {
    this._stream = {
      runId,
      blocks: [],
      active: true,
      usage: null,
      error: null,
      rateLimitRetryAt: null,
    };
    this.emit();
  }

  appendDelta(runId: string, blockIndex: number, blockType: string, delta: string): void {
    if (!this._stream || this._stream.runId !== runId) return;

    let block = this._stream.blocks[blockIndex];
    if (!block) {
      // Create blocks up to blockIndex if needed
      while (this._stream.blocks.length <= blockIndex) {
        this._stream.blocks.push({
          blockIndex: this._stream.blocks.length,
          blockType: 'text',
          content: '',
          complete: false,
        });
      }
      block = this._stream.blocks[blockIndex];
    }
    block.blockType = blockType;
    block.content += delta;
    this.emit();
  }

  startBlock(runId: string, blockIndex: number, blockType: string, toolName?: string, toolInput?: Record<string, unknown>): void {
    if (!this._stream || this._stream.runId !== runId) return;

    while (this._stream.blocks.length <= blockIndex) {
      this._stream.blocks.push({
        blockIndex: this._stream.blocks.length,
        blockType: 'text',
        content: '',
        complete: false,
      });
    }
    const block = this._stream.blocks[blockIndex];
    block.blockType = blockType;
    block.toolName = toolName;
    block.toolInput = toolInput;
    this.emit();
  }

  stopBlock(runId: string, blockIndex: number): void {
    if (!this._stream || this._stream.runId !== runId) return;
    const block = this._stream.blocks[blockIndex];
    if (block) {
      block.complete = true;
      this.emit();
    }
  }

  completeStream(runId: string, usage: RunUsage | null): void {
    if (!this._stream || this._stream.runId !== runId) return;
    this._stream.active = false;
    this._stream.usage = usage;
    for (const block of this._stream.blocks) {
      block.complete = true;
    }
    this.emit();
  }

  failStream(runId: string, error: string): void {
    if (!this._stream || this._stream.runId !== runId) return;
    this._stream.active = false;
    this._stream.error = error;
    this.emit();
  }

  setRateLimit(runId: string, retryAfterMs: number): void {
    if (!this._stream || this._stream.runId !== runId) return;
    this._stream.rateLimitRetryAt = Date.now() + retryAfterMs;
    this.emit();
  }

  // === Draft ===

  setDraft(draft: string): void {
    this._draft = draft;
    // Don't emit for drafts — they're high-frequency and not displayed in the message list
  }

  // === Subscriptions ===

  onChange(handler: SessionStateHandler): Disposable {
    this.handlers.push(handler);
    return {
      dispose: () => {
        const idx = this.handlers.indexOf(handler);
        if (idx >= 0) this.handlers.splice(idx, 1);
      },
    };
  }

  dispose(): void {
    this.handlers = [];
    this._messages = [];
    this._stream = null;
  }

  private emit(): void {
    for (const handler of this.handlers) {
      try { handler(); } catch { /* ignore */ }
    }
  }
}
