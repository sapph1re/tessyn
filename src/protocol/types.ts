import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, JsonRpcError } from '../shared/types.js';

// Re-export for convenience
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, JsonRpcError };
export { RPC_ERRORS } from '../shared/types.js';

// === Request Parameter Types ===

export interface SessionsListParams {
  projectSlug?: string;
  state?: 'active' | 'deleted';
  limit?: number;
  offset?: number;
}

export interface SessionsGetParams {
  id: number;
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

export interface SubscribeParams {
  topics: string[]; // e.g., ['session.*', 'index.state_changed']
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
