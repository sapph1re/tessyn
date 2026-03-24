import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { getStatus } from '../daemon/lifecycle.js';
import * as queries from '../db/queries.js';
import { fullReindex } from '../indexer/index.js';
import {
  createResponse,
  createErrorResponse,
  parseRequest,
  RPC_ERRORS,
  type JsonRpcResponse,
  type SessionsListParams,
  type SessionsGetParams,
  type SearchParams,
} from './types.js';

const log = createLogger('handlers');

/**
 * Handle a JSON-RPC request and return a response.
 */
export function handleRequest(db: Database.Database, raw: string): JsonRpcResponse {
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
        if (!params.id) {
          return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required parameter: id');
        }
        const session = queries.getSessionById(db, params.id);
        if (!session) {
          return createErrorResponse(request.id, RPC_ERRORS.SESSION_NOT_FOUND, `Session not found: ${params.id}`);
        }
        const messages = queries.getMessages(db, params.id, {
          limit: params.limit,
          offset: params.offset,
        });
        return createResponse(request.id, { session, messages });
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
          // FTS5 MATCH syntax errors from user input should be INVALID_PARAMS
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('fts5')) {
            return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, `Invalid search query: ${msg}`);
          }
          throw err; // Re-throw non-FTS errors for the outer catch
        }
      }

      case 'reindex': {
        // Run full reindex (synchronous — better-sqlite3 is sync anyway)
        const result = fullReindex(db);
        return createResponse(request.id, { indexed: result.indexed, total: result.total });
      }

      case 'shutdown': {
        // Signal the daemon to shut down gracefully
        log.info('Shutdown requested via RPC');
        // Set a brief timeout to allow the response to be sent before shutting down
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
