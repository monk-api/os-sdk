/**
 * Transport - Low-level Unix socket communication
 *
 * Handles connection management, message framing (newline-delimited JSON),
 * and request/response correlation.
 *
 * @module transport
 */

import type { Request, Response, ConnectOptions, ConnectionState } from './types.js';
import { isTerminal } from './types.js';
import { ConnectionError, TimeoutError } from './error.js';

// =============================================================================
// SOCKET TYPES
// =============================================================================

/**
 * Socket data stored per connection.
 */
interface SocketData {
    buffer: string;
}

/**
 * Socket type from Bun.connect.
 */
type BunSocket = Awaited<ReturnType<typeof Bun.connect<SocketData>>>;

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_SOCKET_PATH = '/tmp/monk.sock';
const DEFAULT_TIMEOUT = 5000;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Pending request waiting for response(s).
 */
interface PendingRequest {
    /** Resolve promise with responses */
    resolve: (responses: Response[]) => void;

    /** Reject promise with error */
    reject: (error: Error) => void;

    /** Collected responses */
    responses: Response[];

    /** Timeout timer */
    timer?: ReturnType<typeof setTimeout>;
}

// =============================================================================
// TRANSPORT CLASS
// =============================================================================

/**
 * Low-level transport for gateway communication.
 *
 * Handles:
 * - Unix socket connection lifecycle
 * - Newline-delimited JSON framing
 * - Request/response correlation by ID
 * - Streaming responses (multiple items before done)
 *
 * @example
 * const transport = new Transport();
 * await transport.connect({ socketPath: '/tmp/monk.sock' });
 *
 * const responses = await transport.send({
 *     id: '1',
 *     call: 'file:stat',
 *     args: ['/etc']
 * });
 *
 * transport.close();
 */
export class Transport {
    // =========================================================================
    // STATE
    // =========================================================================

    /** Current connection state */
    private state: ConnectionState = 'disconnected';

    /** Socket connection */
    private socket?: BunSocket;

    /** Pending requests by ID */
    private pending = new Map<string, PendingRequest>();

    /** Request ID counter */
    private nextId = 1;

    /** Text encoder for socket writes */
    private readonly encoder = new TextEncoder();

    // =========================================================================
    // PUBLIC ACCESSORS
    // =========================================================================

    /**
     * Get current connection state.
     */
    getState(): ConnectionState {
        return this.state;
    }

    /**
     * Check if connected.
     */
    isConnected(): boolean {
        return this.state === 'connected';
    }

    /**
     * Generate unique request ID.
     */
    generateId(): string {
        return String(this.nextId++);
    }

    // =========================================================================
    // CONNECTION LIFECYCLE
    // =========================================================================

    /**
     * Connect to gateway.
     *
     * @param options - Connection options
     * @throws ConnectionError if connection fails
     * @throws TimeoutError if connection times out
     */
    async connect(options: ConnectOptions = {}): Promise<void> {
        if (this.state !== 'disconnected') {
            throw new ConnectionError('EISCONN', 'Already connected or connecting');
        }

        const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
        const timeout = options.timeout ?? DEFAULT_TIMEOUT;

        this.state = 'connecting';

        try {
            await this.connectWithTimeout(socketPath, timeout);
            this.state = 'connected';
        }
        catch (err) {
            this.state = 'disconnected';
            throw err;
        }
    }

