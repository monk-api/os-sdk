import { describe, expect, test } from 'bun:test';
import {
    isTerminal,
    isError,
    isOk,
    isItem,
    isData,
    type Response,
    type OkResponse,
    type ErrorResponse,
    type ItemResponse,
    type DataResponse,
    type DoneResponse,
    type RedirectResponse,
    type EventResponse,
    type ProgressResponse,
} from '../src/types.js';

describe('types', () => {
    describe('isTerminal', () => {
        test('ok is terminal', () => {
            const response: OkResponse = { id: '1', op: 'ok', data: { foo: 'bar' } };
            expect(isTerminal(response)).toBe(true);
        });

        test('error is terminal', () => {
            const response: ErrorResponse = { id: '1', op: 'error', code: 'ENOENT', message: 'Not found' };
            expect(isTerminal(response)).toBe(true);
        });

        test('done is terminal', () => {
            const response: DoneResponse = { id: '1', op: 'done' };
            expect(isTerminal(response)).toBe(true);
        });

        test('redirect is terminal', () => {
            const response: RedirectResponse = { id: '1', op: 'redirect', data: { path: '/new' } };
            expect(isTerminal(response)).toBe(true);
        });

        test('item is not terminal', () => {
            const response: ItemResponse = { id: '1', op: 'item', data: { name: 'test' } };
            expect(isTerminal(response)).toBe(false);
        });

        test('data is not terminal', () => {
            const response: DataResponse = { id: '1', op: 'data', bytes: new Uint8Array([72, 101, 108, 108, 111]) };
            expect(isTerminal(response)).toBe(false);
        });

        test('event is not terminal', () => {
            const response: EventResponse = { id: '1', op: 'event', data: { type: 'change' } };
            expect(isTerminal(response)).toBe(false);
        });

        test('progress is not terminal', () => {
            const response: ProgressResponse = { id: '1', op: 'progress', data: { percent: 50 } };
            expect(isTerminal(response)).toBe(false);
        });
    });

    describe('isError', () => {
        test('returns true for error response', () => {
            const response: ErrorResponse = { id: '1', op: 'error', code: 'ENOENT', message: 'Not found' };
            expect(isError(response)).toBe(true);
        });

        test('returns false for ok response', () => {
            const response: OkResponse = { id: '1', op: 'ok' };
            expect(isError(response)).toBe(false);
        });

        test('returns false for item response', () => {
            const response: ItemResponse = { id: '1', op: 'item', data: {} };
            expect(isError(response)).toBe(false);
        });
    });

    describe('isOk', () => {
        test('returns true for ok response', () => {
            const response: OkResponse = { id: '1', op: 'ok', data: { value: 42 } };
            expect(isOk(response)).toBe(true);
        });

        test('returns false for error response', () => {
            const response: ErrorResponse = { id: '1', op: 'error', code: 'EIO', message: 'I/O error' };
            expect(isOk(response)).toBe(false);
        });

        test('returns false for done response', () => {
            const response: DoneResponse = { id: '1', op: 'done' };
            expect(isOk(response)).toBe(false);
        });
    });

    describe('isItem', () => {
        test('returns true for item response', () => {
            const response: ItemResponse = { id: '1', op: 'item', data: { name: 'file.txt' } };
            expect(isItem(response)).toBe(true);
        });

        test('returns false for ok response', () => {
            const response: OkResponse = { id: '1', op: 'ok' };
            expect(isItem(response)).toBe(false);
        });

        test('returns false for data response', () => {
            const response: DataResponse = { id: '1', op: 'data', bytes: new Uint8Array([116, 101, 115, 116]) };
            expect(isItem(response)).toBe(false);
        });
    });

    describe('isData', () => {
        test('returns true for data response', () => {
            const response: DataResponse = { id: '1', op: 'data', bytes: new Uint8Array([72, 101, 108, 108, 111]) };
            expect(isData(response)).toBe(true);
        });

        test('returns false for item response', () => {
            const response: ItemResponse = { id: '1', op: 'item', data: {} };
            expect(isData(response)).toBe(false);
        });

        test('returns false for ok response', () => {
            const response: OkResponse = { id: '1', op: 'ok' };
            expect(isData(response)).toBe(false);
        });
    });
});
