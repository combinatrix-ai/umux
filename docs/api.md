# umux API Specification

Agent-ready terminal multiplexer with a declarative, non-blocking API.

## Design Principles

1. **Non-blocking by default** - All operations return immediately
2. **Atomic** - One operation = one action, no implicit waiting
3. **Explicit blocking** - Use `waitFor()` to explicitly wait for conditions
4. **Full history** - All output is automatically logged and accessible
5. **Event-driven** - Rich event system with pattern matching and hooks

---

## Core Types

### Session

```typescript
interface Session {
  readonly id: string;
  readonly name: string;
  readonly pid: number;
  readonly cwd: string;
  readonly isAlive: boolean;
  readonly exitCode: number | null;
  readonly history: SessionHistory;
  readonly createdAt: Date;
  capture(options?: CaptureOptions): CaptureResult;
}
```

### CaptureOptions / CaptureResult

```typescript
interface CaptureOptions {
  /** Output format (default: "text") */
  format?: 'text' | 'ansi';
}

interface CaptureResult {
  content: string;
  format: 'text' | 'ansi';
  cols: number;
  rows: number;
}
```

### SessionHistory

```typescript
interface SessionHistory {
  /** Get all output */
  getAll(): string;

  /** Get last N lines */
  tail(lines?: number): string;

  /** Get first N lines */
  head(lines?: number): string;

  /** Get lines from start to end (0-indexed) */
  slice(start: number, end?: number): string;

  /** Search for pattern in history */
  search(pattern: RegExp | string): SearchMatch[];

  /** Total line count */
  lineCount(): number;
}
```

---

## Hooks (Background Commands)

```typescript
interface HookConfig {
  id: string;
  sessionId: string;
  run: string;
  onMatch?: string;
  onReady?: boolean;
  onExit?: boolean;
  once?: boolean;
}
```

Note: `onReady` is intended for interactive shell sessions. Non-shell sessions may never emit a ready event.

---

## Main API

```typescript
interface Umux {
  constructor(config?: UmuxConfig);

  // === Session Management ===
  spawn(command: string, options?: SpawnOptions): Promise<Session>;
  getSession(id: string): Session | undefined;
  listSessions(): Session[];
  destroySession(id: string): void;

  // === Input ===
  send(sessionId: string, data: string): void;
  sendKey(sessionId: string, key: KeyInput): void;
  sendKeys(sessionId: string, keys: KeyInput[]): void;

  kill(sessionId: string, signal?: NodeJS.Signals): void;
  capture(sessionId: string, options?: CaptureOptions): CaptureResult;

  // === Explicit Blocking ===
  waitFor(sessionId: string, condition: WaitCondition): Promise<WaitResult>;

  // === Events ===
  on<K extends keyof UmuxEventMap>(event: K, handler: (e: UmuxEventMap[K]) => void): this;

  // === Cleanup ===
  destroy(): void;
}
```