    /**
     * Connect with timeout.
     */
    private async connectWithTimeout(socketPath: string, timeout: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new TimeoutError(`Connection to ${socketPath} timed out after ${timeout}ms`));
            }, timeout);

            Bun.connect<SocketData>({
                unix: socketPath,
                data: { buffer: '' },
                socket: {
                    data: (socket, data) => {
                        this.onData(socket, data);
                    },
                    open: (socket) => {
                        clearTimeout(timer);
                        this.socket = socket;
                        resolve();
                    },
                    close: () => {
                        this.onClose();
                    },
                    error: (_socket, error) => {
                        clearTimeout(timer);
                        reject(new ConnectionError('ECONNREFUSED', error.message));
                    },
                    connectError: (_socket, error) => {
                        clearTimeout(timer);
                        reject(new ConnectionError('ECONNREFUSED', error.message));
                    },
                },
            }).catch((err) => {
                clearTimeout(timer);
                reject(new ConnectionError('ECONNREFUSED', err.message));
            });
        });
    }

    /**
     * Close connection.
     */
    close(): void {
        if (this.socket) {
            this.socket.end();
            this.socket = undefined;
        }

        this.state = 'disconnected';

        // Reject all pending requests
        for (const [id, pending] of this.pending) {
            if (pending.timer) {
                clearTimeout(pending.timer);
            }

            pending.reject(new ConnectionError('ECONNRESET', 'Connection closed'));
            this.pending.delete(id);
        }
    }

    // =========================================================================
    // SEND/RECEIVE
    // =========================================================================

    /**
     * Send request and collect all responses.
     *
     * Waits for a terminal response (ok, error, done, redirect) before resolving.
     *
     * @param request - Request to send
     * @param timeout - Response timeout in ms (default: 30000)
     * @returns All responses (may be multiple for streaming syscalls)
     * @throws ConnectionError if not connected
     * @throws TimeoutError if no response within timeout
     */
    async send(request: Request, timeout = 30000): Promise<Response[]> {
        if (!this.socket || this.state !== 'connected') {
            throw new ConnectionError('ENOTCONN', 'Not connected');
        }

        return new Promise((resolve, reject) => {
            // Set up pending request
            const pending: PendingRequest = {
                resolve,
                reject,
                responses: [],
                timer: setTimeout(() => {
                    this.pending.delete(request.id);
                    reject(new TimeoutError(`Request ${request.id} timed out after ${timeout}ms`));
                }, timeout),
            };

            this.pending.set(request.id, pending);

            // Send request as JSON line
            const line = JSON.stringify(request) + '\n';

            try {
                this.socket!.write(this.encoder.encode(line));
            }
            catch (err) {
                this.pending.delete(request.id);

                if (pending.timer) {
                    clearTimeout(pending.timer);
                }

                reject(new ConnectionError('EIO', (err as Error).message));
            }
        });
    }

    /**
     * Send request and iterate responses as they arrive.
     *
     * Use this for streaming syscalls where you want to process items
     * as they come in rather than waiting for all of them.
     *
     * @param request - Request to send
     * @yields Response objects as they arrive
     * @throws ConnectionError if not connected
     */
    async *stream(request: Request): AsyncIterable<Response> {
        if (!this.socket || this.state !== 'connected') {
            throw new ConnectionError('ENOTCONN', 'Not connected');
        }

        // WHY: Use a queue + resolver pattern for async iteration
        // Each response is pushed to the queue, and the iterator pulls from it
        const queue: Response[] = [];
        let resolver: ((value: IteratorResult<Response>) => void) | null = null;
        let error: Error | null = null;
        let done = false;

        // Register handler for this request ID
        const handler = (response: Response) => {
            if (isTerminal(response)) {
                done = true;
            }

            if (resolver) {
                resolver({ value: response, done: false });
                resolver = null;
            }
            else {
                queue.push(response);
            }
        };

        const errorHandler = (err: Error) => {
            error = err;

            if (resolver) {
                resolver({ value: undefined as unknown as Response, done: true });
                resolver = null;
            }
        };

        // Store handlers
        this.pending.set(request.id, {
            resolve: () => {},
            reject: errorHandler,
            responses: [],
        });

        // Override to use our handler
        const originalOnResponse = this.onResponse.bind(this);

        this.onResponse = (response: Response) => {
            if (response.id === request.id) {
                handler(response);
            }
            else {
                originalOnResponse(response);
            }
        };

        try {
            // Send request
            const line = JSON.stringify(request) + '\n';

            this.socket!.write(this.encoder.encode(line));

            // Iterate responses
            while (!done && !error) {
                if (queue.length > 0) {
                    const response = queue.shift()!;

                    yield response;

                    if (isTerminal(response)) {
                        break;
                    }
                }
                else {
                    // Wait for next response
                    const result = await new Promise<IteratorResult<Response>>((resolve) => {
                        resolver = resolve;
                    });

                    if (result.done) {
                        break;
                    }

                    yield result.value;

                    if (isTerminal(result.value)) {
                        break;
                    }
                }
            }

            if (error) {
                throw error;
            }
        }
        finally {
            // Restore original handler
            this.onResponse = originalOnResponse;
            this.pending.delete(request.id);
        }
    }

    // =========================================================================
    // SOCKET HANDLERS
    // =========================================================================

    /**
     * Handle incoming data from socket.
     */
    private onData(socket: BunSocket, data: Buffer): void {
        socket.data.buffer += data.toString();

        // Process complete lines
        let newlineIdx: number;

        while ((newlineIdx = socket.data.buffer.indexOf('\n')) !== -1) {
            const line = socket.data.buffer.slice(0, newlineIdx);

            socket.data.buffer = socket.data.buffer.slice(newlineIdx + 1);

            if (line.trim()) {
                try {
                    const response = JSON.parse(line) as Response;

                    this.onResponse(response);
                }
                catch {
                    // Invalid JSON - ignore
                }
            }
        }
    }

    /**
     * Handle response message.
     *
     * Routes response to pending request by ID.
     */
    private onResponse(response: Response): void {
        const pending = this.pending.get(response.id);

        if (!pending) {
            return;
        }

        pending.responses.push(response);

        // Terminal responses complete the request
        if (isTerminal(response)) {
            if (pending.timer) {
                clearTimeout(pending.timer);
            }

            this.pending.delete(response.id);
            pending.resolve(pending.responses);
        }
    }

    /**
     * Handle socket close.
     */
    private onClose(): void {
        this.socket = undefined;
        this.state = 'disconnected';

        // Reject all pending requests
        for (const [id, pending] of this.pending) {
            if (pending.timer) {
                clearTimeout(pending.timer);
            }

            pending.reject(new ConnectionError('ECONNRESET', 'Connection closed'));
            this.pending.delete(id);
        }
    }
}
