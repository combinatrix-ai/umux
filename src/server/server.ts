/**
 * umux server
 */

import { existsSync, unlinkSync } from 'node:fs';
import { createAdaptorServer } from '@hono/node-server';
import { Umux } from '../core/index.js';
import {
  createGhosttyTerminalEngine,
  createGhosttyWasmTerminalEngine,
  createXtermTerminalEngine,
} from '../core/index.js';
import { createApp } from './app.js';
import type { ServerConfig } from './types.js';

export interface UmuxServer {
  /** The underlying Umux instance */
  umux: Umux;

  /** Stop the server */
  close(): Promise<void>;

  /** Server address info (for TCP mode) */
  address?: { host: string; port: number };

  /** Socket path (for Unix socket mode) */
  socketPath?: string;
}

/**
 * Start the umux server
 */
export async function startServer(config: ServerConfig = {}): Promise<UmuxServer> {
  const requestedEngine =
    config.terminalEngine ?? (process.env.UMUX_TERMINAL_ENGINE as ServerConfig['terminalEngine'] | undefined);
  const terminalEngine =
    requestedEngine === 'xterm'
      ? createXtermTerminalEngine
      : requestedEngine === 'ghostty-strict'
        ? createGhosttyWasmTerminalEngine
        : createGhosttyTerminalEngine;

  const umux = new Umux({ logDir: config.logDir, terminalEngine });
  const app = createApp(umux, config);

  // Unix socket mode
  if (config.socketPath) {
    // Clean up stale socket file
    if (existsSync(config.socketPath)) {
      unlinkSync(config.socketPath);
    }

    // Create server using @hono/node-server adaptor
    const server = createAdaptorServer({ fetch: app.fetch });

    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(config.socketPath, () => {
        console.log(`umux server listening on ${config.socketPath}`);
        resolve();
      });
    });

    return {
      umux,
      socketPath: config.socketPath,
      close: async () => {
        server.close();
        // Clean up socket file
        if (existsSync(config.socketPath!)) {
          unlinkSync(config.socketPath!);
        }
        umux.destroy();
      },
    };
  }

  // TCP mode
  const host = config.host ?? 'localhost';
  const port = config.port ?? 7070;

  const server = createAdaptorServer({ fetch: app.fetch });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      console.log(`umux server listening on http://${host}:${port}`);
      resolve();
    });
  });

  return {
    umux,
    address: { host, port },
    close: async () => {
      server.close();
      umux.destroy();
    },
  };
}
