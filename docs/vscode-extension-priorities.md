# VS Code Extension — Priorities & North Star

Design landmarks for the Tessyn VS Code extension. Derived from comprehensive analysis of 688 user reviews across the VS Code Marketplace (631) and Open VSX (57) for Anthropic's Claude Code extension, plus GitHub issues, Reddit, and tech press.

Our advantage: Tessyn already solves the #1 user pain point (session management) at the daemon level. The extension is a frontend to a robust, always-running backend with SQLite indexing, real-time file watching, and a stable WebSocket API. We don't need to reinvent session persistence — we just need to expose it well.

---

## P0 — Session Reliability (Our Core Differentiator)

The single most common source of user frustration and subscription cancellations. This is why Tessyn exists.

### Never lose a session

- **Survive everything.** Panel close, VS Code restart, extension update, crash — sessions are always there when you come back. Tessyn daemon persists independently of the extension lifecycle.
- **Cross-surface continuity.** A session started in CLI, continued in the VS Code extension, resumed in Desktop — all the same session, all the same history. Tessyn indexes from the JSONL source of truth regardless of where the session was created.
- **No "blank screen" on reopen.** When the extension activates, it connects to the daemon and immediately has the full session list. No cold start, no loading spinner that never resolves.
- **Draft persistence.** Unsaved input text survives panel close and restart (we already have `sessions.draft.save/get` in the protocol).

### Session management that actually works

- **Project-scoped session lists.** Sessions are automatically grouped by project slug. Users see exactly their sessions for the current workspace — no cross-project pollution, no hunting.
- **Conversation history always accessible.** Browse, search, resume any past session. Not just "recent" — all of them, with full-text search across all session content.
- **Session actions.** Rename, hide, archive, delete. Let users organize their session history. We have rename/hide/archive in the protocol; expose them in the UI.
- **Real-time updates.** When Claude is writing to a session (from CLI or any other surface), the extension sees it immediately via WebSocket push events. No refresh button needed.

**User quotes driving this priority:**
> "Close the chat panel? History lost. Restart VSCode? History lost. Switch projects? History lost."
> "I paid $200 for this service expecting professional-grade tooling. Losing conversation history makes this extension unusable."
> "After prolonged use, conversations just disappear."
> "Why do I lose parts of chat history?"
> "I want to manage 5 to 10 conversations at the same time."

---

## P1 — Full CLI Parity (Then Exceed It)

Users consistently report the extension is a strict subset of the CLI. We must never ship a GUI that's less capable than the command line.

### Everything the CLI can do, the extension must do

- **All commands.** Every Tessyn CLI command (`sessions list`, `sessions show`, `search`, `status`, `reindex`, `titles`, `watch`) must have a UI equivalent. No "use the terminal for that" escape hatches.
- **All Claude Code commands.** `/usage`, `/status`, `/mcp`, `/model`, custom slash commands — if the user can type it in the terminal, they can do it in the extension.
- **Background process management.** List active runs, view their output, cancel them. Don't hide what's happening behind the scenes.
- **MCP server management.** Configure, enable/disable, diagnose MCP servers from the extension. Not "open a terminal and run a command."

### Then go beyond

- **Visual session browser.** Something the CLI fundamentally can't do well — browse sessions with previews, filters, search, and project grouping.
- **Inline diffs for file changes.** Show what Claude changed in a proper VS Code diff view, not just dumped into chat.
- **File reference from editor.** Drag files, select lines, reference open tabs — leverage the IDE context that the CLI can't access.
- **Multi-session view.** Have multiple sessions visible simultaneously (split panels, tabs). The CLI is single-session by nature; the GUI shouldn't be.

**User quotes driving this priority:**
> "The CLI works great (5 stars), but the VS Code extension is currently unusable (1 star)."
> "Missing /usage command. No way to delete conversations other than manually removing from ~/.claude/projects."
> "Can't use agents, point folders is impossible. V1 was better."
> "No drag-and-drop files, no worktree support."
> "Missing allowed commands permissions, export chat."

---

## P2 — Token & Context Transparency

Users are flying blind. They don't know how much they've used, how much is left, or when compaction will happen. This erodes trust.

### Usage visibility

- **Token budget indicator.** Always visible — how much of the current session's context window has been consumed. A progress bar or percentage in the status bar.
- **Cost tracking per session.** We already receive `usage` data in `run.completed` events (inputTokens, outputTokens, costUsd). Surface it. Show cumulative cost per session and per project.
- **Rate limit status.** When the user is approaching or has hit a rate limit, show it clearly with time until reset. Don't just fail silently or show a cryptic error.

