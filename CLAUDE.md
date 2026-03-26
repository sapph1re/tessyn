# Tessyn — Working Instructions

## Documentation

Project documentation lives in `/docs`. Read it before making changes.

| File | Contents |
|------|----------|
| `docs/architecture.md` | System design, components, data flow, tech stack, key principles |
| `docs/schema.md` | SQLite schema, FTS5, migrations, design decisions |
| `docs/protocol.md` | JSON-RPC API, IPC/WebSocket transport, events, error codes |
| `docs/testing.md` | Test tiers, fixtures, CI matrix, cross-platform helpers |
| `docs/cross-platform.md` | Platform-specific behavior, gotchas, environment variables |
| `docs/desktop-integration.md` | Migration guide for Tessyn Desktop (from ClaudeMaximus) |

## Docs-First Workflow

**Scale your reading to the scope of the change:**

- **Bug fix / small tweak:** Read the relevant source files. No docs review needed.
- **New feature or module:** Read `docs/architecture.md` and whichever docs are relevant. Ensure the change aligns with documented principles.
- **Architectural or structural change:** Read all docs. If the change contradicts a documented principle or convention — **stop and explain why before implementing**. Update docs first, then code.

**If docs and code disagree:** Investigate before assuming either is right. Flag the discrepancy.

**After changes:** Update `README.md` if user-facing behavior changed. Update `/docs` if architecture, schema, protocol, or conventions changed.

## Git Workflow

Follow the contributing workflow in `README.md`. Additional rules for you:

- **Commit frequently.** Small, logical commits. No co-author tags.
- **Push only when tests pass** and the feature/fix is complete. Don't push broken or partial work.
- **Before starting work:** check open PRs (`gh pr list`). If anyone is working on overlapping code (same files, same module, same feature area), **stop and flag it** before proceeding.
- **Before opening a PR:** merge latest master into your branch, resolve conflicts carefully (review each one, don't blindly accept either side), run the full test suite after the merge.

## Quality Gates

**Before implementing:** Review your plan with Codex (`/codex-review`). Get feedback on approach, edge cases, and risks before writing code.

**Before pushing:** Review your changes with Codex (`/codex-review`). Address findings before pushing. This applies to every push, not just PRs.

**After every change:** Clean up. No orphan code, unused imports, dead files, stale references. Check:
- Unused exports or imports (run `npm run lint`)
- Files that are no longer referenced
- Documentation that references removed or renamed things
- Memory files that have become stale

**Consistency:** Every change must be consistent across all related parts:
- Code, types, and tests must agree
- Documentation in `/docs`, `README.md`, and `CLAUDE.md` must agree
- Memory files must reflect current reality
- If you rename something, rename it everywhere

## Daemon Awareness

Check daemon status (`tessyn status`) before and after code changes. Preserve the user's daemon state: if it was running, rebuild and restart it; if it was stopped, leave it stopped. If you start it for your own testing, stop it when done.

## Build & Test

```bash
npm run build        # TypeScript compilation
npm test             # All tests (unit + integration + E2E)
npm run test:unit    # Unit tests only
npm run test:integration  # Integration tests
npm run test:e2e     # End-to-end tests
npm run lint         # ESLint
npm run tessyn       # Run CLI (after build)
```

## Releasing

To publish a new version to npm:

```bash
npm version patch    # or minor / major
git push && git push --tags
gh release create v<version> --title "v<version>" --notes "Release notes here"
```

The GitHub Actions publish workflow handles the rest (lint, test, publish via Trusted Publishing — no tokens needed).

## Quick Reference

- All timestamps: Unix epoch milliseconds (INTEGER in SQLite)
- Paths: always `path.join()` and `os.homedir()`, never hardcode separators
- JSONL: source of truth, Tessyn never writes to it
- SQLite: disposable index, `tessyn reindex` rebuilds from scratch
- Tests: no mocks for core infrastructure — real SQLite, real sockets, real watcher
- All env vars: documented in `docs/cross-platform.md`
