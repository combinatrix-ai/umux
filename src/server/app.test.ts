import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Umux } from '../core/index.js';
import { createApp } from './app.js';

describe('Server App', () => {
  let umux: Umux;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    umux = new Umux();
    app = createApp(umux);
  });

  afterEach(() => {
    umux.destroy();
  });

  describe('Sessions API', () => {
    it('POST /sessions spawns a session', async () => {
      const res = await app.request('/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo hello' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toMatch(/^sess-/);
      expect(data.pid).toBeGreaterThan(0);
    });

    it('POST /sessions with name', async () => {
      const res = await app.request('/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo test', name: 'my-session' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toBe('my-session');
    });

    it('GET /sessions lists sessions', async () => {
      await umux.spawn('echo one');
      await umux.spawn('echo two');

      const res = await app.request('/sessions');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sessions).toHaveLength(2);
    });

    it('GET /sessions/:id returns session details', async () => {
      const session = await umux.spawn('echo test', { name: 'test' });

      const res = await app.request(`/sessions/${session.id}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.id).toBe(session.id);
      expect(data.name).toBe('test');
      expect(data.pid).toBe(session.pid);
    });

    it('GET /sessions/:id returns 404 for unknown session', async () => {
      const res = await app.request('/sessions/unknown');
      expect(res.status).toBe(404);
    });

    it('DELETE /sessions/:id destroys session', async () => {
      const session = await umux.spawn('echo test');

      const res = await app.request(`/sessions/${session.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(204);
      expect(umux.getSession(session.id)).toBeUndefined();
    });

    it('POST /sessions/:id/send sends text', async () => {
      const session = await umux.spawn('cat');

      const res = await app.request(`/sessions/${session.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'hello\n' }),
      });

      expect(res.status).toBe(204);
      await new Promise((r) => setTimeout(r, 100));
      expect(session.history.getAll()).toContain('hello');
      umux.kill(session.id);
    });

    it('POST /sessions/:id/send-key sends a key', async () => {
      const session = await umux.spawn('cat');

      const res = await app.request(`/sessions/${session.id}/send-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'Enter' }),
      });

      expect(res.status).toBe(204);
      umux.kill(session.id);
    });

    it('POST /sessions/:id/kill terminates session', async () => {
      const session = await umux.spawn('sleep 10');

      const res = await app.request(`/sessions/${session.id}/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(204);
      // Wait for exit event
      await umux.waitFor(session.id, { exit: true, timeout: 5000 });
      expect(session.isAlive).toBe(false);
    });

    it('GET /sessions/:id/history returns output', async () => {
      const session = await umux.spawn('echo "test output"');
      await umux.waitFor(session.id, { exit: true, timeout: 5000 });

      const res = await app.request(`/sessions/${session.id}/history`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.lines.join('\n')).toContain('test output');
    });

    it('GET /sessions/:id/history?tail=5 returns last 5 lines', async () => {
      const session = await umux.spawn('seq 1 10');
      await umux.waitFor(session.id, { exit: true, timeout: 5000 });

      const res = await app.request(`/sessions/${session.id}/history?tail=5`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.lines.length).toBeLessThanOrEqual(5);
    });

    it('GET /sessions/:id/capture returns screen buffer', async () => {
      const session = await umux.spawn('echo "capture api"');
      await umux.waitFor(session.id, { exit: true, timeout: 5000 });

      const res = await app.request(`/sessions/${session.id}/capture`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.content).toContain('capture api');
      expect(data.format).toBe('text');
    });

    it('POST /sessions/:id/wait waits for condition', async () => {
      const session = await umux.spawn('echo done');

      const res = await app.request(`/sessions/${session.id}/wait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condition: { exit: true, timeout: 5000 },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.reason).toBe('exit');
    });
  });

  describe('Hooks API', () => {
    it('GET /hooks lists hooks', async () => {
      const res = await app.request('/hooks');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.hooks).toEqual([]);
    });

    it('POST /hooks registers a hook', async () => {
      const res = await app.request('/hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess-123',
          run: 'echo hello',
          onReady: true,
        }),
      });

      expect(res.status).toBe(201);
      const hookData = await res.json();
      expect(hookData.id).toMatch(/^hook-/);

      const listRes = await app.request('/hooks');
      const data = await listRes.json();
      expect(data.hooks).toHaveLength(1);
      expect(data.hooks[0].run).toBe('echo hello');
    });

    it('DELETE /hooks/:id removes hook', async () => {
      const res = await app.request('/hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess-123',
          run: 'echo hello',
        }),
      });
      const hookData = await res.json();

      const delRes = await app.request(`/hooks/${hookData.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/hooks');
      const data = await listRes.json();
      expect(data.hooks).toHaveLength(0);
    });
  });

  describe('Authentication', () => {
    it('requires token when auth is configured', async () => {
      const authApp = createApp(umux, {
        auth: { type: 'token', token: 'secret123' },
      });

      const res = await authApp.request('/sessions');
      expect(res.status).toBe(401);

      const authRes = await authApp.request('/sessions', {
        headers: { Authorization: 'Bearer secret123' },
      });
      expect(authRes.status).toBe(200);
    });

    it('accepts token as query parameter', async () => {
      const authApp = createApp(umux, {
        auth: { type: 'token', token: 'secret123' },
      });

      const res = await authApp.request('/sessions?token=secret123');
      expect(res.status).toBe(200);
    });
  });
});
