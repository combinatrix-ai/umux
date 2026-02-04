import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Key } from './keys.js';
import type { TerminalEngine, TerminalEngineFactory } from './types.js';
import { Umux } from './umux.js';

class FakeTerminalEngine implements TerminalEngine {
  private cols: number;
  private rows: number;
  private buffer = '';
  disposed = false;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  write(data: string, onScreen?: () => void): void {
    this.buffer += data;
    onScreen?.();
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  capture(
    _options?: unknown
  ): { content: string; format: 'text' | 'ansi'; cols: number; rows: number } {
    return { content: this.buffer, format: 'text', cols: this.cols, rows: this.rows };
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe('Umux', () => {
  let umux: Umux;

  beforeEach(() => {
    umux = new Umux();
  });

  afterEach(() => {
    umux.destroy();
  });

  describe('Terminal Engine', () => {
    it('uses configured terminal engine for capture', async () => {
      const engineInstances: FakeTerminalEngine[] = [];
      const engine: TerminalEngineFactory = ({ cols, rows }) => {
        const instance = new FakeTerminalEngine(cols, rows);
        engineInstances.push(instance);
        return instance;
      };

      const custom = new Umux({ terminalEngine: engine });
      const session = await custom.spawn('echo "engine-ok"');
      await custom.waitFor(session.id, { exit: true, timeout: 5000 });

      const capture = custom.capture(session.id, { format: 'text' });
      expect(capture.content).toContain('engine-ok');
      expect(engineInstances).toHaveLength(1);
      custom.destroy();
    });

    it('allows per-session terminal engine override', async () => {
      const custom = new Umux();
      const engineInstances: FakeTerminalEngine[] = [];
      const engine: TerminalEngineFactory = ({ cols, rows }) => {
        const instance = new FakeTerminalEngine(cols, rows);
        engineInstances.push(instance);
        return instance;
      };

      const session = await custom.spawn('echo "override-ok"', { terminalEngine: engine });
      await custom.waitFor(session.id, { exit: true, timeout: 5000 });
      const capture = custom.capture(session.id, { format: 'text' });
      expect(capture.content).toContain('override-ok');
      expect(engineInstances).toHaveLength(1);
      custom.destroy();
    });
  });

  describe('Session Operations', () => {
    it('spawns a session', async () => {
      const session = await umux.spawn('echo hello');
      expect(session.id).toMatch(/^sess-/);
      expect(session.pid).toBeGreaterThan(0);
    });

    it('lists sessions', async () => {
      await umux.spawn('echo one');
      await umux.spawn('echo two');
      const sessions = umux.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('gets session by id', async () => {
      const session = await umux.spawn('echo test');
      const found = umux.getSession(session.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(session.id);
    });

    it('destroys session', async () => {
      const session = await umux.spawn('echo test');
      umux.destroySession(session.id);
      expect(umux.getSession(session.id)).toBeUndefined();
    });

    it('sends text to session', async () => {
      const session = await umux.spawn('cat');
      umux.send(session.id, 'hello\n');
      // Give it time to process
      await new Promise((r) => setTimeout(r, 100));
      expect(session.history.getAll()).toContain('hello');
      umux.kill(session.id);
    });

    it('sends key to session', async () => {
      const session = await umux.spawn('cat');
      umux.sendKey(session.id, Key.Enter);
      await new Promise((r) => setTimeout(r, 50));
      umux.kill(session.id);
    });

    it('kills session', async () => {
      const session = await umux.spawn('sleep 10');
      expect(session.isAlive).toBe(true);
      umux.kill(session.id);
      // Wait for exit event
      await umux.waitFor(session.id, { exit: true, timeout: 5000 });
      expect(session.isAlive).toBe(false);
    });

    it('captures screen buffer', async () => {
      const session = await umux.spawn('echo "capture-test"');
      await umux.waitFor(session.id, { exit: true, timeout: 5000 });
      const capture = umux.capture(session.id, { format: 'text' });
      expect(capture.content).toContain('capture-test');
      expect(capture.format).toBe('text');
    });
  });

  describe('waitFor', () => {
    it('waits for exit', async () => {
      const session = await umux.spawn('echo done');
      const result = await umux.waitFor(session.id, { exit: true, timeout: 5000 });
      expect(result.reason).toBe('exit');
      expect(result.exitCode).toBe(0);
    });

    it('waits for pattern', async () => {
      const session = await umux.spawn('echo "hello world"');
      const result = await umux.waitFor(session.id, {
        pattern: /hello/,
        timeout: 5000,
      });
      expect(result.reason).toBe('pattern');
      expect(result.match?.[0]).toBe('hello');
    });

    it('waits for screen pattern', async () => {
      const session = await umux.spawn('echo "screen-ok"');
      const result = await umux.waitFor(session.id, {
        screenPattern: /screen-ok/,
        timeout: 5000,
      });
      expect(result.reason).toBe('screen');
      expect(result.output).toContain('screen-ok');
    });

    it('waits for idle', async () => {
      const session = await umux.spawn('echo quick');
      const start = Date.now();
      const result = await umux.waitFor(session.id, {
        idle: 200,
        timeout: 5000,
      });
      const elapsed = Date.now() - start;
      expect(result.reason).toBe('idle');
      expect(elapsed).toBeGreaterThanOrEqual(200);
    });

    it('times out', async () => {
      const session = await umux.spawn('sleep 10');
      const result = await umux.waitFor(session.id, { timeout: 100 });
      expect(result.reason).toBe('timeout');
      umux.kill(session.id);
    });

    it('rejects on "not" pattern', async () => {
      const session = await umux.spawn('echo "error occurred"');
      const result = await umux.waitFor(session.id, {
        pattern: /success/,
        not: /error/,
        timeout: 5000,
      });
      expect(result.reason).toBe('rejected');
    });
  });

  describe('Events', () => {
    it('emits output event', async () => {
      const handler = vi.fn();
      umux.on('output', handler);

      await umux.spawn('echo test');
      await new Promise((r) => setTimeout(r, 100));

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].data).toContain('test');
    });

    it('emits exit event', async () => {
      const handler = vi.fn();
      umux.on('exit', handler);

      const session = await umux.spawn('echo done');
      await umux.waitFor(session.id, { exit: true });

      expect(handler).toHaveBeenCalledWith({
        sessionId: session.id,
        exitCode: 0,
      });
    });

    it('emits session:create event', async () => {
      const handler = vi.fn();
      umux.on('session:create', handler);

      const session = await umux.spawn('echo test');

      expect(handler).toHaveBeenCalledWith({ session });
    });
  });

  describe('watch', () => {
    it('watches for patterns', async () => {
      const handler = vi.fn();
      umux.on('pattern', handler);

      const session = await umux.spawn('echo "marker-123"');
      umux.watch(session.id, {
        patterns: [{ name: 'marker', pattern: /marker-\d+/ }],
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: session.id,
          name: 'marker',
        })
      );
    });

    it('stops watching', async () => {
      const handler = vi.fn();
      umux.on('pattern', handler);

      const session = await umux.spawn('cat');
      const handle = umux.watch(session.id, {
        patterns: [{ name: 'test', pattern: /test/ }],
      });

      handle.stop();
      umux.send(session.id, 'test\n');
      await new Promise((r) => setTimeout(r, 100));

      expect(handler).not.toHaveBeenCalled();
      umux.kill(session.id);
    });
  });
});
