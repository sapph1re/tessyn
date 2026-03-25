# Protocol

JSON-RPC 2.0 over newline-delimited JSON. Used for both IPC (CLI clients) and WebSocket (GUI frontends).

## Transport

### IPC (CLI ↔ Daemon)

- Unix domain socket on macOS/Linux: `/tmp/tessyn-<uid>.sock`
- Named pipe on Windows: `\\.\pipe\tessyn-<username>`
- Socket permissions: `0600` (owner-only) on Unix
- Pattern: connect → send request → read response → disconnect
- Timeout: 5 seconds (60 seconds for `reindex` and `titles.generate`)
- Override: `TESSYN_SOCKET_PATH` env var

### WebSocket (GUI Frontends ↔ Daemon)

- `ws://127.0.0.1:9833` (configurable via `TESSYN_WS_PORT`)
- Authentication: `?token=<auth_token>` query parameter
- Auth token: generated on daemon start, written to `<data_dir>/ws-auth-token` with `0600` permissions
- Origin check: only localhost origins accepted
- Pattern: long-lived connection with request/response + push notifications
- On connect: daemon sends current status as a notification

## RPC Methods

### `status`

Returns daemon state.

```json
// Request
{"jsonrpc": "2.0", "id": 1, "method": "status"}

// Response
{"jsonrpc": "2.0", "id": 1, "result": {
  "state": "caught_up",
  "sessionsIndexed": 94,
  "sessionsTotal": 94,
  "uptime": 12345,
  "version": "0.2.0",
  "protocolVersion": 2,
  "capabilities": ["search", "meta", "run", "stream", "titles"]
}}
```

States: `cold` → `scanning` → `caught_up` (or `degraded`)

### `sessions.list`

List sessions with optional filters.

```json
// Request
{"jsonrpc": "2.0", "id": 2, "method": "sessions.list", "params": {
  "projectSlug": "my-project",  // optional
  "state": "active",            // optional, default: "active"
  "hidden": false,              // optional, default: false (exclude hidden)
  "archived": false,            // optional, default: false (exclude archived)
  "limit": 20,                  // optional
  "offset": 0                   // optional
}}

// Response
{"jsonrpc": "2.0", "id": 2, "result": {
  "sessions": [
    {
      "id": 1,
      "provider": "claude",
      "externalId": "abc-123",
      "projectSlug": "my-project",
      "title": "Fix auth module bug",
      "firstPrompt": "There's a bug in...",
      "createdAt": 1700000000000,
      "updatedAt": 1700001000000,
      "messageCount": 42,
      "state": "active"
    }
  ]
}}
```

### `sessions.get`

Get a single session with its messages and durable metadata. Accepts either `id` (numeric) or `externalId` (stable UUID).

```json
// Request (by externalId — preferred)
{"jsonrpc": "2.0", "id": 3, "method": "sessions.get", "params": {
  "externalId": "abc-123-def",
  "limit": 100,   // optional, for message pagination
  "offset": 0     // optional
}}

// Request (by numeric id — less stable, changes on reindex)
{"jsonrpc": "2.0", "id": 3, "method": "sessions.get", "params": {
  "id": 1
}}
```

Response includes `meta` (durable metadata) alongside `session` and `messages`.

### `search`

Full-text search across all sessions. Uses FTS5 with porter stemming.

```json
// Request
{"jsonrpc": "2.0", "id": 4, "method": "search", "params": {
  "query": "authentication bug",
  "projectSlug": "my-project",  // optional
  "role": "user",               // optional: user | assistant | system
  "limit": 20,                  // optional
  "offset": 0                   // optional
}}

// Response
{"jsonrpc": "2.0", "id": 4, "result": {
  "results": [
    {
      "sessionId": 1,
      "messageId": 5,
      "content": "There's an authentication bug...",
      "role": "user",
      "timestamp": 1700000000000,
      "sessionTitle": "Fix auth module bug",
      "projectSlug": "my-project",
      "rank": -2.5
    }
  ],
  "count": 1
}}
```

### `titles.generate`

Generate titles for untitled sessions. Requires `claude` CLI.

```json
// Request
{"jsonrpc": "2.0", "id": 5, "method": "titles.generate", "params": {
  "limit": 50  // optional, max sessions to process
}}

// Response
{"jsonrpc": "2.0", "id": 5, "result": {"generated": 12}}
```

### `reindex`

Drop all indexed data and rebuild from JSONL files.

```json
// Request
{"jsonrpc": "2.0", "id": 6, "method": "reindex"}

// Response
{"jsonrpc": "2.0", "id": 6, "result": {"indexed": 94, "total": 111}}
```

### `shutdown`

Gracefully stop the daemon.

```json
{"jsonrpc": "2.0", "id": 7, "method": "shutdown"}
```

### `sessions.rename`

Set a user title (stored in durable metadata, survives reindex).

```json
{"jsonrpc": "2.0", "id": 8, "method": "sessions.rename", "params": {
  "externalId": "abc-123", "title": "My Session Title"
}}
```

### `sessions.hide` / `sessions.archive`

Hide or archive a session. Hidden/archived sessions are excluded from `sessions.list` by default.

```json
{"jsonrpc": "2.0", "id": 9, "method": "sessions.hide", "params": {
  "externalId": "abc-123", "hidden": true
}}
```

### `sessions.toggles.get` / `sessions.toggles.set`

