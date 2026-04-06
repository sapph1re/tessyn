# Desktop Integration Guide

This document describes how to build a desktop GUI client (Tessyn Desktop) that connects to the Tessyn daemon. It is written for developers migrating from ClaudeMaximus to the daemon-backed architecture.

## Architecture Overview

```
  Tessyn Desktop (Avalonia)          Tessyn Daemon
  ┌──────────────────────┐        ┌──────────────────┐
  │ UI (Avalonia/XAML)   │        │ Watcher + Indexer │
  │ Session tree         │  WS    │ SQLite + FTS5     │
  │ Chat view            │◄──────►│ RunManager        │
  │ Input + toggles      │        │ Session metadata  │
  │ Code autocomplete*   │        │ Title generation  │
  └──────────────────────┘        └──────────────────┘
                                        │
                                  ┌─────▼─────┐
                                  │ claude CLI │
                                  │ (JSONL)    │
                                  └───────────┘
```

The desktop app becomes a **thin WebSocket client**. The daemon handles all data operations: JSONL parsing, indexing, search, Claude process management, title generation, and metadata persistence.

\* Code autocomplete (file/symbol indexing) stays in the desktop app — it requires language-specific parsing (e.g., C# Roslyn) and is UI-latency-sensitive.

## Connecting to the Daemon

### WebSocket Connection

```
URL:   ws://127.0.0.1:9833?token=<auth_token>
Token: Read from <data_dir>/ws-auth-token
```

**Data directory locations:**
- macOS: `~/Library/Application Support/tessyn/ws-auth-token`
- Linux: `~/.local/share/tessyn/ws-auth-token`
- Windows: `%LOCALAPPDATA%\tessyn\Data\ws-auth-token`

**On connect:** The daemon sends a status notification with the current state:
```json
{"jsonrpc": "2.0", "method": "status", "params": {
  "state": "caught_up",
  "sessionsIndexed": 94,
  "sessionsTotal": 94,
  "uptime": 12345,
  "version": "0.2.0",
  "protocolVersion": 2,
  "capabilities": ["search", "meta", "run", "stream", "titles"]
}}
```

Check `protocolVersion` and `capabilities` to verify compatibility.

### Subscribe to Events

After connecting, subscribe to receive real-time notifications:

```json
{"jsonrpc": "2.0", "id": 1, "method": "subscribe", "params": {
  "topics": ["session.*", "index.*", "run.*"]
}}
```

## Feature Mapping: ClaudeMaximus → Daemon API

### Session Management

| ClaudeMaximus Feature | Daemon RPC Method | Notes |
|---|---|---|
| List sessions | `sessions.list` | Filters: projectSlug, state, hidden, archived, limit, offset |
| Show session messages | `sessions.get` | Accepts `id` (numeric) or `externalId` (stable UUID) |
| Rename session | `sessions.rename` | Sets user title in durable metadata (survives reindex) |
| Delete session | `sessions.hide` | Sets `hidden: true`. Use `sessions.archive` for archival. |
| Search across sessions | `search` | FTS5 full-text search with project/role filters |
| Generate titles | `titles.generate` | Batch generation via claude CLI |
| Import from JSONL | `reindex` | The daemon auto-discovers all JSONL files |

### Session State

| ClaudeMaximus Feature | Daemon RPC Method | Notes |
|---|---|---|
| Auto-commit toggle | `sessions.toggles.set` | `{ autoCommit: true }` |
| New branch toggle | `sessions.toggles.set` | `{ autoBranch: true }` |
| Auto-document toggle | `sessions.toggles.set` | `{ autoDocument: true }` |
| Auto-compact toggle | `sessions.toggles.set` | `{ autoCompact: true }` |
| Get toggle state | `sessions.toggles.get` | Returns all toggle values |
| Draft auto-save | `sessions.draft.save` | Persists input text |
| Draft load | `sessions.draft.get` | Restores saved input |

### Claude Process Management

| ClaudeMaximus Feature | Daemon RPC Method | Notes |
|---|---|---|
| Send message to Claude | `run.send` | Returns `runId`, streams events via WebSocket |
| Resume session | `run.send` | Include `externalId` param to resume |
| New session | `run.send` | Omit `externalId` for new session |
| Cancel active run | `run.cancel` | Sends SIGINT to Claude process |
| Check if session is running | `run.list` | Returns all active runs |
| Model selection | `run.send` | Include `model` param |

### Process Events (WebSocket push)

Subscribe to `run.*` to receive real-time streaming events:

| Event | When | Payload |
|---|---|---|
| `run.started` | Process spawning | `{ runId }` |
| `run.system` | Claude init | `{ runId, externalId, model, tools }` |
| `run.delta` | Text/thinking chunk | `{ runId, blockType, delta, blockIndex }` |
| `run.block_start` | Content block begins | `{ runId, blockType, blockIndex, toolName? }` |
| `run.block_stop` | Content block ends | `{ runId, blockIndex }` |
| `run.message` | Full message | `{ runId, role, content }` |
| `run.completed` | Success | `{ runId, externalId, stopReason, usage }` |
| `run.failed` | Error | `{ runId, error }` |
| `run.cancelled` | User cancelled | `{ runId }` |
| `run.rate_limit` | Rate limited | `{ runId, retryAfterMs }` |

**Typical UI flow:**
1. Send `run.send` → get `runId`
2. Listen for `run.system` → get `externalId` (for new sessions)
3. Listen for `run.delta` → update text display incrementally
4. Listen for `run.block_start` (tool_use) → show tool invocation
5. Listen for `run.completed` → show final state, usage/cost

### Daemon Status

| ClaudeMaximus Feature | Daemon RPC Method | Notes |
|---|---|---|
| Check daemon health | `status` | Returns state, sessions count, version |
| Full reindex | `reindex` | Rebuilds SQLite from JSONL |
| Shutdown | `shutdown` | Graceful daemon stop |

## What the Desktop App Keeps Doing

These features stay in the desktop app (not delegated to daemon):

| Feature | Why |
|---|---|
| **UI state** (scroll offsets, window position, splitter, themes) | Client-side concern, different per user |
| **Code autocomplete** (file search, symbol search) | Language-specific (C# Roslyn), latency-sensitive |
| **Custom keyboard shortcuts** | Client-side |
| **Display formatting** (markdown rendering, syntax highlighting) | UI framework-specific |
| **Tree structure** (directories, groups, session hierarchy) | UI organization, not data |
| **Recency bars** (15/30/60 min indicators) | Computed from `updatedAt` timestamps client-side |

## What the Desktop App Can Remove

These ClaudeMaximus components are fully replaced by the daemon:

| Component to Remove | Replaced By |
|---|---|
| `ISessionFileService` (custom .txt format) | Daemon indexes JSONL directly |
| `IClaudeProcessManager` (process spawn/stream) | `run.send` / `run.cancel` |
| `IClaudeSessionImportService` (JSONL parsing) | Daemon auto-discovers and indexes |
| `IClaudeAssistService` (title gen, search) | `titles.generate` / `search` |
| `ISessionSearchService` (linear file scan) | `search` (FTS5, instant) |
| `IAppSettingsService` (session metadata) | `sessions.rename/hide/archive/toggles/draft` |
| `IDraftService` | `sessions.draft.save/get` |
| Custom JSONL parsing code | Daemon handles all JSONL parsing |

## Session Identity

Sessions are identified by `(provider, external_id)`:
- `provider` is always `"claude"` for now
- `external_id` is the UUID from the JSONL filename or the `session_id` in the JSONL content

**Use `externalId` for all client-side references.** The numeric `id` is an autoincrement that changes on reindex. The `externalId` is stable.

## Durable Metadata

The daemon maintains a `session_meta` table that **survives reindex**. When `tessyn reindex` rebuilds the index from JSONL, all user-set metadata is preserved:

- User-set titles (distinct from auto-generated titles)
- Hidden/archived flags
- Toggle states (auto-commit, auto-branch, etc.)
- Drafts
- Model overrides
- Custom instructions

The display title shown to users should be: `meta.title ?? session.title ?? session.firstPrompt`.

## Authentication & Profiles

The daemon supports multiple Claude accounts (profiles). Each profile points to a different Claude config directory with its own credentials.

### Why this matters

Claude Code stores auth in different ways depending on how the user logged in. Interactive CLI sessions often use the macOS keychain, but daemon-spawned subprocesses can't access the keychain. Profiles with file-based OAuth tokens (in `.credentials.json`) work reliably from the daemon.

### How it works

On startup, call `profiles.list` with `checkAuth: true` to discover available accounts:

```json
{"jsonrpc": "2.0", "id": 1, "method": "profiles.list", "params": {"checkAuth": true}}
```

Response:
```json
{
  "profiles": [
    { "name": "default", "configDir": "/Users/alice/.claude", "isDefault": true,
      "auth": { "loggedIn": false, "authMethod": "none" } },
    { "name": "home", "configDir": "/Users/alice/.claude-home", "isDefault": false,
      "auth": { "loggedIn": true, "email": "alice@example.com", "subscriptionType": "max" } }
  ],
  "defaultProfile": "default"
}
```

Most users will have a single "default" profile. The profile config file (`profiles.json`) is only created when a user explicitly adds a second profile — until then, the daemon synthesizes a single implicit default.

### Sending messages with a profile

Pass the `profile` name in `run.send`:

```json
{"jsonrpc": "2.0", "id": 2, "method": "run.send", "params": {
  "prompt": "Hello",
  "projectPath": "/path/to/project",
  "profile": "home",
  "permissionMode": "auto-approve"
}}
```

If `profile` is omitted, the default profile is used.

### Handling auth errors

When Claude can't authenticate, the daemon emits `run.auth_required` instead of generic `run.failed`:

```json
{"jsonrpc": "2.0", "method": "run.auth_required", "params": {
  "runId": "uuid",
  "error": "Not logged in · Please run /login"
}}
```

The GUI should catch this event and show a meaningful message (e.g., "Not logged in — please authenticate in the terminal with `claude login`") instead of a generic error.

### Checking auth on demand

```json
{"jsonrpc": "2.0", "id": 3, "method": "auth.status", "params": {"profile": "default"}}
```

### Managing profiles

```json
// Add
{"jsonrpc": "2.0", "id": 4, "method": "profiles.add", "params": {"name": "work", "configDir": "~/.claude-work"}}

// Remove
{"jsonrpc": "2.0", "id": 5, "method": "profiles.remove", "params": {"name": "work"}}

// Set default
{"jsonrpc": "2.0", "id": 6, "method": "profiles.setDefault", "params": {"name": "home"}}
```

### Recommended GUI flow

1. On startup: call `profiles.list` with `checkAuth: true`
2. If only one profile and it's authenticated: use it silently
3. If only one profile and it's NOT authenticated: show "Not logged in" with instructions
4. If multiple profiles: show a profile selector (dropdown or settings page)
5. On `run.auth_required` event: show the error and suggest re-authenticating
6. Store the user's selected profile in local app settings and pass it with every `run.send`

## Error Handling

All errors are JSON-RPC 2.0 format:

```json
{"jsonrpc": "2.0", "id": 1, "error": {
  "code": -32001,
  "message": "Session not found"
}}
```

| Code | Meaning |
|------|---------|
| -32602 | Invalid parameters |
| -32601 | Unknown method |
| -32000 | Daemon not ready (still scanning) |
| -32001 | Session not found |
| -32002 | Run not found |
| -32003 | Max concurrent runs reached |
| -32004 | Claude CLI not installed |
| -32005 | Authentication required (not logged in) |
| -32006 | Profile not found |

## Migration Checklist

1. [ ] Read auth token from `<data_dir>/ws-auth-token`
2. [ ] Connect to `ws://127.0.0.1:9833?token=...`
3. [ ] Check `protocolVersion >= 2` on connect
4. [ ] Subscribe to `session.*`, `index.*`, `run.*`
5. [ ] Replace session list with `sessions.list` calls
6. [ ] Replace JSONL parsing with `sessions.get` for message display
7. [ ] Replace process spawning with `run.send` / `run.cancel`
8. [ ] Replace title generation with `titles.generate`
9. [ ] Replace search with `search` RPC
10. [ ] Replace draft service with `sessions.draft.save/get`
11. [ ] Replace session toggles with `sessions.toggles.set/get`
12. [ ] Replace rename with `sessions.rename`
13. [ ] Replace delete with `sessions.hide`
14. [ ] Remove custom .txt session file format
15. [ ] Remove JSONL parsing code
16. [ ] Remove Claude process management code
17. [ ] Keep code autocomplete (file/symbol indexing)
18. [ ] Keep UI state management
