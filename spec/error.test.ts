import { describe, expect, test } from 'bun:test';
import { SyscallError, ConnectionError, TimeoutError } from '../src/error.js';
import type { ErrorResponse } from '../src/types.js';

describe('SyscallError', () => {
    test('creates error with code and message', () => {
        const error = new SyscallError('ENOENT', 'No such file or directory');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(SyscallError);
        expect(error.name).toBe('SyscallError');
        expect(error.code).toBe('ENOENT');
        expect(error.message).toBe('No such file or directory');
        expect(error.syscall).toBeUndefined();
    });

    test('creates error with syscall name', () => {
        const error = new SyscallError('EBADF', 'Bad file descriptor', 'file:read');

        expect(error.code).toBe('EBADF');
        expect(error.message).toBe('Bad file descriptor');
        expect(error.syscall).toBe('file:read');
    });

    test('fromResponse creates error from ErrorResponse', () => {
        const response: ErrorResponse = {
            id: '123',
            op: 'error',
            code: 'EPERM',
            message: 'Permission denied',
        };

        const error = SyscallError.fromResponse(response, 'file:open');

        expect(error.code).toBe('EPERM');
        expect(error.message).toBe('Permission denied');
        expect(error.syscall).toBe('file:open');
    });

    test('toString includes syscall when present', () => {
        const error = new SyscallError('ENOENT', 'Not found', 'file:stat');

        expect(error.toString()).toBe('SyscallError: file:stat: ENOENT: Not found');
    });

    test('toString without syscall', () => {
        const error = new SyscallError('EIO', 'I/O error');

        expect(error.toString()).toBe('SyscallError: EIO: I/O error');
    });

    test('can be caught as Error', () => {
        const error = new SyscallError('EINVAL', 'Invalid argument');

        expect(() => {
            throw error;
        }).toThrow(Error);
    });

    test('instanceof works correctly', () => {
        const error = new SyscallError('EEXIST', 'File exists');

        expect(error instanceof SyscallError).toBe(true);
        expect(error instanceof Error).toBe(true);
    });
});

describe('ConnectionError', () => {
    test('creates error with code and message', () => {
        const error = new ConnectionError('ECONNREFUSED', 'Connection refused');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(ConnectionError);
        expect(error.name).toBe('ConnectionError');
        expect(error.code).toBe('ECONNREFUSED');
        expect(error.message).toBe('Connection refused');
    });

    test('instanceof works correctly', () => {
        const error = new ConnectionError('ENOTCONN', 'Not connected');

        expect(error instanceof ConnectionError).toBe(true);
        expect(error instanceof Error).toBe(true);
    });
});

describe('TimeoutError', () => {
    test('creates error with default message', () => {
        const error = new TimeoutError();

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(TimeoutError);
        expect(error.name).toBe('TimeoutError');
        expect(error.message).toBe('Operation timed out');
    });

    test('creates error with custom message', () => {
        const error = new TimeoutError('Request timed out after 5000ms');

        expect(error.message).toBe('Request timed out after 5000ms');
    });

    test('instanceof works correctly', () => {
        const error = new TimeoutError();

        expect(error instanceof TimeoutError).toBe(true);
        expect(error instanceof Error).toBe(true);
    });
});
