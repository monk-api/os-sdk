import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { OSClient } from '../src/client.js';
import { SyscallError, ConnectionError } from '../src/error.js';

describe('OSClient', () => {
    describe('initial state', () => {
        test('starts disconnected', () => {
            const client = new OSClient();

            expect(client.getState()).toBe('disconnected');
            expect(client.isConnected()).toBe(false);
        });
    });

    describe('connect', () => {
        test('throws when socket does not exist', async () => {
            const client = new OSClient();

            await expect(
                client.connect({ socketPath: '/tmp/nonexistent-12345.sock', timeout: 100 }),
            ).rejects.toThrow();
        });
    });

    describe('close', () => {
        test('can close when disconnected', () => {
            const client = new OSClient();

            // Should not throw
            client.close();

            expect(client.getState()).toBe('disconnected');
        });
    });

    describe('call', () => {
        test('throws when not connected', async () => {
            const client = new OSClient();

            await expect(
                client.call('proc:getpid'),
            ).rejects.toThrow('Not connected');
        });
    });

    describe('collect', () => {
        test('throws when not connected', async () => {
            const client = new OSClient();

            await expect(
                client.collect('file:readdir', '/'),
            ).rejects.toThrow('Not connected');
        });
    });
});

// Integration tests - require a running gateway
// Run with: GATEWAY_SOCKET=/tmp/monk.sock bun test spec/client.test.ts
describe.skipIf(!process.env.GATEWAY_SOCKET)('OSClient (integration)', () => {
    let client: OSClient;
    const socketPath = process.env.GATEWAY_SOCKET!;

    beforeEach(async () => {
        client = new OSClient();
        await client.connect({ socketPath });
    });

    afterEach(() => {
        client.close();
    });

    describe('connection', () => {
        test('connects successfully', () => {
            expect(client.isConnected()).toBe(true);
        });
    });

    describe('process syscalls', () => {
        test('getpid returns string', async () => {
            const pid = await client.getpid();

            expect(typeof pid).toBe('string');
            expect(pid.length).toBeGreaterThan(0);
        });

        test('getppid returns string', async () => {
            const ppid = await client.getppid();

            expect(typeof ppid).toBe('string');
        });

        test('getcwd returns path', async () => {
            const cwd = await client.getcwd();

            expect(typeof cwd).toBe('string');
            expect(cwd.startsWith('/')).toBe(true);
        });

        test('chdir changes directory', async () => {
            await client.chdir('/tmp');
            const cwd = await client.getcwd();

            expect(cwd).toBe('/tmp');
        });

        test('getenv/setenv work', async () => {
            await client.setenv('TEST_VAR', 'test_value');
            const value = await client.getenv('TEST_VAR');

            expect(value).toBe('test_value');
        });
    });

    describe('file syscalls', () => {
        test('stat returns file info', async () => {
            const stat = await client.stat('/');

            expect(stat.id).toBeDefined();
            expect(stat.name).toBe('');
            expect(stat.model).toBe('folder');
        });

        test('stat throws ENOENT for missing file', async () => {
            await expect(
                client.stat('/nonexistent-path-12345'),
            ).rejects.toThrow(SyscallError);

            try {
                await client.stat('/nonexistent-path-12345');
            }
            catch (err) {
                expect((err as SyscallError).code).toBe('ENOENT');
            }
        });

        test('exists returns true for existing path', async () => {
            const exists = await client.exists('/');

            expect(exists).toBe(true);
        });

        test('exists returns false for missing path', async () => {
            const exists = await client.exists('/nonexistent-12345');

            expect(exists).toBe(false);
        });

        test('mkdir/rmdir create and remove directory', async () => {
            const path = `/tmp/test-${Date.now()}`;

            await client.mkdir(path);

            const stat = await client.stat(path);
            expect(stat.model).toBe('folder');

            await client.rmdir(path);

            const exists = await client.exists(path);
            expect(exists).toBe(false);
        });

        test('readdir lists entries', async () => {
            const entries: unknown[] = [];

            for await (const entry of client.readdir('/')) {
                entries.push(entry);
            }

            expect(entries.length).toBeGreaterThan(0);
        });

        test('readdirSync returns array', async () => {
            const entries = await client.readdirSync('/');

            expect(Array.isArray(entries)).toBe(true);
            expect(entries.length).toBeGreaterThan(0);
        });

        // TODO: These tests require gateway support for binary data over JSON
        // The kernel expects { data: Uint8Array } but JSON serialization loses the type.
        // Gateway needs to decode number[] or base64 back to Uint8Array.
        test.skip('open/write/read/fclose work together', async () => {
            const path = `/tmp/test-file-${Date.now()}.txt`;
            const content = 'Hello, World!';

            // Write
            const wfd = await client.open(path, { write: true, create: true });
            await client.write(wfd, content);
            await client.fclose(wfd);

            // Read
            const rfd = await client.open(path, { read: true });
            const data = await client.read(rfd);
            await client.fclose(rfd);

            const text = new TextDecoder().decode(data);
            expect(text).toBe(content);

            // Cleanup
            await client.unlink(path);
        });

        test.skip('readFile convenience method', async () => {
            const path = `/tmp/test-readfile-${Date.now()}.txt`;

            await client.writeFile(path, 'Test content');
            const data = await client.readFile(path);

            expect(new TextDecoder().decode(data)).toBe('Test content');

            await client.unlink(path);
        });

        test.skip('readText convenience method', async () => {
            const path = `/tmp/test-readtext-${Date.now()}.txt`;

            await client.writeFile(path, 'Text content');
            const text = await client.readText(path);

            expect(text).toBe('Text content');

            await client.unlink(path);
        });
    });

    describe('raw syscall access', () => {
        test('call works for single-value syscalls', async () => {
            // Gateway returns direct value, not wrapped object
            const result = await client.call<string>('proc:getcwd');

            expect(typeof result).toBe('string');
            expect(result.startsWith('/')).toBe(true);
        });

        test('collect works for streaming syscalls', async () => {
            const entries = await client.collect('file:readdir', '/');

            expect(Array.isArray(entries)).toBe(true);
        });

        test('iterate works for streaming syscalls', async () => {
            const entries: unknown[] = [];

            for await (const entry of client.iterate('file:readdir', '/')) {
                entries.push(entry);
            }

            expect(entries.length).toBeGreaterThan(0);
        });
    });
});