### Context management

- **Compaction warning.** Before context compaction happens, warn the user. Let them choose to start a new session instead if they prefer.
- **Compaction visibility.** When compaction does happen, show what was summarized vs. preserved. Don't silently lose context.
- **Session "health" indicator.** Is the current session fresh and fully contextual, or is it running on compacted summaries? Users should know.

**User quotes driving this priority:**
> "No indication when compacting happens. Everything suddenly freezes, then compact conversation appears with all context exposed in chat."
> "Nothing worse than suddenly running out of gas in the middle of a road trip."
> "Token budget indicator is the thing that codex specifically does better."
> "When you run out of tokens in the middle of an answer, the code will be BROKEN and PARTIALLY EDITED."
> "I'd like to see more visibility and control on when the context gets too long."

---

## P3 — Respect User Configuration

The #1 UX complaint after session loss. The extension must never override what the user has explicitly configured.

### Permission model

- **Honour settings.json.** If the user has configured allowed commands, file access patterns, or auto-approve rules in Claude Code's `settings.json` or `settings.local.json` — respect them. Period.
- **No redundant confirmation dialogs.** Don't add our own security layer on top of Claude Code's permission system. If Claude Code says it's allowed, it's allowed.
- **"Trust workspace" option.** For users who want full autonomy, provide a single toggle. Don't make them click "Allow" on every file read.
- **Progressive trust.** Remember what the user approved in past sessions. If they allowed `npm test` once, don't ask again tomorrow.

### Stability

- **No forced auto-updates.** Let users pin a version. If they disable auto-update, respect it. Never silently upgrade.
- **No model switching.** Don't change the user's selected model between sessions or after updates.
- **Preserve workspace layout.** If the user puts the extension in the secondary sidebar, keep it there. Don't jump to the editor area.

**User quotes driving this priority:**
> "The extension adds its own security confirmation layer that completely ignores Claude's own settings.json permissions... A task that should take 10 minutes becomes 40 minutes of babysitting."
> "It ignores allowed commands configured in settings.local.json (very annoying)."
> "I have to permit certain actions again and again and again, and again, and again."
> "Stop changing the default model back to sonnet. Crazy dark pattern."

---

## P4 — UX That People Already Love (Don't Regress)

These are the features that drive 5-star reviews. We must match or exceed every one of them. Failing here means failing even though our backend is better.

### IDE integration essentials

- **Copy/paste that works.** Text selection, copy, paste — flawless. The #1 reason users prefer the extension over CLI.
- **Image support.** Paste screenshots, drag images into chat. Critical for frontend development workflows.
- **Current file / selection awareness.** The extension must always know what file is open and what text is selected. Use it as implicit context without the user having to type `@filename`.
- **Clickable file references.** When Claude mentions a file path or line number, clicking it opens that file at that line. Don't just "open the file" — go to the exact location.
- **Inline diff review.** Show proposed changes as VS Code diffs. Accept/reject per-file or per-hunk, like Cursor does. Don't dump raw code into chat.

### Input & interaction

- **IME support.** Japanese, Chinese, Korean input methods must work correctly. Enter to confirm character selection must not submit the message. This was a launch-breaking bug for CJK users.
- **Keyboard-first workflow.** Up/down arrows, tab completion, mode switching — all must work via keyboard. Never force mouse interaction for common operations.
- **Shift+Enter for newlines.** Standard multiline input behaviour. No accidental submissions.
- **Tab completion for commands.** Type `/` and get completable command suggestions. Tab completes without executing.

### Layout flexibility

- **Side panel support.** Run the extension in the secondary sidebar (right side), not forced into editor tabs. This is how Copilot, Gemini, Amp, and every other AI assistant works.
- **Resizable and dockable.** Users with vertical monitors, ultrawide monitors, and multi-monitor setups all need the extension to adapt.
- **Multiple concurrent sessions.** Open several conversations in separate tabs or split views. Don't force single-session tunnel vision.

**User quotes driving this priority:**
> "Way better than terminal — copy/paste, image pasting, text selection all work better."
> "It knows about the selected lines and current editor tab, which seems more robust compared to the CLI."
> "Much easier for people not familiar with working in the console."
> "Right information, right place, right time."
> "V2.0.0 does not handle the Japanese IME conversion state at all. Pressing Enter to confirm characters is treated as a submit."
> "Claude Code forces you into the sidebar exclusively, making it completely unusable on vertical displays."

---

## P5 — Cross-Platform Quality

