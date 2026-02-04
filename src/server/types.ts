/**
 * Server types
 */

import type { HookConfig } from '../core/types.js';

export interface ServerConfig {
  /** Unix socket path (takes precedence over host/port) */
  socketPath?: string;

  /** Port to listen on (default: 7070) */
  port?: number;

  /** Host to bind to (default: localhost) */
  host?: string;

  /** Authentication */
  auth?: {
    type: 'token' | 'none';
    token?: string;
  };

  /** Registered hooks */
  hooks?: HookConfig[];

  /**
   * When set, session I/O is appended as JSONL into this directory.
   * You can also set UMUX_LOG_DIR in the server environment.
   */
  logDir?: string;

  /**
   * Terminal engine used for screen state (capture/screenPattern).
   * Defaults to Ghostty VT (with xterm fallback) unless overridden by UMUX_TERMINAL_ENGINE.
   */
  terminalEngine?: 'xterm' | 'ghostty' | 'ghostty-strict';
}

// API request/response types

export interface CreateHookRequest {
  sessionId: string;
  run: string;
  onMatch?: string;
  onReady?: boolean;
  onExit?: boolean;
  once?: boolean;
}

export interface SpawnSessionRequest {
  /** Program to spawn (default: $SHELL) */
  command?: string;
  name?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Terminal columns (default: 80) */
  cols?: number;
  /** Terminal rows (default: 43) */
  rows?: number;
}

export interface ResizeRequest {
  cols: number;
  rows: number;
}

export interface SendRequest {
  data: string;
}

export interface SendKeyRequest {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface SendKeysRequest {
  keys: Array<{
    key?: string;
    text?: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  }>;
}

export interface WaitRequest {
  condition: {
    pattern?: string;
    screenPattern?: string;
    idle?: number;
    exit?: boolean;
    ready?: boolean;
    timeout?: number;
    not?: string;
  };
}

export interface KillRequest {
  signal?: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
