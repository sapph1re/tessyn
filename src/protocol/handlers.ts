import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { getStatus } from '../daemon/lifecycle.js';
import * as queries from '../db/queries.js';
import { fullReindex } from '../indexer/index.js';
import { generateMissingTitles } from '../assist/titles.js';
import type { RunManager } from '../run/index.js';
import type { RunSendParams } from '../run/types.js';
import {
  createResponse,
  createErrorResponse,
  parseRequest,
  RPC_ERRORS,
  type JsonRpcResponse,
  type SessionsListParams,
  type SessionsGetParams,
  type SearchParams,
  type SessionRenameParams,
  type SessionHideParams,
  type SessionArchiveParams,
  type SessionTogglesSetParams,
  type SessionTogglesGetParams,
  type SessionDraftSaveParams,
  type SessionDraftGetParams,
} from './types.js';

const log = createLogger('handlers');

/**
 * Context passed to the request handler.
 * Provides access to all daemon subsystems that handlers may need.
 */
export interface HandlerContext {
  db: Database.Database;
  runManager?: RunManager;
}

/**
 * Handle a JSON-RPC request and return a response.
 * Some methods are async (title generation), so this returns a Promise.
 */
export async function handleRequest(ctx: HandlerContext, raw: string): Promise<JsonRpcResponse> {
  const { db } = ctx;
  const request = parseRequest(raw);

  if (!request) {
    return createErrorResponse(null, RPC_ERRORS.PARSE_ERROR, 'Invalid JSON-RPC request');
  }

  try {
    switch (request.method) {
      case 'status':
        return createResponse(request.id, getStatus());

      case 'sessions.list': {
        const params = (request.params ?? {}) as SessionsListParams;
        const sessions = queries.listSessions(db, {
          projectSlug: params.projectSlug,
          state: params.state,
          limit: params.limit,
          offset: params.offset,
        });
        return createResponse(request.id, { sessions });
      }

      case 'sessions.get': {
        const params = (request.params ?? {}) as unknown as SessionsGetParams;
        let session;
        if (params.externalId) {
          session = queries.getSessionByExternalId(db, params.provider ?? 'claude', params.externalId);
        } else if (params.id) {
          session = queries.getSessionById(db, params.id);
        } else {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required parameter: id or externalId');
        }
        if (!session) {
          return createErrorResponse(request.id, RPC_ERRORS.SESSION_NOT_FOUND, 'Session not found');
        }
        const messages = queries.getMessages(db, session.id, {
          limit: params.limit,
          offset: params.offset,
        });
        const meta = queries.getSessionMeta(db, session.provider, session.externalId);
        return createResponse(request.id, { session, messages, meta });
      }

      case 'search': {
        const params = (request.params ?? {}) as unknown as SearchParams;
        if (!params.query) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required parameter: query');
        }
        try {
          const results = queries.searchMessages(db, {
            query: params.query,
            projectSlug: params.projectSlug,
            role: params.role,
            limit: params.limit,
            offset: params.offset,
          });
          return createResponse(request.id, { results, count: results.length });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('fts5')) {
            return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, `Invalid search query: ${msg}`);
          }
          throw err;
        }
      }

      case 'reindex': {
        const result = fullReindex(db);
        return createResponse(request.id, { indexed: result.indexed, total: result.total });
      }

      case 'titles.generate': {
        const limit = (request.params?.['limit'] as number | undefined) ?? 50;
        const generated = await generateMissingTitles(db, limit);
        return createResponse(request.id, { generated });
      }

      case 'sessions.rename': {
        const params = (request.params ?? {}) as unknown as SessionRenameParams;
        if (!params.externalId || !params.title) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: externalId, title');
        }
        if (!queries.sessionExists(db, params.provider ?? 'claude', params.externalId)) {
          return createErrorResponse(request.id, RPC_ERRORS.SESSION_NOT_FOUND, 'Session not found');
        }
        queries.upsertSessionMeta(db, params.provider ?? 'claude', params.externalId, { title: params.title });
        return createResponse(request.id, { ok: true });
      }

      case 'sessions.hide': {
        const params = (request.params ?? {}) as unknown as SessionHideParams;
        if (!params.externalId || params.hidden === undefined) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: externalId, hidden');
        }
        if (!queries.sessionExists(db, params.provider ?? 'claude', params.externalId)) {
          return createErrorResponse(request.id, RPC_ERRORS.SESSION_NOT_FOUND, 'Session not found');
        }
        queries.upsertSessionMeta(db, params.provider ?? 'claude', params.externalId, { hidden: params.hidden });
        return createResponse(request.id, { ok: true });
      }

      case 'sessions.archive': {
        const params = (request.params ?? {}) as unknown as SessionArchiveParams;
        if (!params.externalId || params.archived === undefined) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: externalId, archived');
        }
        if (!queries.sessionExists(db, params.provider ?? 'claude', params.externalId)) {
          return createErrorResponse(request.id, RPC_ERRORS.SESSION_NOT_FOUND, 'Session not found');
        }
        queries.upsertSessionMeta(db, params.provider ?? 'claude', params.externalId, { archived: params.archived });
        return createResponse(request.id, { ok: true });
      }

      case 'sessions.toggles.get': {
        const params = (request.params ?? {}) as unknown as SessionTogglesGetParams;
        if (!params.externalId) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: externalId');
        }
        const toggles = queries.getSessionToggles(db, params.provider ?? 'claude', params.externalId);
        return createResponse(request.id, { toggles });
      }

      case 'sessions.toggles.set': {
        const params = (request.params ?? {}) as unknown as SessionTogglesSetParams;
        if (!params.externalId) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: externalId');
        }
        if (!queries.sessionExists(db, params.provider ?? 'claude', params.externalId)) {
          return createErrorResponse(request.id, RPC_ERRORS.SESSION_NOT_FOUND, 'Session not found');
        }
        const fields: Record<string, unknown> = {};
        if (params.autoCommit !== undefined) fields['autoCommit'] = params.autoCommit;
        if (params.autoBranch !== undefined) fields['autoBranch'] = params.autoBranch;
        if (params.autoDocument !== undefined) fields['autoDocument'] = params.autoDocument;
        if (params.autoCompact !== undefined) fields['autoCompact'] = params.autoCompact;
        queries.upsertSessionMeta(db, params.provider ?? 'claude', params.externalId, fields);
        const toggles = queries.getSessionToggles(db, params.provider ?? 'claude', params.externalId);
        return createResponse(request.id, { ok: true, toggles });
      }

      case 'sessions.draft.get': {
        const params = (request.params ?? {}) as unknown as SessionDraftGetParams;
        if (!params.externalId) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: externalId');
        }
        const meta = queries.getSessionMeta(db, params.provider ?? 'claude', params.externalId);
        return createResponse(request.id, { content: meta?.draft ?? null });
      }

      case 'sessions.draft.save': {
        const params = (request.params ?? {}) as unknown as SessionDraftSaveParams;
        if (!params.externalId || params.content === undefined) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: externalId, content');
        }
        if (!queries.sessionExists(db, params.provider ?? 'claude', params.externalId)) {
          return createErrorResponse(request.id, RPC_ERRORS.SESSION_NOT_FOUND, 'Session not found');
        }
        queries.upsertSessionMeta(db, params.provider ?? 'claude', params.externalId, { draft: params.content });
        return createResponse(request.id, { ok: true });
      }

      case 'run.send': {
        if (!ctx.runManager) {
          return createErrorResponse(request.id, RPC_ERRORS.INTERNAL_ERROR, 'RunManager not initialized');
        }
        const { isClaudeAvailable } = await import('../assist/titles.js');
        if (!(await isClaudeAvailable())) {
          return createErrorResponse(request.id, RPC_ERRORS.CLAUDE_NOT_AVAILABLE, 'Claude CLI not found. Install it first.');
        }
        const params = request.params as unknown as RunSendParams | undefined;
        if (!params?.prompt || !params?.projectPath) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: prompt, projectPath');
        }
        try {
          const runId = await ctx.runManager.send(params);
          return createResponse(request.id, { runId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Max concurrent')) {
            return createErrorResponse(request.id, RPC_ERRORS.RUN_LIMIT_REACHED, msg);
          }
          throw err;
        }
      }

      case 'run.cancel': {
        if (!ctx.runManager) {
          return createErrorResponse(request.id, RPC_ERRORS.INTERNAL_ERROR, 'RunManager not initialized');
        }
        const runId = request.params?.['runId'] as string | undefined;
        if (!runId) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: runId');
        }
        const cancelled = ctx.runManager.cancel(runId);
        if (!cancelled) {
          return createErrorResponse(request.id, RPC_ERRORS.RUN_NOT_FOUND, `Run not found: ${runId}`);
        }
        return createResponse(request.id, { ok: true });
      }

      case 'run.list': {
        if (!ctx.runManager) {
          return createResponse(request.id, { runs: [] });
        }
        return createResponse(request.id, { runs: ctx.runManager.getActiveRuns() });
      }

      case 'run.get': {
        if (!ctx.runManager) {
          return createErrorResponse(request.id, RPC_ERRORS.INTERNAL_ERROR, 'RunManager not initialized');
        }
        const id = request.params?.['runId'] as string | undefined;
        if (!id) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required: runId');
        }
        const run = ctx.runManager.getRun(id);
        return createResponse(request.id, { run });
      }

      case 'shutdown': {
        log.info('Shutdown requested via RPC');
        setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 100);
        return createResponse(request.id, { message: 'Shutting down' });
      }

      default:
        return createErrorResponse(request.id, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
    }
  } catch (err) {
    log.error('Handler error', {
      method: request.method,
      error: err instanceof Error ? err.message : String(err),
    });
    return createErrorResponse(
      request.id,
      RPC_ERRORS.INTERNAL_ERROR,
      err instanceof Error ? err.message : 'Internal error',
    );
  }
}
