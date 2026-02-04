import { exec } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HookManager } from './hooks.js';

vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd, _opts, callback) => {
    if (callback) callback(null, '', '');
  }),
}));

describe('HookManager', () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager();
    vi.clearAllMocks();
  });

  describe('add/remove/get/list', () => {
    it('adds a hook', () => {
      manager.add({
        id: 'hook-1',
        sessionId: 'sess-1',
        run: 'echo hello',
        onReady: true,
      });

      expect(manager.get('hook-1')).toBeDefined();
      expect(manager.get('hook-1')?.run).toBe('echo hello');
    });

    it('lists hooks', () => {
      manager.add({ id: 'h1', sessionId: 's1', run: 'ls', onExit: true });
      manager.add({ id: 'h2', sessionId: 's2', run: 'ls', onReady: true });

      expect(manager.list()).toHaveLength(2);
      expect(manager.list('s1')).toHaveLength(1);
    });

    it('removes hook', () => {
      manager.add({ id: 'h1', sessionId: 's1', run: 'ls' });
      expect(manager.remove('h1')).toBe(true);
      expect(manager.get('h1')).toBeUndefined();
    });

    it('rejects invalid regex on add', () => {
      expect(() =>
        manager.add({
          id: 'h1',
          sessionId: 's1',
          run: 'echo bad',
          onMatch: '[',
        })
      ).toThrow('Invalid onMatch regex');
    });
  });

  describe('fire', () => {
    it('fires on ready event', async () => {
      manager.add({
        id: 'h1',
        sessionId: 's1',
        run: 'echo ready',
        onReady: true,
      });

      await manager.fire('ready', { sessionId: 's1' });

      expect(exec).toHaveBeenCalledWith(
        'echo ready',
        expect.objectContaining({
          env: expect.objectContaining({
            UMUX_EVENT: 'ready',
            UMUX_SESSION_ID: 's1',
          }),
        }),
        expect.any(Function)
      );
    });

    it('fires on exit event', async () => {
      manager.add({
        id: 'h1',
        sessionId: 's1',
        run: 'echo exit',
        onExit: true,
      });

      await manager.fire('exit', { sessionId: 's1' });

      expect(exec).toHaveBeenCalledWith(
        'echo exit',
        expect.objectContaining({
          env: expect.objectContaining({
            UMUX_EVENT: 'exit',
            UMUX_SESSION_ID: 's1',
          }),
        }),
        expect.any(Function)
      );
    });

    it('fires on match event with regex', async () => {
      manager.add({
        id: 'h1',
        sessionId: 's1',
        run: 'echo matched',
        onMatch: 'Error: .*',
      });

      await manager.fire('match', { sessionId: 's1', data: 'Error: database connection failed' });

      expect(exec).toHaveBeenCalledWith(
        'echo matched',
        expect.objectContaining({
          env: expect.objectContaining({
            UMUX_EVENT: 'match',
            UMUX_MATCH: 'Error: database connection failed',
          }),
        }),
        expect.any(Function)
      );
    });

    it('does not fire when event does not match', async () => {
      manager.add({
        id: 'h1',
        sessionId: 's1',
        run: 'echo ready',
        onReady: true,
      });

      await manager.fire('exit', { sessionId: 's1' });

      expect(exec).not.toHaveBeenCalled();
    });

    it('removes once hooks after firing', async () => {
      manager.add({
        id: 'h1',
        sessionId: 's1',
        run: 'echo once',
        onReady: true,
        once: true,
      });

      await manager.fire('ready', { sessionId: 's1' });
      expect(manager.get('h1')).toBeUndefined();
    });
  });
});
