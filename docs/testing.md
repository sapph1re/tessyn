# Testing

## Philosophy

Real tests, no mocks. We test with real SQLite databases, real file systems, real sockets, and a real @parcel/watcher. The only things not tested are actual Claude API calls and GUI frontend behavior.

## Test Tiers

### Unit Tests (`test/unit/`)

Fast, pure logic. Run on all CI targets.

| File | What it tests |
|------|--------------|
| `jsonl-parser.test.ts` | All event types, malformed input, partial lines, mixed line endings, incremental parsing |
| `checkpoint.test.ts` | File identity hashing, checkpoint decisions (skip/incremental/full/deleted) |
| `claude-paths.test.ts` | JSONL path parsing, project slug extraction |
| `session-discovery.test.ts` | Slug algorithm, path round-tripping |
| `schema.test.ts` | Migration runner, table creation, constraints (unique, cascade) |
| `protocol.test.ts` | JSON-RPC parsing, response/error/notification creation, subscription manager |

### Integration Tests (`test/integration/`)

Real I/O. Run on Linux x64, macOS ARM64, Windows x64.

| File | What it tests |
|------|--------------|
| `indexer.test.ts` | JSONL → SQLite pipeline, incremental indexing, malformed input handling |
| `watcher.test.ts` | @parcel/watcher detecting file changes, debounced processing |
| `ipc.test.ts` | Real net.Server + net.Socket, JSON-RPC request/response |
| `search.test.ts` | FTS5 queries, filtered search by project/role, ranking |
| `checkpoint.test.ts` | Truncation, replacement, partial lines, deletion, idempotent re-index |
| `idempotency.test.ts` | Multiple fullScans produce identical state, no duplicate rows |

### E2E Tests (`test/e2e/`)

Spawn real daemon processes. Run on Linux x64, macOS ARM64.

| File | What it tests |
|------|--------------|
| `daemon-lifecycle.test.ts` | Start daemon, send requests, write JSONL, query, shutdown |
| `watch-index-query.test.ts` | Write JSONL incrementally, verify watcher + indexer + search pipeline |

## Fixtures

JSONL fixtures in `test/fixtures/conversations/`:

| File | Purpose |
|------|---------|
| `simple-chat.jsonl` | Basic user/assistant exchange |
| `multi-turn-with-tools.jsonl` | Tool use blocks (Read, Edit, Write), tool results, thinking |
| `thinking-blocks.jsonl` | Extended thinking content |
| `malformed-lines.jsonl` | Invalid JSON mixed with valid lines |
| `mixed-line-endings.jsonl` | CRLF line endings |
| `empty.jsonl` | Empty file |

## Running Tests

```bash
npm test                  # All tests
npm run test:unit         # Unit only
npm run test:integration  # Integration only
npm run test:e2e          # E2E only
npm run test:watch        # Unit tests in watch mode
```

## CI Matrix

| Target | Unit | Integration | E2E |
|--------|------|-------------|-----|
| Linux x64 | yes | yes | yes |
| Linux ARM64 | yes | — | — |
| macOS ARM64 | yes | yes | yes |
| Windows x64 | yes | yes | — |

## Cross-Platform Test Helpers

- All tests use `TESSYN_CLAUDE_DIR` override pointing to temp directories (`fs.mkdtempSync`)
- Socket paths: `/tmp/tessyn-test-<pid>-<timestamp>.sock` on Unix, `\\.\pipe\tessyn-test-<pid>-<timestamp>` on Windows
- macOS: `@parcel/watcher` returns paths with `/private/var/` prefix (symlink resolution) — the `resolveRealPath()` helper handles this
- Watcher tests poll for results with timeouts rather than fixed waits (FSEvents latency varies)
- JSONL fixtures include both `\n` and `\r\n` line endings

## What We Don't Test

- Claude API calls (we test JSONL parsing and `claude` CLI availability, not the LLM itself)
- GUI frontend behavior (frontend's responsibility)
- Performance at scale (premature — revisit with real usage data)
