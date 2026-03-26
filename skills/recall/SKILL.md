---
name: tessyn-recall
description: Search across all past Claude Code sessions using Tessyn's full-text search index. Use when the user wants to find previous conversations, recall how something was implemented, or find context from past work.
allowed-tools: Bash
argument-hint: <search query> [--project <slug>] [--limit <n>]
---

Search past Claude Code sessions for relevant context using Tessyn.

## Search results

!`tessyn search $ARGUMENTS --limit 10 2>&1`

## Instructions

Present the search results to the user clearly and concisely:

1. **Group by session** — if multiple results come from the same session, group them together
2. **Highlight relevance** — briefly explain why each result matches the query
3. **Include session IDs** — mention the session ID so the user can use `/session-context <id>` to load full context
4. **Summarize themes** — if there are many results, provide a brief summary of patterns across them

If the output says "not running" or mentions a socket error, tell the user:
> Tessyn daemon is not running. Start it with `tessyn start -d` and try again.

If no results are found, suggest trying different search terms, checking indexing status with `tessyn status`, or filtering by project with `--project`.
