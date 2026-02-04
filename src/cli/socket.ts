/**
 * Socket utilities for umux CLI
 * Supports Unix sockets (Linux/macOS) and named pipes (Windows)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';

/**
 * Get the default socket directory for the current user
 */
export function getSocketDir(): string {
  if (isWindows) {
    // Windows doesn't need a directory for named pipes
    return '';
  }

  // Linux: prefer XDG_RUNTIME_DIR (usually /run/user/$UID)
  // Falls back to /tmp/umux-$UID
  if (process.platform === 'linux' && process.env.XDG_RUNTIME_DIR) {
    return join(process.env.XDG_RUNTIME_DIR, 'umux');
  }

  // macOS: use user-specific temp directory
  // Linux fallback: use /tmp/umux-$UID
  const uid = process.getuid?.() ?? 0;
  return join(tmpdir(), `umux-${uid}`);
}

/**
 * Get the default socket path
 */
export function getDefaultSocketPath(): string {
  if (isWindows) {
    // Windows named pipe
    return '\\\\.\\pipe\\umux-default';
  }
  return join(getSocketDir(), 'default.sock');
}

/**
 * Ensure the socket directory exists with proper permissions
 */
export function ensureSocketDir(): void {
  if (isWindows) {
    // Windows named pipes don't need a directory
    return;
  }

  const dir = getSocketDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700, recursive: true });
  }
}

/**
 * Check if a server is listening on the socket
 */
export function isServerRunning(socketPath: string = getDefaultSocketPath()): Promise<boolean> {
  return new Promise((resolve) => {
    // For Unix sockets, check if file exists first
    // For Windows named pipes, we just try to connect
    if (!isWindows && !existsSync(socketPath)) {
      resolve(false);
      return;
    }

    const socket = connect(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      // Socket file exists but no server - clean up stale socket (Unix only)
      if (!isWindows) {
        try {
          unlinkSync(socketPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      resolve(false);
    });
  });
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * Check if a server is listening on a TCP host/port
 */
export function isServerRunningTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Start the server in the background
 */
export async function startServerInBackground(
  socketPath: string = getDefaultSocketPath()
): Promise<void> {
  ensureSocketDir();

  // Find the CLI entry point
  const binPath = new URL('./bin.js', import.meta.url).pathname;

  // Spawn detached process
  const child = spawn(process.execPath, [binPath, 'server', '--socket', socketPath], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  // Wait for server to be ready
  // CI environments may be slower, so allow longer timeout via env var
  const timeoutMs = parseInt(process.env.UMUX_SERVER_START_TIMEOUT ?? '15000', 10);
  const maxAttempts = Math.ceil(timeoutMs / 100);
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isServerRunning(socketPath)) {
      return;
    }
  }

  throw new Error(
    `Server failed to start within ${timeoutMs}ms timeout. ` +
      `Try setting UMUX_SERVER_START_TIMEOUT to a larger value (milliseconds).`
  );
}

/**
 * Start a TCP server in the background (localhost / loopback only)
 */
export async function startServerInBackgroundTcp(options: {
  host: string;
  port: number;
  token?: string;
}): Promise<void> {
  const { host, port, token } = options;
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Refusing to auto-start TCP server for non-loopback host: ${host}. ` +
        `Use --host 127.0.0.1 (recommended) or start the server manually with --token. ` +
        `Example: TOKEN=$(openssl rand -hex 16); umux server --tcp --host ${host} --port ${port} --token $TOKEN`
    );
  }

  // Find the CLI entry point
  const binPath = new URL('./bin.js', import.meta.url).pathname;

  const args = ['server', '--tcp', '--host', host, '--port', String(port)];
  if (token) {
    args.push('--token', token);
  }

  const child = spawn(process.execPath, [binPath, ...args], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  const timeoutMs = parseInt(process.env.UMUX_SERVER_START_TIMEOUT ?? '15000', 10);
  const maxAttempts = Math.ceil(timeoutMs / 100);
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isServerRunningTcp(host, port)) {
      return;
    }
  }

  throw new Error(
    `TCP server failed to start within ${timeoutMs}ms timeout. ` +
      `Try setting UMUX_SERVER_START_TIMEOUT to a larger value (milliseconds).`
  );
}

/**
 * Ensure a server is running, starting one if necessary
 */
export async function ensureServer(socketPath: string = getDefaultSocketPath()): Promise<void> {
  if (await isServerRunning(socketPath)) {
    return;
  }
  await startServerInBackground(socketPath);
}

export async function ensureServerTcp(options: {
  host: string;
  port: number;
  token?: string;
}): Promise<void> {
  const { host, port, token } = options;
  if (await isServerRunningTcp(host, port)) {
    return;
  }
  await startServerInBackgroundTcp({ host, port, token });
}

/**
 * Clean up socket file (for server shutdown)
 */
export function cleanupSocket(socketPath: string): void {
  if (isWindows) {
    // Windows named pipes are cleaned up automatically
    return;
  }

  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}
