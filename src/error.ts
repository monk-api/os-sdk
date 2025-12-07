/**
 * SyscallError - Error class for syscall failures
 *
 * Wraps gateway error responses with POSIX-style error codes.
 *
 * @module error
 */

import type { ErrorResponse } from './types.js';

/**
 * Error thrown when a syscall fails.
 *
 * Contains the POSIX-style error code (e.g., ENOENT, EBADF, EPERM)
 * and a human-readable message.
 *
 * @example
 * try {
 *     await client.call('file:open', '/nonexistent');
 * }
 * catch (err) {
 *     if (err instanceof SyscallError && err.code === 'ENOENT') {
 *         console.log('File not found');
 *     }
 * }
 */
export class SyscallError extends Error {
    /**
     * POSIX-style error code.
     *
     * Common codes:
     * - ENOENT: No such file or directory
     * - EBADF: Bad file descriptor
     * - EPERM: Permission denied
     * - EEXIST: File exists
     * - EINVAL: Invalid argument
     * - EIO: I/O error
     * - ENOSYS: Function not implemented
     * - ETIMEDOUT: Connection timed out
     */
    readonly code: string;

    /**
     * Syscall that failed (if known).
     */
    readonly syscall?: string;

    constructor(code: string, message: string, syscall?: string) {
        super(message);
        this.name = 'SyscallError';
        this.code = code;
        this.syscall = syscall;

        // Ensure prototype chain is correct
        Object.setPrototypeOf(this, SyscallError.prototype);
    }

    /**
     * Create SyscallError from gateway error response.
     */
    static fromResponse(response: ErrorResponse, syscall?: string): SyscallError {
        return new SyscallError(response.code, response.message, syscall);
    }

    /**
     * Format error as string.
     */
    toString(): string {
        if (this.syscall) {
            return `SyscallError: ${this.syscall}: ${this.code}: ${this.message}`;
        }

        return `SyscallError: ${this.code}: ${this.message}`;
    }
}

/**
 * Connection error - thrown when socket connection fails.
 */
export class ConnectionError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'ConnectionError';
        this.code = code;

        Object.setPrototypeOf(this, ConnectionError.prototype);
    }
}

/**
 * Timeout error - thrown when operation times out.
 */
export class TimeoutError extends Error {
    constructor(message: string = 'Operation timed out') {
        super(message);
        this.name = 'TimeoutError';

        Object.setPrototypeOf(this, TimeoutError.prototype);
    }
}
