import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, JsonRpcError } from '../shared/types.js';

// Re-export for convenience
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, JsonRpcError };
export { RPC_ERRORS } from '../shared/types.js';

// === Request Parameter Types ===

export interface SessionsListParams {
  projectSlug?: string;
  state?: 'active' | 'deleted';
  hidden?: boolean;   // default: false (exclude hidden)
  archived?: boolean; // default: false (exclude archived)
  limit?: number;
  offset?: number;
}

export interface SessionsGetParams {
  id?: number;
  externalId?: string;
  provider?: string; // defaults to 'claude'
  limit?: number;
  offset?: number;
}

export interface SearchParams {
  query: string;
  projectSlug?: string;
  role?: 'user' | 'assistant' | 'system';
  limit?: number;
  offset?: number;
}

export interface SessionRenameParams {
  externalId: string;
  provider?: string;
  title: string;
}

export interface SessionHideParams {
  externalId: string;
  provider?: string;
  hidden: boolean;
}

export interface SessionArchiveParams {
  externalId: string;
  provider?: string;
  archived: boolean;
}

export interface SessionTogglesSetParams {
  externalId: string;
  provider?: string;
  autoCommit?: boolean | null;
  autoBranch?: boolean | null;
  autoDocument?: boolean | null;
  autoCompact?: boolean | null;
}

export interface SessionTogglesGetParams {
  externalId: string;
  provider?: string;
}

export interface SessionDraftSaveParams {
  externalId: string;
  provider?: string;
  content: string;
}

export interface SessionDraftGetParams {
  externalId: string;
  provider?: string;
}

export interface SubscribeParams {
  topics: string[];
}

export interface UnsubscribeParams {
  topics: string[];
}

// === Helper Functions ===

export function createResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createErrorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

export function createNotification(method: string, params?: Record<string, unknown>): JsonRpcNotification {
  return { jsonrpc: '2.0', method, params };
}

export function parseRequest(data: string): JsonRpcRequest | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed['jsonrpc'] !== '2.0' || typeof parsed['method'] !== 'string') {
      return null;
    }
    return {
      jsonrpc: '2.0',
      id: parsed['id'] as string | number,
      method: parsed['method'] as string,
      params: parsed['params'] as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}
