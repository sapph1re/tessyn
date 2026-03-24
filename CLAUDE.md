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

## Docs-First Workflow

**Scale your reading to the scope of the change:**

- **Bug fix / small tweak:** Read the relevant source files. No docs review needed.
- **New feature or module:** Read `docs/architecture.md` and whichever docs are relevant. Ensure the change aligns with documented principles.
- **Architectural or structural change:** Read all docs. If the change contradicts a documented principle or convention — **stop and explain why before implementing**. Update docs first, then code.

**If docs and code disagree:** Investigate before assuming either is right. Flag the discrepancy.

**After changes:** Update `README.md` if user-facing behavior changed. Update `/docs` if architecture, schema, protocol, or conventions changed.

## Git Workflow

**Branching:** Trunk-based development. `master` is the trunk.

- Create a new branch for every change: `<type>/<short-description>`
  - Types: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`, `test/`
  - Examples: `feat/title-generation`, `fix/socket-path-macos`, `docs/protocol-reference`
- Open a pull request from the branch into `master`. Never push directly to `master`.
- Short-lived branches — merge and delete promptly.

**Before starting work:**

1. `git pull origin master` — always start from the latest master.
2. Check open PRs (`gh pr list`) — if anyone is working on overlapping code, **stop and flag it** before proceeding. Overlapping work = same files, same module, or same feature area.
3. Create the branch: `git checkout -b <type>/<description>`

**During work:**

- Commit frequently. Small, logical commits are preferred over large batches.
- No co-author tags in commit messages.
- Run `npm run build && npm run lint && npm test` before pushing.

**Before opening a PR:**

1. `git fetch origin master` and check for new commits on master.
2. If master has moved: `git merge origin/master` into your branch. Resolve any conflicts — review each conflict carefully, don't blindly accept either side.
3. Run the full test suite one final time after the merge.
4. Push and open the PR.

**Push policy:** Push when tests pass and the feature/fix is complete. Don't push broken or partial work to the remote.

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

## Quick Reference

- All timestamps: Unix epoch milliseconds (INTEGER in SQLite)
- Paths: always `path.join()` and `os.homedir()`, never hardcode separators
- JSONL: source of truth, Tessyn never writes to it
- SQLite: disposable index, `tessyn reindex` rebuilds from scratch
- Tests: no mocks for core infrastructure — real SQLite, real sockets, real watcher
- All env vars: documented in `docs/cross-platform.md`
