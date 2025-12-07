/**
 * SDK Types - Wire protocol types for gateway communication
 *
 * These types match the gateway wire protocol documented in:
 * @see os/src/gateway/README.md
 *
 * @module types
 */

// =============================================================================
// REQUEST TYPES
// =============================================================================

/**
 * Syscall request sent to gateway.
 *
 * @example
 * { id: "abc", call: "file:open", args: ["/etc/hosts", { read: true }] }
 */
export interface Request {
    /** Client-generated correlation ID */
    id: string;

    /** Syscall name (e.g., "file:open", "ems:select") */
    call: string;

    /** Syscall arguments */
    args: unknown[];
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/**
 * Response operation type.
 *
 * Terminal ops (end stream): ok, error, done, redirect
 * Non-terminal ops (stream continues): item, data, event, progress
 */
export type ResponseOp =
    | 'ok'
    | 'error'
    | 'done'
    | 'redirect'
    | 'item'
    | 'data'
    | 'event'
    | 'progress';

/**
 * Base response from gateway.
 */
export interface BaseResponse {
    /** Echoed from request */
    id: string;

    /** Operation type */
    op: ResponseOp;
}

/**
 * Success response with optional data.
 */
export interface OkResponse extends BaseResponse {
    op: 'ok';
    data?: Record<string, unknown>;
}

/**
 * Error response with code and message.
 */
export interface ErrorResponse extends BaseResponse {
    op: 'error';
    code: string;
    message: string;
}

/**
 * Stream completion marker.
 */
export interface DoneResponse extends BaseResponse {
    op: 'done';
}

/**
 * Redirect response (symlinks, mounts).
 */
export interface RedirectResponse extends BaseResponse {
    op: 'redirect';
    data?: Record<string, unknown>;
}

/**
 * Stream item response.
 */
export interface ItemResponse extends BaseResponse {
    op: 'item';
    data: Record<string, unknown>;
}

/**
 * Binary data response.
 */
export interface DataResponse extends BaseResponse {
    op: 'data';
    bytes: Uint8Array;
}

/**
 * Async event notification.
 */
export interface EventResponse extends BaseResponse {
    op: 'event';
    data?: Record<string, unknown>;
}

/**
 * Progress indicator.
 */
export interface ProgressResponse extends BaseResponse {
    op: 'progress';
    data?: Record<string, unknown>;
}

/**
 * Union of all response types.
 */
export type Response =
    | OkResponse
    | ErrorResponse
    | DoneResponse
    | RedirectResponse
    | ItemResponse
    | DataResponse
    | EventResponse
    | ProgressResponse;

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if response is terminal (ends the stream).
 */
export function isTerminal(response: Response): boolean {
    return response.op === 'ok' ||
           response.op === 'error' ||
           response.op === 'done' ||
           response.op === 'redirect';
}

/**
 * Check if response is an error.
 */
export function isError(response: Response): response is ErrorResponse {
    return response.op === 'error';
}

/**
 * Check if response is ok (success).
 */
export function isOk(response: Response): response is OkResponse {
    return response.op === 'ok';
}

/**
 * Check if response is a stream item.
 */
export function isItem(response: Response): response is ItemResponse {
    return response.op === 'item';
}

/**
 * Check if response contains binary data.
 */
export function isData(response: Response): response is DataResponse {
    return response.op === 'data';
}

// =============================================================================
// CONNECTION TYPES
// =============================================================================

/**
 * Connection options for OSClient.
 */
export interface ConnectOptions {
    /** Unix socket path (default: /tmp/monk.sock) */
    socketPath?: string;

    /** Connection timeout in ms (default: 5000) */
    timeout?: number;
}

/**
 * Connection state.
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

// =============================================================================
// SYSCALL RESULT TYPES
// =============================================================================

/**
 * File stat information.
 */
export interface Stat {
    id: string;
    name: string;
    model: string;
    size: number;
    created_at: string;
    updated_at: string;
    parent_id?: string;
}

/**
 * Directory entry.
 */
export interface DirEntry {
    name: string;
    model: string;
}

/**
 * Open flags for file:open.
 */
export interface OpenFlags {
    read?: boolean;
    write?: boolean;
    create?: boolean;
    truncate?: boolean;
    append?: boolean;
}

/**
 * Spawn options for proc:spawn.
 */
export interface SpawnOptions {
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

/**
 * EMS select query options.
 */
export interface SelectOptions {
    where?: Record<string, unknown>;
    order?: string | string[];
    limit?: number;
    offset?: number;
}
