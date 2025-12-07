/**
 * Monk OS SDK - Client library for connecting to Monk OS gateway
 *
 * @example
 * import { OSClient } from '@monk-api/os-sdk';
 *
 * const client = new OSClient();
 * await client.connect({ socketPath: '/tmp/monk.sock' });
 *
 * // File operations
 * const stat = await client.stat('/etc');
 * const entries = await client.readdirSync('/home');
 * const content = await client.readText('/etc/motd');
 *
 * // EMS operations
 * for await (const user of client.select('User', { where: { active: true } })) {
 *     console.log(user.name);
 * }
 *
 * client.close();
 *
 * @module @monk-api/os-sdk
 */

// Main client
export { OSClient } from './client.js';

// Transport (for advanced use)
export { Transport } from './transport.js';

// Errors
export { SyscallError, ConnectionError, TimeoutError } from './error.js';

// Types
export type {
    // Request/Response
    Request,
    Response,
    ResponseOp,
    BaseResponse,
    OkResponse,
    ErrorResponse,
    DoneResponse,
    RedirectResponse,
    ItemResponse,
    DataResponse,
    EventResponse,
    ProgressResponse,

    // Connection
    ConnectOptions,
    ConnectionState,

    // Syscall types
    Stat,
    DirEntry,
    OpenFlags,
    SpawnOptions,
    SelectOptions,
} from './types.js';

// Type guards
export { isTerminal, isError, isOk, isItem, isData } from './types.js';
