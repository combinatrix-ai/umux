/**
 * Main Umux class - entry point for the library
 */

import { EventEmitter } from './events.js';
import type { KeyInput } from './keys.js';
import { SessionImpl } from './session.js';
import type {
  CaptureOptions,
  CaptureResult,
  PatternWatcher,
  Session,
  SpawnOptions,
  TerminalEngineFactory,
  UmuxConfig,
  UmuxEventMap,
  WaitCondition,
  WaitResult,
  WatchHandle,
  WatchOptions,
} from './types.js';
import { createGhosttyTerminalEngine, createGhosttyWasmTerminalEngine } from './ghostty-engine.js';
import { createXtermTerminalEngine } from './terminal-engine.js';

export class Umux extends EventEmitter<UmuxEventMap> {
  private readonly config: Required<UmuxConfig>;
  private readonly sessions = new Map<string, SessionImpl>();
  private readyPollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly readyState = new Map<string, boolean>();

  constructor(config: UmuxConfig = {}) {
    super();
    const envEngine = (process.env.UMUX_TERMINAL_ENGINE ?? '').trim();
    const defaultEngine: TerminalEngineFactory =
      envEngine === 'xterm'
        ? createXtermTerminalEngine
        : envEngine === 'ghostty-strict'
          ? createGhosttyWasmTerminalEngine
          : createGhosttyTerminalEngine;
    this.config = {
      logDir: config.logDir ?? process.env.UMUX_LOG_DIR ?? '',
      historyLimit: config.historyLimit ?? 10000,
      defaultShell: config.defaultShell ?? process.env.SHELL ?? '/bin/sh',
      terminalEngine: config.terminalEngine ?? defaultEngine,
    };
    this.startReadyPolling();
  }

  // ===========================================================================
  // Session Operations
  // ===========================================================================

  /**
   * Spawn a new session with a command
   */
  async spawn(command: string, options: SpawnOptions = {}): Promise<Session> {
    const terminalEngineFactory: TerminalEngineFactory = options.terminalEngine ?? this.config.terminalEngine;
    const session = new SessionImpl(
      command,
      options,
      this.config.historyLimit,
      this.config.logDir,
      terminalEngineFactory,
    );
    this.sessions.set(session.id, session);

    // Forward session events to umux events
    session.on('output', (e) => {
      this.emit('output', e);
    });

    session.on('exit', (e) => {
      this.emit('exit', e);
    });

    this.emit('session:create', { session });

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): SessionImpl | undefined {
    return this.sessions.get(id);
  }

