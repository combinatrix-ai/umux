/**
 * umux - Agent-ready terminal multiplexer
 */

// CLI
export { createProgram } from './cli/index.js';
export { HookManager } from './core/hooks.js';
export type {
  ForegroundProcess,
  HookConfig,
  HookEvent,
  KeyInput,
  ModifiedKey,
  PatternWatcher,
  SearchMatch,
  Session,
  SessionHistory,
  SpawnOptions,
  SpecialKey,
  UmuxConfig,
  UmuxEventMap,
  WaitCondition,
  WaitResult,
  WatchHandle,
  WatchOptions,
} from './core/index.js';
// Core
export {
  alt,
  createGhosttyTerminalEngine,
  createGhosttyWasmTerminalEngine,
  createXtermTerminalEngine,
  ctrl,
  encodeKey,
  encodeKeys,
  Key,
  meta,
  shift,
  Umux,
} from './core/index.js';
export type {
  ServerConfig,
  UmuxServer,
} from './server/index.js';
// Server
export { createApp, startServer } from './server/index.js';
