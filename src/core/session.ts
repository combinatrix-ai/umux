/**
 * Session implementation - wraps a PTY process (1 session = 1 terminal)
 */

import * as pty from 'node-pty';

import { execSync } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { History } from './history.js';
import { encodeKey, encodeKeys, type KeyInput } from './keys.js';
import { createXtermTerminalEngine } from './terminal-engine.js';
import type {
  CaptureOptions,
  CaptureResult,
  ForegroundProcess,
  Session as ISession,
  SessionHistory,
  SpawnOptions,
  TerminalEngine,
  TerminalEngineFactory,
} from './types.js';

export interface SessionEvents {
  output: { sessionId: string; data: string; timestamp: Date };
  exit: { sessionId: string; exitCode: number };
  screen: { sessionId: string; timestamp: Date };
}

type SessionEventHandler<K extends keyof SessionEvents> = (event: SessionEvents[K]) => void;

export class SessionImpl implements ISession {
  readonly id: string;
  readonly name: string;
  readonly pid: number;
  readonly cwd: string;
  readonly history: SessionHistory;
  readonly inputHistory: History;
  readonly createdAt: Date;

  private _isAlive = true;
  private _exitCode: number | null = null;
  private readonly ptyProcess: pty.IPty;
  private readonly terminalEngine: TerminalEngine;
  private readonly _history: History;
  private readonly _inputHistory: History;
  private readonly logInput: boolean;
  private jsonlLogStream: ReturnType<typeof createWriteStream> | null = null;
  private readonly eventHandlers = new Map<
    keyof SessionEvents,
    Set<SessionEventHandler<keyof SessionEvents>>
  >();
  private cols = 80;
  private rows = 24;
  private queryScanTail = '';

