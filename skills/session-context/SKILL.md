---
name: tessyn-session-context
description: Load a past Claude Code session into the current conversation context. Use when the user wants to bring knowledge, decisions, or code from a previous session into the current one. Different from /resume — this imports knowledge without switching sessions.
allowed-tools: Bash
argument-hint: <session-id>
---

Load a past session's content into the current conversation context.

## Session content

!`tessyn sessions show $ARGUMENTS --limit 50 2>&1`

## Instructions

You have received the content of a past session. Your job:

1. **Summarize** — provide a concise summary of the session:
   - What was the goal or topic?
   - What key decisions were made?
   - What was built or changed?
   - Were there unresolved issues or next steps?
2. **Make context available** — tell the user this context is now loaded and you can:
   - Answer questions about what happened in that session
   - Continue work that was started
   - Apply decisions or patterns from that session to current work
3. **Do NOT dump the transcript** — summarize and synthesize, don't repeat messages verbatim

If the output says "not running" or mentions a socket error, tell the user:
> Tessyn daemon is not running. Start it with `tessyn start -d` and try again.

If the session is not found, suggest using `/sessions` to browse available sessions or `/recall` to search for the right one.
