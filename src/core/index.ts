/**
 * @umux/core - Agent-ready terminal multiplexer
 */

export { EventEmitter } from './events.js';
export { History } from './history.js';
export { HookManager } from './hooks.js';
export { createGhosttyTerminalEngine, createGhosttyWasmTerminalEngine } from './ghostty-engine.js';
export { createXtermTerminalEngine, XtermTerminalEngine } from './terminal-engine.js';
export type { KeyInput, ModifiedKey, SpecialKey } from './keys.js';
// Keys
export { alt, ctrl, encodeKey, encodeKeys, Key, meta, shift } from './keys.js';
// Internal (for @umux/server)
export { SessionImpl } from './session.js';
// Types
export type {
  CaptureOptions,
  CaptureResult,
  ForegroundProcess,
  HookConfig,
  HookEvent,
  PatternWatcher,
  SearchMatch,
  Session,
  SessionHistory,
  SpawnOptions,
  TerminalEngine,
  TerminalEngineFactory,
  UmuxConfig,
  UmuxEventMap,
  WaitCondition,
  WaitResult,
  WatchHandle,
  WatchOptions,
} from './types.js';
// Main class
export { Umux } from './umux.js';
