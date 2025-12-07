# @monk-api/os-sdk

Client SDK for connecting to Monk OS via the gateway Unix socket.

## Installation

```bash
bun add @monk-api/os-sdk
```

## Quick Start

```typescript
import { OSClient } from '@monk-api/os-sdk';

const client = new OSClient();
await client.connect({ socketPath: '/tmp/monk.sock' });

// File operations
const stat = await client.stat('/etc');
console.log(stat.model, stat.name);

// Read directory
for await (const entry of client.readdir('/home')) {
    console.log(entry.name, entry.model);
}

// Process info
const cwd = await client.getcwd();
const pid = await client.getpid();

client.close();
```

## Connection

```typescript
import { OSClient } from '@monk-api/os-sdk';

const client = new OSClient();

// Connect with defaults (socket: /tmp/monk.sock, timeout: 5000ms)
await client.connect();

// Or with options
await client.connect({
    socketPath: '/var/run/monk.sock',
    timeout: 10000,
});

// Check connection state
client.isConnected();    // true
client.getState();       // 'connected' | 'connecting' | 'disconnected'

// Close when done
client.close();
```

## File Operations

### Basic I/O

```typescript
// Open/close
const fd = await client.open('/tmp/data.txt', { read: true });
await client.fclose(fd);

// Open flags
await client.open(path, {
    read: true,      // Open for reading
    write: true,     // Open for writing
    create: true,    // Create if not exists
    truncate: true,  // Truncate existing content
    append: true,    // Append mode
});

// Read (returns Uint8Array)
const data = await client.read(fd);
const chunk = await client.read(fd, 1024);  // Read up to 1024 bytes

// Note: write() requires gateway binary support (see Limitations)
```

### Convenience Methods

```typescript
// Read entire file
const bytes = await client.readFile('/etc/motd');
const text = await client.readText('/etc/motd');

// Check existence
if (await client.exists('/tmp/myfile')) {
    // ...
}

// Stat
const stat = await client.stat('/etc');
// { id, name, model, size, created_at, updated_at, ... }
```

### Directory Operations

```typescript
// Create/remove directories
await client.mkdir('/tmp/mydir');
await client.rmdir('/tmp/mydir');

// List directory (streaming)
for await (const entry of client.readdir('/home')) {
    console.log(entry.name, entry.model);  // 'file' | 'folder'
}

// List directory (array)
const entries = await client.readdirSync('/home');

// Remove file
await client.unlink('/tmp/file.txt');

// Rename
await client.rename('/tmp/old.txt', '/tmp/new.txt');
```

## Process Operations

```typescript
// Identity
const pid = await client.getpid();
const ppid = await client.getppid();

// Working directory
const cwd = await client.getcwd();
await client.chdir('/tmp');

// Environment
await client.setenv('MY_VAR', 'value');
const value = await client.getenv('MY_VAR');

// Spawn process
const childPid = await client.spawn('/bin/myprogram', {
    args: ['--flag', 'value'],
    env: { KEY: 'value' },
    cwd: '/tmp',
});
```

## EMS (Entity Management)

```typescript
// Select with streaming
for await (const user of client.select('User', { where: { active: true } })) {
    console.log(user.name);
}

// Select as array
const users = await client.selectAll('User', {
    where: { role: 'admin' },
    order: 'created_at',
    limit: 10,
});

// Select single entity
const user = await client.selectOne('User', { where: { email: 'alice@example.com' } });

// Create
const newUser = await client.create('User', { name: 'Bob', email: 'bob@example.com' });

// Update
const updated = await client.update('User', userId, { name: 'Robert' });

// Delete
await client.delete('User', userId);
```

## Raw Syscall Access

For syscalls not wrapped by convenience methods:

```typescript
// Single-value syscall (returns response.data directly)
const result = await client.call<number>('proc:getpid');

// Streaming syscall - collect all items
const items = await client.collect<DirEntry>('file:readdir', '/');

// Streaming syscall - iterate as they arrive
for await (const item of client.iterate('file:readdir', '/')) {
    console.log(item);
}

// Raw response stream (advanced)
for await (const response of client.stream('file:readdir', '/')) {
    if (response.op === 'item') console.log(response.data);
    if (response.op === 'error') throw new Error(response.message);
}
```

## Error Handling

```typescript
import { OSClient, SyscallError, ConnectionError, TimeoutError } from '@monk-api/os-sdk';

try {
    await client.stat('/nonexistent');
}
catch (err) {
    if (err instanceof SyscallError) {
        console.log(err.code);     // 'ENOENT'
        console.log(err.message);  // 'No such file or directory'
        console.log(err.syscall);  // 'file:stat'
    }
}

// Common error codes
// ENOENT  - No such file or directory
// EBADF   - Bad file descriptor
// EPERM   - Permission denied
// EEXIST  - File exists
// EINVAL  - Invalid argument
// EIO     - I/O error
// ENOSYS  - Function not implemented
// EISDIR  - Is a directory
// ENOTDIR - Not a directory
```

## Type Exports

```typescript
import type {
    // Connection
    ConnectOptions,
    ConnectionState,

    // Wire protocol
    Request,
    Response,
    ResponseOp,

    // Syscall types
    Stat,
    DirEntry,
    OpenFlags,
    SpawnOptions,
    SelectOptions,
} from '@monk-api/os-sdk';

// Type guards
import { isTerminal, isError, isOk, isItem, isData } from '@monk-api/os-sdk';
```

## Limitations

### Binary Write Not Yet Supported

Writing binary data via `write()` and `writeFile()` is not yet functional. The gateway needs to support binary data encoding over JSON. See [GATEWAY_BINARY_DATA.md](../os/docs/bugs/GATEWAY_BINARY_DATA.md).

```typescript
// These will fail with EINVAL until gateway is updated:
await client.write(fd, data);
await client.writeFile(path, content);
```

### Read-only file operations work:
```typescript
// These work:
await client.readFile(path);
await client.readText(path);
await client.read(fd);
```

## Development

```bash
# Install dependencies
bun install

# Run tests (unit tests only)
bun test

# Run tests with live gateway
GATEWAY_SOCKET=/tmp/monk.sock bun test

# Type check
bun run typecheck
```

## License

See LICENSE.md
