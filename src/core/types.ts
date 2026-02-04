/**
 * Core types for umux
 */

// ============================================================================
// Session (= Terminal)
// ============================================================================

export interface ForegroundProcess {
  /** Process ID */
  pid: number;
  /** Command name */
  command: string;
}

export interface Session {
  readonly id: string;
  readonly name: string;
  readonly pid: number;
  readonly cwd: string;
  readonly isAlive: boolean;
  readonly exitCode: number | null;
  readonly history: SessionHistory;
  readonly createdAt: Date;
  /** Current foreground process (null if shell is at prompt) */
  readonly foregroundProcess: ForegroundProcess | null;
  /** Capture the current screen buffer */
  capture(options?: CaptureOptions): CaptureResult;
}

export interface SessionHistory {
  /** Get all output */
  getAll(): string;

  /** Get last N lines (default: 10) */
  tail(lines?: number): string;

  /** Get first N lines (default: 10) */
  head(lines?: number): string;

  /** Get lines from start to end (0-indexed) */
  slice(start: number, end?: number): string;

  /** Search for pattern in history */
  search(pattern: RegExp | string): SearchMatch[];

  /** Total line count */
  lineCount(): number;

  /** Timestamp of last output (null if no output yet) */
  readonly lastOutputAt: Date | null;
}

export interface SearchMatch {
  line: number;
  column: number;
  text: string;
  context: { before: string; after: string };
}

// ============================================================================
// Configuration
// ============================================================================

export interface UmuxConfig {
  /** Log directory (when set, session I/O is appended as JSONL) */
  logDir?: string;

  /** Max lines to keep in memory per session (default: 10000) */
  historyLimit?: number;

  /** Default shell (default: $SHELL or /bin/sh) */
  defaultShell?: string;

  /**
   * Terminal state engine factory (used for screen capture and screenPattern waits).
   * Defaults to Ghostty VT (WASM) unless UMUX_TERMINAL_ENGINE is set to "xterm".
   */
  terminalEngine?: TerminalEngineFactory;
}

export interface SpawnOptions {
  /** Working directory */
  cwd?: string;

  /** Environment variables */
  env?: Record<string, string>;

  /** Session name for identification */
  name?: string;

  /** Terminal columns (default: 80) */
  cols?: number;

  /** Terminal rows (default: 43) */
  rows?: number;

  /** Per-session terminal engine override */
  terminalEngine?: TerminalEngineFactory;
}

export interface CaptureOptions {
  /** Output format (default: "text") */
  format?: 'text' | 'ansi';
}

export interface CaptureResult {
  /** Screen contents */
  content: string;
  /** Output format */
  format: 'text' | 'ansi';
  /** Terminal columns */
  cols: number;
  /** Terminal rows */
  rows: number;
}

// ============================================================================
// Terminal Engine (Screen State)
// ============================================================================

export interface TerminalEngine {
  write(data: string, onScreen?: () => void): void;
  resize(cols: number, rows: number): void;
  capture(options?: CaptureOptions): CaptureResult;
  dispose(): void;
}

export type TerminalEngineFactory = (opts: { cols: number; rows: number }) => TerminalEngine;

// ============================================================================
// Wait Conditions
// ============================================================================

export interface WaitCondition {
  /** Wait for output matching pattern */
  pattern?: RegExp | string;
  /** Wait for screen buffer matching pattern */
  screenPattern?: RegExp | string;

  /** Wait for N milliseconds of no output */
  idle?: number;

  /** Wait for process exit */
  exit?: boolean;

  /** Wait for shell to be ready (no foreground process) */
  ready?: boolean;

  /** Timeout in milliseconds (required unless UMUX_DEFAULT_TIMEOUT is set) */
  timeout?: number;

  /** Fail immediately if this pattern appears */
  not?: RegExp | string;
}

export interface WaitResult {
  /** Why waiting ended */
  reason: 'pattern' | 'screen' | 'idle' | 'exit' | 'ready' | 'timeout' | 'rejected';

  /** Pattern match (if reason is 'pattern') */
  match?: RegExpMatchArray;

  /** Exit code (if reason is 'exit') */
  exitCode?: number;

  /** Output or screen buffer captured during wait */
  output: string;

  /** Time spent waiting in milliseconds */
  waitedMs: number;
}

// ============================================================================
// Hooks (Background Commands)
// ============================================================================

export interface HookConfig {
  /** Unique hook identifier */
  id: string;

  /** Session ID to monitor */
  sessionId: string;

  /** Shell command to execute */
  run: string;

  /** Trigger when output matches this pattern (regex) */
  onMatch?: string;

  /** Trigger when shell becomes ready */
  onReady?: boolean;

  /** Trigger when session exits */
  onExit?: boolean;

  /** Remove hook after first trigger */
  once?: boolean;
}

export type HookEvent = 'match' | 'ready' | 'exit';

// ============================================================================
// Events
// ============================================================================

export type UmuxEventMap = {
  /** New output from session */
  output: { sessionId: string; data: string; timestamp: Date };

  /** Process exited */
  exit: { sessionId: string; exitCode: number };

  /** No output for specified duration */
  idle: { sessionId: string; idleMs: number };

  /** Shell became ready (foreground process ended) */
  ready: { sessionId: string };

  /** Watched pattern matched */
  pattern: { sessionId: string; name: string; match: RegExpMatchArray };

  /** Session created */
  'session:create': { session: Session };

  /** Session destroyed */
  'session:destroy': { sessionId: string };
};

// ============================================================================
// Pattern Watching
// ============================================================================

export interface PatternWatcher {
  /** Identifier for this pattern */
  name: string;

  /** Pattern to match */
  pattern: RegExp | string;

  /** Only fire once then auto-remove */
  once?: boolean;
}

export interface WatchOptions {
  /** Patterns to watch for */
  patterns?: PatternWatcher[];

  /** Emit 'idle' event after this many ms of no output */
  idleThreshold?: number;
}

export interface WatchHandle {
  /** Stop watching */
  stop(): void;

  /** Add a new pattern */
  addPattern(watcher: PatternWatcher): void;

  /** Remove pattern by name */
  removePattern(name: string): void;
}