  /**
   * List all sessions
   */
  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Destroy a session
   */
  destroySession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.dispose();
      this.sessions.delete(id);
      this.readyState.delete(id);
      this.emit('session:destroy', { sessionId: id });
    }
  }

  /**
   * Send text to a session
   */
  send(sessionId: string, data: string): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.send(data);
  }

  /**
   * Send a key to a session
   */
  sendKey(sessionId: string, key: KeyInput): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.sendKey(key);
  }

  /**
   * Send multiple keys to a session
   */
  sendKeys(sessionId: string, keys: KeyInput[]): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.sendKeys(keys);
  }

  /**
   * Kill a session
   */
  kill(sessionId: string, signal?: NodeJS.Signals): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.kill(signal);
  }

  /**
   * Capture current screen buffer
   */
  capture(sessionId: string, options?: CaptureOptions): CaptureResult {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session.capture(options);
  }

  // ===========================================================================
  // Wait & Watch
  // ===========================================================================

  /**
   * Wait for a condition on a session
   */
  async waitFor(sessionId: string, condition: WaitCondition): Promise<WaitResult> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const startTime = Date.now();

	    return new Promise((resolve) => {
	      let outputBuffer = '';
	      let screenBuffer = '';
	      let scanTail = '';
	      const scanTailLimit = 8 * 1024; // match across chunk boundaries without O(n^2) scans
	      let idleTimer: ReturnType<typeof setTimeout> | null = null;
	      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
	      let readyPollTimer: ReturnType<typeof setInterval> | null = null;
	      let resolved = false;

      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (readyPollTimer) clearInterval(readyPollTimer);
        session.off('output', onOutput);
        session.off('exit', onExit);
        session.off('screen', onScreen);
      };

      const finish = (result: Omit<WaitResult, 'waitedMs'>) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({
          ...result,
          waitedMs: Date.now() - startTime,
        });
      };

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (condition.idle) {
          idleTimer = setTimeout(() => {
            finish({ reason: 'idle', output: outputBuffer });
          }, condition.idle);
        }
      };

	      const onOutput = (e: { data: string }) => {
	        outputBuffer += e.data;
	        const scan = (scanTail + e.data).slice(-scanTailLimit);
	        scanTail = scan;

	        // Check "not" pattern (rejection)
	        if (condition.not) {
	          const notRegex =
	            typeof condition.not === 'string' ? new RegExp(condition.not) : condition.not;
	          const notMatch = notRegex.exec(scan);
	          if (notMatch) {
	            finish({ reason: 'rejected', match: notMatch, output: outputBuffer });
	            return;
	          }
	        }

        // Check pattern match
	        if (condition.pattern) {
	          const regex =
	            typeof condition.pattern === 'string'
	              ? new RegExp(condition.pattern)
	              : condition.pattern;
	          const match = regex.exec(scan);
	          if (match) {
	            finish({ reason: 'pattern', match, output: outputBuffer });
	            return;
	          }
	        }

        // Reset idle timer on new output
        resetIdleTimer();
      };

      const onExit = (e: { exitCode: number }) => {
        if (condition.exit) {
          finish({ reason: 'exit', exitCode: e.exitCode, output: outputBuffer });
        } else if (condition.ready) {
          // Process exit also means "ready" (shell ended)
          finish({ reason: 'ready', output: outputBuffer });
        }
      };

      const onScreen = () => {
        if (!condition.screenPattern) return;
        const regex =
          typeof condition.screenPattern === 'string'
            ? new RegExp(condition.screenPattern)
            : condition.screenPattern;
        screenBuffer = session.capture({ format: 'text' }).content;
        const match = regex.exec(screenBuffer);
        if (match) {
          finish({ reason: 'screen', match, output: screenBuffer });
        }
      };

      // Set up timeout
      if (condition.timeout) {
        timeoutTimer = setTimeout(() => {
          finish({ reason: 'timeout', output: outputBuffer });
        }, condition.timeout);
      }

      // Subscribe to events
      session.on('output', onOutput);
      session.on('exit', onExit);
      session.on('screen', onScreen);

      // Start idle timer
      resetIdleTimer();

      // Check existing history for pattern match (in case output already happened)
      if (condition.pattern) {
        const existingOutput = session.history.getAll();
        outputBuffer = existingOutput;
        const regex =
          typeof condition.pattern === 'string' ? new RegExp(condition.pattern) : condition.pattern;
        const match = regex.exec(existingOutput);
        if (match) {
          finish({ reason: 'pattern', match, output: existingOutput });
          return;
        }
      }

      // Check "not" pattern in existing history
      if (condition.not) {
        const existingOutput = session.history.getAll();
        outputBuffer = existingOutput;
        const notRegex =
          typeof condition.not === 'string' ? new RegExp(condition.not) : condition.not;
        const notMatch = notRegex.exec(existingOutput);
        if (notMatch) {
          finish({ reason: 'rejected', match: notMatch, output: existingOutput });
          return;
        }
      }

      // Check existing screen for screen match
      if (condition.screenPattern) {
        const regex =
          typeof condition.screenPattern === 'string'
            ? new RegExp(condition.screenPattern)
            : condition.screenPattern;
        screenBuffer = session.capture({ format: 'text' }).content;
        const match = regex.exec(screenBuffer);
        if (match) {
          finish({ reason: 'screen', match, output: screenBuffer });
          return;
        }
      }

      // Set up ready polling (check every 100ms if foreground process ended)
      if (condition.ready) {
        // Check immediately first
        if (!session.foregroundProcess) {
          finish({ reason: 'ready', output: outputBuffer });
          return;
        }

        readyPollTimer = setInterval(() => {
          if (!session.isAlive) {
            finish({ reason: 'ready', output: outputBuffer });
            return;
          }
          if (!session.foregroundProcess) {
            finish({ reason: 'ready', output: outputBuffer });
          }
        }, 100);
      }

      // Check if already exited
      if (!session.isAlive && condition.exit) {
        finish({
          reason: 'exit',
          exitCode: session.exitCode ?? 0,
          output: session.history.getAll(),
        });
      }
    });
  }

  /**
   * Watch for patterns on a session
   */
  watch(sessionId: string, options: WatchOptions): WatchHandle {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const patterns = new Map<string, PatternWatcher>();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    // Initialize patterns
    for (const p of options.patterns ?? []) {
      patterns.set(p.name, p);
    }

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (options.idleThreshold && !stopped) {
        idleTimer = setTimeout(() => {
          this.emit('idle', { sessionId, idleMs: options.idleThreshold! });
        }, options.idleThreshold);
      }
    };

    const onOutput = (e: { data: string }) => {
      // Check patterns
      for (const [name, watcher] of patterns) {
        const regex =
          typeof watcher.pattern === 'string' ? new RegExp(watcher.pattern) : watcher.pattern;
        const match = regex.exec(e.data);
        if (match) {
          this.emit('pattern', { sessionId, name, match });
          if (watcher.once) {
            patterns.delete(name);
          }
        }
      }

      resetIdleTimer();
    };

    session.on('output', onOutput);
    resetIdleTimer();

    return {
      stop: () => {
        stopped = true;
        if (idleTimer) clearTimeout(idleTimer);
        session.off('output', onOutput);
      },
      addPattern: (watcher: PatternWatcher) => {
        patterns.set(watcher.name, watcher);
      },
      removePattern: (name: string) => {
        patterns.delete(name);
      },
    };
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Destroy all sessions and cleanup
   */
  destroy(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.readyState.clear();
    if (this.readyPollTimer) {
      clearInterval(this.readyPollTimer);
      this.readyPollTimer = null;
    }
    this.removeAllListeners();
  }

  private startReadyPolling(): void {
    if (this.readyPollTimer) return;
    this.readyPollTimer = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (!session.isAlive) {
          this.readyState.delete(session.id);
          continue;
        }

        const isBusy = Boolean(session.foregroundProcess);
        const wasBusy = this.readyState.get(session.id);
        if (wasBusy === undefined) {
          this.readyState.set(session.id, isBusy);
          continue;
        }

        if (wasBusy && !isBusy) {
          this.emit('ready', { sessionId: session.id });
        }

        this.readyState.set(session.id, isBusy);
      }
    }, 100);
  }
}