  constructor(
    command: string,
    options: SpawnOptions = {},
    historyLimit = 10000,
    logDir = '',
    terminalEngineFactory?: TerminalEngineFactory,
  ) {
    this.id = `sess-${nanoid(8)}`;
    this.name = options.name ?? this.id;
    this.cwd = options.cwd ?? process.cwd();
    this.createdAt = new Date();
    this._history = new History(historyLimit);
    this.history = this._history;
    this._inputHistory = new History(historyLimit, false);
    this.inputHistory = this._inputHistory;
    this.logInput = shouldLogInput();

    const normalizedLogDir = logDir.trim();
    if (normalizedLogDir) {
      mkdirSync(normalizedLogDir, { recursive: true });
      const datePrefix = formatDateYYYYMMDD(this.createdAt);
      const filename = `${datePrefix}_${this.id}.log.jsonl`;
      const path = join(normalizedLogDir, filename);
      this.jsonlLogStream = createWriteStream(path, { flags: 'a' });
      this.writeJsonlLog({
        ts: this.createdAt.toISOString(),
        event: 'spawn',
        sessionId: this.id,
        name: this.name,
        cwd: this.cwd,
      });
    }

    // Always spawn interactively
    // command is the program to run (e.g., "bash", "python3", "node --experimental-repl-await")
    // If empty, use $SHELL
    const program = command || process.env.SHELL || '/bin/sh';
    const parts = program.split(/\s+/);
    const shell = parts[0];
    const args = parts.slice(1);

    const cols = options.cols ?? 80;
    const rows = options.rows ?? 43;
    this.cols = cols;
    this.rows = rows;

    // Initialize terminal state engine for screen captures / screenPattern waits
    const factory = options.terminalEngine ?? terminalEngineFactory ?? createXtermTerminalEngine;
    this.terminalEngine = factory({ cols, rows });

    // Spawn PTY
    this.ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cwd: this.cwd,
      env: { ...process.env, ...options.env } as Record<string, string>,
      cols,
      rows,
    });

    this.pid = this.ptyProcess.pid;

    // Handle output
    this.ptyProcess.onData((data) => {
      this.respondToTerminalQueries(data);
      this.writeJsonlLog({
        ts: new Date().toISOString(),
        sessionId: this.id,
        stream: 'output',
        data,
      });
      this._history.append(data);
      this.terminalEngine.write(data, () => {
        this.emitEvent('screen', {
          sessionId: this.id,
          timestamp: new Date(),
        });
      });
      this.emitEvent('output', {
        sessionId: this.id,
        data,
        timestamp: new Date(),
      });
    });

    // Handle exit
    this.ptyProcess.onExit(({ exitCode }) => {
      this._isAlive = false;
      this._exitCode = exitCode;
      this.writeJsonlLog({
        ts: new Date().toISOString(),
        event: 'exit',
        sessionId: this.id,
        exitCode,
      });
      this.closeJsonlLogStream();
      this.emitEvent('exit', {
        sessionId: this.id,
        exitCode,
      });
    });
  }

  get isAlive(): boolean {
    return this._isAlive;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  /**
   * Get the current foreground process (if any)
   */
  get foregroundProcess(): ForegroundProcess | null {
    if (!this._isAlive) {
      return null;
    }

    try {
      // Find child processes of the shell
      const pgrepResult = execSync(`pgrep -P ${this.pid} 2>/dev/null || true`, {
        encoding: 'utf-8',
        timeout: 1000,
      }).trim();

      if (!pgrepResult) {
        return null; // No child processes, shell is at prompt
      }

      // Get the first child process (usually the foreground one)
      const childPids = pgrepResult.split('\n').filter(Boolean);
      if (childPids.length === 0) {
        return null;
      }

      // Check if any child is in foreground (has '+' in STAT)
      for (const childPid of childPids) {
        const psResult = execSync(`ps -o pid=,stat=,comm= -p ${childPid} 2>/dev/null || true`, {
          encoding: 'utf-8',
          timeout: 1000,
        }).trim();

        if (!psResult) continue;

        const parts = psResult.trim().split(/\s+/);
        if (parts.length >= 3) {
          const stat = parts[1];
          const command = parts.slice(2).join(' ');
          // '+' in STAT indicates foreground process group
          if (stat.includes('+')) {
            return {
              pid: parseInt(childPid, 10),
              command,
            };
          }
        }
      }

      return null;
    } catch {
      // If detection fails, assume no foreground process
      return null;
    }
  }

  /**
   * Send text data to the session
   */
  send(data: string): void {
    if (!this._isAlive) {
      throw new Error(`Session ${this.id} is not alive`);
    }
    if (this.logInput) {
      this._inputHistory.append(data);
      this.writeJsonlLog({
        ts: new Date().toISOString(),
        sessionId: this.id,
        stream: 'input',
        kind: 'text',
        data,
      });
    }
    this.writeRaw(data);
  }

  /**
   * Send a key to the session
   */
  sendKey(key: KeyInput): void {
    if (!this._isAlive) {
      throw new Error(`Session ${this.id} is not alive`);
    }
    if (this.logInput) {
      this._inputHistory.append(formatKeyInputForLog(key));
      this.writeJsonlLog({
        ts: new Date().toISOString(),
        sessionId: this.id,
        stream: 'input',
        kind: 'key',
        key: formatKeyInputForLog(key),
      });
    }
    this.writeRaw(encodeKey(key));
  }

  /**
   * Send multiple keys to the session
   */
  sendKeys(keys: KeyInput[]): void {
    if (!this._isAlive) {
      throw new Error(`Session ${this.id} is not alive`);
    }
    if (this.logInput) {
      for (const key of keys) {
        this._inputHistory.append(formatKeyInputForLog(key));
      }
      this.writeJsonlLog({
        ts: new Date().toISOString(),
        sessionId: this.id,
        stream: 'input',
        kind: 'keys',
        keys: keys.map((k) => formatKeyInputForLog(k)),
      });
    }
    this.writeRaw(encodeKeys(keys));
  }

  private writeRaw(data: string): void {
    this.ptyProcess.write(data);
  }

  /**
   * Best-effort terminal query responses for TUIs.
   *
   * Some interactive programs expect the terminal emulator to answer queries like
   * cursor position (CPR) or device attributes (DA). Since umux embeds only the
   * process PTY, we emulate a minimal subset by replying on stdin.
   */
  private respondToTerminalQueries(data: string): void {
    const scan = this.queryScanTail + data;
    this.queryScanTail = scan.slice(-64);

    const logTerminalQueries = ['1', 'true', 'yes', 'on'].includes(
      (process.env.UMUX_LOG_TERMINAL_QUERIES ?? '').trim().toLowerCase(),
    );
    const reply = (payload: string, note: string) => {
      if (logTerminalQueries) {
        this.writeJsonlLog({
          ts: new Date().toISOString(),
          sessionId: this.id,
          stream: 'input',
          kind: 'terminal_query_response',
          note,
          data: payload,
        });
      }
      this.writeRaw(payload);
    };

    // Cursor Position Report request: CSI 6 n => reply CSI {row};{col} R
    if (scan.includes('\u001b[6n')) {
      // We don't track the real cursor position. Many TUIs just need *a* valid reply
      // to decide that CPR is supported. Use a stable, safe position (1,1).
      reply(`\u001b[1;1R`, 'CPR');
    }

    // Device Status Report: CSI 5 n => reply CSI 0 n (OK)
    if (scan.includes('\u001b[5n')) {
      reply('\u001b[0n', 'DSR');
    }

    // Primary Device Attributes: ESC [ c or CSI 0 c
    if (scan.includes('\u001b[c') || scan.includes('\u001b[0c')) {
      reply('\u001b[?1;2c', 'DA1');
    }

    // Secondary Device Attributes: CSI > c or CSI > 0 c
    if (scan.includes('\u001b[>c') || scan.includes('\u001b[>0c')) {
      reply('\u001b[>0;0;0c', 'DA2');
    }

    // DECID: ESC Z (VT100 "Identify")
    if (scan.includes('\u001bZ')) {
      reply('\u001b[?1;2c', 'DECID');
    }

    // Kitty keyboard protocol query: CSI ? u => reply CSI ? flags u
    // We report "disabled" (0) for now.
    if (scan.includes('\u001b[?u')) {
      reply('\u001b[?0u', 'KITTY_KBD_QUERY');
    }

    // Xterm window ops: request terminal size
    // - CSI 18 t => Report size in characters: CSI 8 ; <rows> ; <cols> t
    // - CSI 14 t => Report size in pixels: CSI 4 ; <height> ; <width> t
    if (scan.includes('\u001b[18t')) {
      reply(`\u001b[8;${Math.max(1, this.rows)};${Math.max(1, this.cols)}t`, 'XTERM_SIZE_CHARS');
    }
    if (scan.includes('\u001b[14t')) {
      // We don't know pixel size; reply with 0x0 (allowed by some apps)
      reply(`\u001b[4;0;0t`, 'XTERM_SIZE_PX');
    }

    // Xterm-style color queries:
    // - OSC 10;? => foreground color
    // - OSC 11;? => background color
    // - OSC 12;? => cursor color
    //
    // Respond with sane defaults using ST terminator.
    if (scan.includes('\u001b]10;?\u001b\\') || scan.includes('\u001b]10;?\u0007')) {
      reply('\u001b]10;rgb:ffff/ffff/ffff\u001b\\', 'OSC_FG_QUERY');
    }
    if (scan.includes('\u001b]11;?\u001b\\') || scan.includes('\u001b]11;?\u0007')) {
      reply('\u001b]11;rgb:0000/0000/0000\u001b\\', 'OSC_BG_QUERY');
    }
    if (scan.includes('\u001b]12;?\u001b\\') || scan.includes('\u001b]12;?\u0007')) {
      reply('\u001b]12;rgb:ffff/ffff/ffff\u001b\\', 'OSC_CURSOR_QUERY');
    }
  }

  /**
   * Kill the session process
   */
  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this._isAlive) {
      this.ptyProcess.kill(signal);
    }
  }

  /**
   * Resize the session terminal
   */
  resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows);
    this.terminalEngine.resize(cols, rows);
    this.cols = cols;
    this.rows = rows;
  }

  /**
   * Capture current screen buffer
   */
  capture(options: CaptureOptions = {}): CaptureResult {
    return this.terminalEngine.capture(options);
  }

  /**
   * Subscribe to session events
   */
  on<K extends keyof SessionEvents>(event: K, handler: SessionEventHandler<K>): void {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(handler as SessionEventHandler<keyof SessionEvents>);
  }

  /**
   * Unsubscribe from session events
   */
  off<K extends keyof SessionEvents>(event: K, handler: SessionEventHandler<K>): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      set.delete(handler as SessionEventHandler<keyof SessionEvents>);
    }
  }

  private emitEvent<K extends keyof SessionEvents>(event: K, data: SessionEvents[K]): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          (handler as SessionEventHandler<K>)(data);
        } catch (err) {
          console.error(`Error in session event handler for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this._isAlive) {
      this.kill();
    }
    this.terminalEngine.dispose();
    this.closeJsonlLogStream();
    this.eventHandlers.clear();
  }

  private writeJsonlLog(event: Record<string, unknown>): void {
    if (!this.jsonlLogStream) return;
    try {
      this.jsonlLogStream.write(`${JSON.stringify(event)}\n`);
    } catch {
      // Best-effort logging: ignore disk errors to avoid breaking session semantics.
    }
  }

  private closeJsonlLogStream(): void {
    if (!this.jsonlLogStream) return;
    try {
      this.jsonlLogStream.end();
      this.jsonlLogStream = null;
    } catch {
      // Ignore close errors
    }
  }
}

function shouldLogInput(): boolean {
  // Default ON. Allow opt-out via env var.
  // Examples:
  // - UMUX_LOG_INPUT=0
  // - UMUX_LOG_INPUT=false
  const raw = process.env.UMUX_LOG_INPUT;
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

function formatKeyInputForLog(key: KeyInput): string {
  if (typeof key === 'string') {
    return key;
  }

  if (typeof key === 'symbol') {
    const desc = key.description ?? 'Unknown';
    return `<${desc}>`;
  }

  const base = typeof key.key === 'symbol' ? (key.key.description ?? 'Unknown') : String(key.key);
  const mods: string[] = [];
  if (key.ctrl) mods.push('Ctrl');
  if (key.alt) mods.push('Alt');
  if (key.shift) mods.push('Shift');
  if (key.meta) mods.push('Meta');
  const prefix = mods.length ? `${mods.join('+')}+` : '';
  return `<${prefix}${base}>`;
}

function formatDateYYYYMMDD(date: Date): string {
  // Stable, filesystem-friendly date prefix (UTC).
  return date.toISOString().slice(0, 10);
}
