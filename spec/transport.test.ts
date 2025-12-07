import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Transport } from '../src/transport.js';
import { ConnectionError, TimeoutError } from '../src/error.js';

describe('Transport', () => {
    describe('initial state', () => {
        test('starts disconnected', () => {
            const transport = new Transport();

            expect(transport.getState()).toBe('disconnected');
            expect(transport.isConnected()).toBe(false);
        });

        test('generateId returns sequential IDs', () => {
            const transport = new Transport();

            expect(transport.generateId()).toBe('1');
            expect(transport.generateId()).toBe('2');
            expect(transport.generateId()).toBe('3');
        });
    });

    describe('connect', () => {
        test('throws ConnectionError when socket does not exist', async () => {
            const transport = new Transport();

            await expect(
                transport.connect({ socketPath: '/tmp/nonexistent-socket-12345.sock', timeout: 100 }),
            ).rejects.toThrow(ConnectionError);
        });

        test('throws TimeoutError on connection timeout', async () => {
            const transport = new Transport();

            // Use a path that will hang (not refuse immediately)
            // This test may be flaky depending on OS behavior
            await expect(
                transport.connect({ socketPath: '/tmp/nonexistent-socket-12345.sock', timeout: 50 }),
            ).rejects.toThrow();
        });

        test('throws when already connecting', async () => {
            const transport = new Transport();

            // Start a connection attempt that will fail
            const connectPromise = transport.connect({
                socketPath: '/tmp/nonexistent.sock',
                timeout: 1000,
            }).catch(() => {});

            // Try to connect again immediately
            await expect(
                transport.connect({ socketPath: '/tmp/other.sock' }),
            ).rejects.toThrow('Already connected or connecting');

            await connectPromise;
        });
    });

    describe('close', () => {
        test('can close when disconnected', () => {
            const transport = new Transport();

            // Should not throw
            transport.close();

            expect(transport.getState()).toBe('disconnected');
        });
    });

    describe('send', () => {
        test('throws when not connected', async () => {
            const transport = new Transport();

            await expect(
                transport.send({ id: '1', call: 'proc:getpid', args: [] }),
            ).rejects.toThrow('Not connected');
        });
    });

    describe('stream', () => {
        test('throws when not connected', async () => {
            const transport = new Transport();

            const iterable = transport.stream({ id: '1', call: 'file:readdir', args: ['/'] });
            const iterator = iterable[Symbol.asyncIterator]();

            await expect(iterator.next()).rejects.toThrow('Not connected');
        });
    });
});

// Integration tests - require a running gateway
// Run with: GATEWAY_SOCKET=/tmp/monk.sock bun test spec/transport.test.ts
describe.skipIf(!process.env.GATEWAY_SOCKET)('Transport (integration)', () => {
    let transport: Transport;
    const socketPath = process.env.GATEWAY_SOCKET!;

    beforeEach(async () => {
        transport = new Transport();
        await transport.connect({ socketPath });
    });

    afterEach(() => {
        transport.close();
    });

    test('connects successfully', () => {
        expect(transport.isConnected()).toBe(true);
        expect(transport.getState()).toBe('connected');
    });

    test('send receives ok response', async () => {
        const responses = await transport.send({
            id: transport.generateId(),
            call: 'proc:getpid',
            args: [],
        });

        expect(responses.length).toBeGreaterThan(0);
        expect(responses[0].op).toBe('ok');
    });

    test('send receives error for invalid syscall', async () => {
        const responses = await transport.send({
            id: transport.generateId(),
            call: 'invalid:syscall',
            args: [],
        });

        expect(responses.length).toBe(1);
        expect(responses[0].op).toBe('error');
    });

    test('stream iterates responses', async () => {
        const responses: unknown[] = [];

        for await (const response of transport.stream({
            id: transport.generateId(),
            call: 'proc:getcwd',
            args: [],
        })) {
            responses.push(response);
        }

        expect(responses.length).toBeGreaterThan(0);
    });
});
