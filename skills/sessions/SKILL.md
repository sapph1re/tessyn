---
name: tessyn-sessions
description: Browse Claude Code session history across all projects. Use when the user wants to see recent sessions, find a specific past session, or get an overview of recent work.
allowed-tools: Bash
argument-hint: [--project <slug>] [--limit <n>]
---

List past Claude Code sessions using Tessyn.

## Session list

!`tessyn sessions list $ARGUMENTS 2>&1`

## Instructions

Present the session list to the user:

1. **Format cleanly** — show session ID, title, project, message count, and last updated
2. **Highlight recent activity** — note which sessions are most recent
3. **Offer next steps** — remind the user they can:
   - Use `/session-context <id>` to load a session's content into the current conversation
   - Use `/recall <query>` to search within session content
   - Add `--project <slug>` to filter by project
   - Add `--limit <n>` to see more or fewer results

If the output says "not running" or mentions a socket error, tell the user:
> Tessyn daemon is not running. Start it with `tessyn start -d` and try again.
