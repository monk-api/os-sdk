/**
 * OSClient - High-level client for Monk OS gateway
 *
 * Provides typed syscall methods for common operations.
 *
 * @module client
 */

import { Transport } from './transport.js';
import { SyscallError, ConnectionError } from './error.js';
import type {
    ConnectOptions,
    ConnectionState,
    Response,
    Stat,
    DirEntry,
    OpenFlags,
    SpawnOptions,
    SelectOptions,
} from './types.js';
import { isError, isOk, isItem, isData } from './types.js';

// =============================================================================
// CLIENT CLASS
// =============================================================================

/**
 * High-level client for Monk OS gateway.
 *
 * @example
 * const client = new OSClient();
 * await client.connect();
 *
 * // Single-value syscalls
 * const stat = await client.stat('/etc');
 * const fd = await client.open('/tmp/test.txt', { write: true, create: true });
 *
 * // Streaming syscalls
 * for await (const entry of client.readdir('/home')) {
 *     console.log(entry.name);
 * }
 *
 * await client.close();
 */
export class OSClient {
    private readonly transport: Transport;

    constructor() {
        this.transport = new Transport();
    }

    // =========================================================================
    // CONNECTION
    // =========================================================================

    /**
     * Connect to gateway.
     */
    async connect(options?: ConnectOptions): Promise<void> {
        await this.transport.connect(options);
    }

    /**
     * Close connection.
     */
    close(): void {
        this.transport.close();
    }

    /**
     * Get connection state.
     */
    getState(): ConnectionState {
        return this.transport.getState();
    }

    /**
     * Check if connected.
     */
    isConnected(): boolean {
        return this.transport.isConnected();
    }

    // =========================================================================
    // RAW SYSCALL ACCESS
    // =========================================================================

    /**
     * Execute a syscall and return the first response data.
     *
     * For single-value syscalls (proc:getpid, file:stat, etc.)
     *
     * @throws SyscallError on error response
     */
    async call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
        const id = this.transport.generateId();
        const responses = await this.transport.send({ id, call: name, args });

        if (responses.length === 0) {
            throw new SyscallError('EIO', 'No response received', name);
        }

        const response = responses[0];

        if (isError(response)) {
            throw SyscallError.fromResponse(response, name);
        }

        if (isOk(response)) {
            return (response.data ?? {}) as T;
        }

        // For streaming syscalls called with call(), return first item
        if (isItem(response)) {
            return response.data as T;
        }