Per-session toggle state (auto-commit, auto-branch, auto-document, auto-compact).

```json
// Set
{"jsonrpc": "2.0", "id": 10, "method": "sessions.toggles.set", "params": {
  "externalId": "abc-123", "autoCommit": true, "autoBranch": false
}}

// Get
{"jsonrpc": "2.0", "id": 11, "method": "sessions.toggles.get", "params": {
  "externalId": "abc-123"
}}
```

### `sessions.draft.save` / `sessions.draft.get`

Persist and retrieve draft input text.

```json
// Save
{"jsonrpc": "2.0", "id": 12, "method": "sessions.draft.save", "params": {
  "externalId": "abc-123", "content": "My unsaved message"
}}

// Get
{"jsonrpc": "2.0", "id": 13, "method": "sessions.draft.get", "params": {
  "externalId": "abc-123"
}}
```

### `run.send`

Spawn a Claude session. Returns `runId` immediately; events stream via WebSocket.

```json
{"jsonrpc": "2.0", "id": 14, "method": "run.send", "params": {
  "prompt": "Fix the bug in auth.ts",
  "projectPath": "/path/to/project",
  "externalId": "abc-123",  // optional: resume existing session
  "model": "opus"           // optional: model override
}}
// Response: {"result": {"runId": "uuid"}}
```

### `run.cancel`

Cancel an active run via SIGINT.

```json
{"jsonrpc": "2.0", "id": 15, "method": "run.cancel", "params": {"runId": "uuid"}}
```

### `run.list` / `run.get`

List active runs or get a specific run's state.

```json
{"jsonrpc": "2.0", "id": 16, "method": "run.list"}
{"jsonrpc": "2.0", "id": 17, "method": "run.get", "params": {"runId": "uuid"}}
```

## WebSocket Events

Push notifications sent to subscribed clients. JSON-RPC notifications (no `id` field).

### Subscribe / Unsubscribe

```json
// Subscribe
{"jsonrpc": "2.0", "id": 1, "method": "subscribe", "params": {
  "topics": ["session.*", "index.state_changed"]
}}

// Unsubscribe
{"jsonrpc": "2.0", "id": 2, "method": "unsubscribe", "params": {
  "topics": ["session.*"]
}}
```

Topic patterns: exact match (`session.created`), wildcard (`session.*`), or global (`*`).

### Event Types

```json
// Session created
{"jsonrpc": "2.0", "method": "session.created", "params": {
  "projectSlug": "my-project", "sessionFile": "abc-123.jsonl"
}}

// Session updated (new messages)
{"jsonrpc": "2.0", "method": "session.updated", "params": {
  "projectSlug": "my-project", "sessionFile": "abc-123.jsonl"
}}

// Session deleted (file removed)
{"jsonrpc": "2.0", "method": "session.deleted", "params": {
  "projectSlug": "my-project", "sessionFile": "abc-123.jsonl"
}}

// Index state changed
{"jsonrpc": "2.0", "method": "index.state_changed", "params": {
  "state": "caught_up", "sessionsIndexed": 94, "sessionsTotal": 94
}}
```

### Run Events (subscribe to `run.*`)

```json
{"jsonrpc": "2.0", "method": "run.started",    "params": {"runId": "uuid"}}
{"jsonrpc": "2.0", "method": "run.system",     "params": {"runId": "uuid", "externalId": "session-uuid", "model": "claude-opus-4-6", "tools": ["Read", "Edit"]}}
{"jsonrpc": "2.0", "method": "run.delta",      "params": {"runId": "uuid", "blockType": "text", "delta": "Hello", "blockIndex": 0}}
{"jsonrpc": "2.0", "method": "run.block_start", "params": {"runId": "uuid", "blockType": "tool_use", "blockIndex": 1, "toolName": "Read"}}
{"jsonrpc": "2.0", "method": "run.block_stop",  "params": {"runId": "uuid", "blockIndex": 1}}
{"jsonrpc": "2.0", "method": "run.message",    "params": {"runId": "uuid", "role": "assistant", "content": [...]}}
{"jsonrpc": "2.0", "method": "run.completed",  "params": {"runId": "uuid", "externalId": "session-uuid", "stopReason": "end_turn", "usage": {"inputTokens": 100, "outputTokens": 50, "durationMs": 3000, "costUsd": 0.05}}}
{"jsonrpc": "2.0", "method": "run.failed",     "params": {"runId": "uuid", "error": "Rate limit exceeded"}}
{"jsonrpc": "2.0", "method": "run.cancelled",  "params": {"runId": "uuid"}}
```

## Error Codes

Standard JSON-RPC 2.0 error codes plus custom codes:

| Code | Name | Meaning |
|------|------|---------|
| -32700 | Parse Error | Invalid JSON |
| -32600 | Invalid Request | Not a valid JSON-RPC request |
| -32601 | Method Not Found | Unknown method |
| -32602 | Invalid Params | Missing/invalid parameters (including FTS5 syntax errors) |
| -32603 | Internal Error | Server error |
| -32000 | Daemon Not Ready | Index is still scanning |
| -32001 | Session Not Found | Session ID doesn't exist |
| -32002 | Run Not Found | Run ID doesn't exist |
| -32003 | Run Limit Reached | Max concurrent runs exceeded |
| -32004 | Claude Not Available | Claude CLI not installed or not in PATH |