Windows and Linux are not afterthoughts. Windows alone is 70% of the developer market.

### Windows

- **First-class support from day one.** No "coming soon" period. Tessyn already runs on Windows with named pipes and ReadDirectoryChangesW. The extension must too.
- **ARM64 stability.** No exit code 3 crashes. Test on Windows ARM64 in CI.
- **File read performance.** Windows file operations are slower — optimize for it, don't ignore it.
- **Path handling.** Use `path.join()` everywhere. Never hardcode `/` separators.

### Linux

- **WSL compatibility.** Many Windows developers use WSL. The extension must work correctly when VS Code connects to a WSL remote.
- **Snap/Flatpak awareness.** Some Linux VS Code installs run in sandboxes. Handle socket access and file permissions accordingly.

### Remote development

- **Remote SSH, Containers, WSL.** The Tessyn daemon runs on the remote host. The extension must connect to it there, not try to run everything locally.
- **Codespaces / devcontainers.** Same principle — daemon on the remote, extension connects via WebSocket.

**User quotes driving this priority:**
> "Doesn't work on Windows. Don't bother purchasing if you use Windows."
> "File read very slow only in Windows."
> "Windows ARM64 crashes every 1-2 minutes with exit code 3."
> "This is not ready for prime time, at least not for work on a remote."

---

## P6 — Thoughtful Status & Feedback

Users hate two things equally: silent failure and patronizing noise.

### Do

- **Completion notifications.** Audible or visual notification when a long-running task finishes. Users walk away; they need to know when to come back.
- **Clear error messages.** When something fails, say what failed and what to do about it. Not "stream closed" or a raw HTML error page.
- **Progress indicators.** For long operations (reindex, title generation, large file analysis), show real progress, not an infinite spinner.
- **Rate limit messaging.** Show time until reset, suggest switching models, or offer to queue the request. Don't just say "limit reached" and go dark.

### Don't

- **No patronizing gerunds.** "Imagining... Thinking... Tinkering... Smooshing..." — users specifically called these out as unprofessional and misleading when nothing is actually happening. Show real status or show nothing.
- **No "AI praises user" filler.** Don't waste tokens or screen space on "Great question!" or "Perfect, everything works!" Let the work speak.
- **No false completion reports.** Never mark something as done when it isn't. Never report a test as passing when it wasn't run. This destroys trust faster than any bug.

**User quotes driving this priority:**
> "The 'Imagining... Thinking... Tinkering...' dialogue is so annoying when actually nothing is happening under the hood."
> "A notification when Claude Code has finished working (visual or audible)."
> "Report that it has done as done. Report a failed test as completed without issue. The extension became a natural born liar."
> "I need useful error messages. Just infinite loading that leaves you unable to work."

---

## P7 — Features Users Explicitly Request

Recurring feature requests that appear across multiple reviews and would differentiate us.

- **Conversation export.** Export sessions as markdown, JSON, or plain text. We have the full data in SQLite — this is trivial for us.
- **Conversation deletion.** Actually delete sessions, not just hide them.
- **Checkpoint / rewind.** Undo to a previous point in the conversation. Cursor has this; Claude Code doesn't.
- **Search across all sessions.** We already have FTS5. Expose it with a fast, keyboard-driven search UI.
- **Mark conversations as important.** Star, pin, or bookmark sessions for quick access.
- **Changelogs.** When we update, tell users what changed. Don't ship daily updates with no release notes.

**User quotes driving this priority:**
> "An easy way to export conversations (JSON, markdown, plain text)."
> "Cannot delete conversations. It's unclear why this hasn't been implemented yet."
> "Add rewind (undo) feature to it please!"
> "I want to archive conversations or mark some as important."
> "Still no info about what has changed... how about Anthropic do its own testing now?"

---

## Summary Table

| Priority | Area | Our Advantage |
|----------|------|---------------|
| **P0** | Session reliability | Tessyn daemon + SQLite indexing — sessions survive everything |
| **P1** | CLI parity + beyond | Full protocol exposed via UI, plus visual features CLI can't do |
| **P2** | Token transparency | `run.completed` already carries usage data; surface it |
| **P3** | Respect config | We don't add our own permission layer — we pass through to Claude |
| **P4** | UX essentials | Learn from every reported UX bug; ship polished from day one |
| **P5** | Cross-platform | Tessyn CI already tests 4 platforms; extension must match |
| **P6** | Status & feedback | Real-time WebSocket events give us honest, live status |
| **P7** | Requested features | FTS5 search, export, session management — already in the daemon |