        throw new SyscallError('EIO', `Unexpected response op: ${response.op}`, name);
    }

    /**
     * Execute a syscall and collect all items.
     *
     * For streaming syscalls (file:readdir, ems:select, etc.)
     *
     * @throws SyscallError on error response
     */
    async collect<T = unknown>(name: string, ...args: unknown[]): Promise<T[]> {
        const items: T[] = [];

        for await (const item of this.iterate<T>(name, ...args)) {
            items.push(item);
        }

        return items;
    }

    /**
     * Execute a syscall and iterate items as they arrive.
     *
     * For streaming syscalls with large result sets.
     *
     * @throws SyscallError on error response
     */
    async *iterate<T = unknown>(name: string, ...args: unknown[]): AsyncIterable<T> {
        const id = this.transport.generateId();

        for await (const response of this.transport.stream({ id, call: name, args })) {
            if (isError(response)) {
                throw SyscallError.fromResponse(response, name);
            }

            if (isItem(response)) {
                yield response.data as T;
            }

            if (isData(response)) {
                // Decode base64 to Uint8Array
                yield Buffer.from(response.bytes, 'base64') as unknown as T;
            }

            // ok/done/redirect are terminal - handled by transport
        }
    }

    /**
     * Execute a syscall and stream raw responses.
     *
     * For advanced use cases where you need full response access.
     */
    async *stream(name: string, ...args: unknown[]): AsyncIterable<Response> {
        const id = this.transport.generateId();

        yield* this.transport.stream({ id, call: name, args });
    }

    // =========================================================================
    // FILE SYSCALLS
    // =========================================================================

    /**
     * Open a file and return file descriptor.
     */
    async open(path: string, flags?: OpenFlags): Promise<number> {
        // Gateway returns fd directly as data: number
        return this.call<number>('file:open', path, flags);
    }

    /**
     * Close a file descriptor.
     */
    async fclose(fd: number): Promise<void> {
        await this.call('file:close', fd);
    }

    /**
     * Read from file descriptor.
     *
     * Returns all data as a single Uint8Array.
     */
    async read(fd: number, size?: number): Promise<Uint8Array> {
        const chunks: Uint8Array[] = [];

        for await (const response of this.stream('file:read', fd, size)) {
            if (isError(response)) {
                throw SyscallError.fromResponse(response, 'file:read');
            }

            if (isData(response)) {
                chunks.push(Buffer.from(response.bytes, 'base64'));
            }
        }

        // Concatenate chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        return result;
    }

    /**
     * Write to file descriptor.
     *
     * Binary data is sent as { data: Uint8Array } which the kernel expects.
     * However, JSON serialization loses Uint8Array type, so we send as
     * { data: Array<number> } which needs gateway/kernel support.
     *
     * @returns Number of bytes written
     */
    async write(fd: number, data: Uint8Array | string): Promise<number> {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        // Send as { data: [...] } - array of numbers survives JSON serialization
        const result = await this.call<{ written: number }>('file:write', fd, { data: Array.from(bytes) });

        return result.written;
    }

    /**
     * Get file/directory stats.
     */
    async stat(path: string): Promise<Stat> {
        return this.call<Stat>('file:stat', path);
    }

    /**
     * Get stats for open file descriptor.
     */
    async fstat(fd: number): Promise<Stat> {
        return this.call<Stat>('file:fstat', fd);
    }

    /**
     * Create directory.
     */
    async mkdir(path: string): Promise<void> {
        await this.call('file:mkdir', path);
    }

    /**
     * Remove file.
     */
    async unlink(path: string): Promise<void> {
        await this.call('file:unlink', path);
    }

    /**
     * Remove directory.
     */
    async rmdir(path: string): Promise<void> {
        await this.call('file:rmdir', path);
    }

    /**
     * Read directory entries.
     */
    async *readdir(path: string): AsyncIterable<DirEntry> {
        yield* this.iterate<DirEntry>('file:readdir', path);
    }

    /**
     * Read directory entries as array.
     */
    async readdirSync(path: string): Promise<DirEntry[]> {
        return this.collect<DirEntry>('file:readdir', path);
    }

    /**
     * Rename file or directory.
     */
    async rename(oldPath: string, newPath: string): Promise<void> {
        await this.call('file:rename', oldPath, newPath);
    }

    // =========================================================================
    // CONVENIENCE FILE OPERATIONS
    // =========================================================================

    /**
     * Read entire file contents.
     */
    async readFile(path: string): Promise<Uint8Array> {
        const fd = await this.open(path, { read: true });

        try {
            return await this.read(fd);
        }
        finally {
            await this.fclose(fd);
        }
    }

    /**
     * Read entire file as text.
     */
    async readText(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
        const data = await this.readFile(path);

        return Buffer.from(data).toString(encoding);
    }

    /**
     * Write data to file (creating if needed).
     */
    async writeFile(path: string, data: Uint8Array | string): Promise<void> {
        const fd = await this.open(path, { write: true, create: true, truncate: true });

        try {
            await this.write(fd, data);
        }
        finally {
            await this.fclose(fd);
        }
    }

    /**
     * Check if path exists.
     */
    async exists(path: string): Promise<boolean> {
        try {
            await this.stat(path);

            return true;
        }
        catch (err) {
            if (err instanceof SyscallError && err.code === 'ENOENT') {
                return false;
            }

            throw err;
        }
    }

    // =========================================================================
    // PROCESS SYSCALLS
    // =========================================================================

    /**
     * Get current process ID.
     */
    async getpid(): Promise<string> {
        // Gateway returns pid directly (may be number, convert to string)
        const result = await this.call<string | number>('proc:getpid');

        return String(result);
    }

    /**
     * Get parent process ID.
     */
    async getppid(): Promise<string> {
        // Gateway returns ppid directly (may be number, convert to string)
        const result = await this.call<string | number>('proc:getppid');

        return String(result);
    }

    /**
     * Get current working directory.
     */
    async getcwd(): Promise<string> {
        // Gateway returns cwd directly as string
        return this.call<string>('proc:getcwd');
    }

    /**
     * Change current working directory.
     */
    async chdir(path: string): Promise<void> {
        await this.call('proc:chdir', path);
    }

    /**
     * Get environment variable.
     */
    async getenv(name: string): Promise<string | undefined> {
        // Gateway returns value directly (or undefined/null if not set)
        const result = await this.call<string | null | undefined>('proc:getenv', name);

        return result ?? undefined;
    }

    /**
     * Set environment variable.
     */
    async setenv(name: string, value: string): Promise<void> {
        await this.call('proc:setenv', name, value);
    }

    /**
     * Spawn a child process.
     */
    async spawn(path: string, options?: SpawnOptions): Promise<string> {
        // Gateway returns pid directly (may be number, convert to string)
        const result = await this.call<string | number>('proc:spawn', path, options);

        return String(result);
    }

    // =========================================================================
    // EMS SYSCALLS
    // =========================================================================

    /**
     * Select entities from EMS.
     */
    async *select<T = Record<string, unknown>>(
        model: string,
        options?: SelectOptions,
    ): AsyncIterable<T> {
        yield* this.iterate<T>('ems:select', model, options);
    }

    /**
     * Select all entities as array.
     */
    async selectAll<T = Record<string, unknown>>(
        model: string,
        options?: SelectOptions,
    ): Promise<T[]> {
        return this.collect<T>('ems:select', model, options);
    }

    /**
     * Select single entity.
     */
    async selectOne<T = Record<string, unknown>>(
        model: string,
        options?: SelectOptions,
    ): Promise<T | undefined> {
        const results = await this.selectAll<T>(model, { ...options, limit: 1 });

        return results[0];
    }

    /**
     * Create entity in EMS.
     */
    async create<T = Record<string, unknown>>(
        model: string,
        data: Record<string, unknown>,
    ): Promise<T> {
        return this.call<T>('ems:create', model, data);
    }

    /**
     * Update entity in EMS.
     */
    async update<T = Record<string, unknown>>(
        model: string,
        id: string,
        data: Record<string, unknown>,
    ): Promise<T> {
        return this.call<T>('ems:update', model, id, data);
    }

    /**
     * Delete entity from EMS.
     */
    async delete(model: string, id: string): Promise<void> {
        await this.call('ems:delete', model, id);
    }

    // =========================================================================
    // CHANNEL SYSCALLS
    // =========================================================================

    /**
     * Open a channel (HTTP, WebSocket, PostgreSQL, etc.).
     */
    async channelOpen(
        protocol: string,
        url: string,
        options?: Record<string, unknown>,
    ): Promise<number> {
        // Gateway returns fd directly as number
        return this.call<number>('channel:open', protocol, url, options);
    }

    /**
     * Close a channel.
     */
    async channelClose(fd: number): Promise<void> {
        await this.call('channel:close', fd);
    }

    /**
     * Make a request/response call on a channel.
     */
    async channelCall<T = unknown>(fd: number, message: unknown): Promise<T> {
        return this.call<T>('channel:call', fd, message);
    }

    /**
     * Stream responses from a channel.
     */
    async *channelStream<T = unknown>(fd: number, message: unknown): AsyncIterable<T> {
        yield* this.iterate<T>('channel:stream', fd, message);
    }
}
