/**
 * Integration tests for umux
 *
 * These tests verify that components work together correctly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, ctrl, Umux } from '../src/index.js';

describe('Integration: Core + PTY', () => {
  let umux: Umux;

  async function waitUntil(
    predicate: () => boolean,
    options: { timeoutMs: number; intervalMs?: number; name?: string }
  ): Promise<void> {
    const startedAt = Date.now();
    const intervalMs = options.intervalMs ?? 25;
    while (Date.now() - startedAt < options.timeoutMs) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out waiting for condition${options.name ? `: ${options.name}` : ''}`);
  }

  beforeEach(() => {
    umux = new Umux();
  });

  afterEach(() => {
    umux.destroy();
  });

  it('spawns interactive shell and sends commands', async () => {
    const session = await umux.spawn();

    // Wait for shell to start
    await new Promise((r) => setTimeout(r, 300));

    // Send a command
    umux.send(session.id, 'echo "Hello, World!"\n');

    // Wait for pattern to appear (ready may return before output is captured)
    await umux.waitFor(session.id, { pattern: /Hello, World!/, timeout: 5000 });

    expect(session.history.getAll()).toContain('Hello, World!');
  });

  it('sends input to interactive process', async () => {
    const session = await umux.spawn('cat');

    umux.send(session.id, 'line1\n');
    umux.send(session.id, 'line2\n');

    await new Promise((r) => setTimeout(r, 100));

    const output = session.history.getAll();
    expect(output).toContain('line1');
    expect(output).toContain('line2');

    umux.sendKey(session.id, ctrl('c'));
    await umux.waitFor(session.id, { exit: true, timeout: 1000 });
  });

  it('detects patterns in output', async () => {
    const session = await umux.spawn();

    // Wait for shell to start
    await new Promise((r) => setTimeout(r, 300));

    // Send command that outputs READY
    umux.send(session.id, 'echo READY\n');

    const result = await umux.waitFor(session.id, {
      pattern: /READY/,
      timeout: 5000,
    });

    expect(result.reason).toBe('pattern');
    expect(result.match?.[0]).toBe('READY');
  });

  it('handles multiple sessions', async () => {
    const session1 = await umux.spawn('cat');
    const session2 = await umux.spawn('cat');
    const session3 = await umux.spawn('cat');

    expect(umux.listSessions()).toHaveLength(3);

    // Send unique input to each
    umux.send(session1.id, 'session1\n');
    umux.send(session2.id, 'session2\n');
    umux.send(session3.id, 'session3\n');

    await new Promise((r) => setTimeout(r, 100));

    expect(session1.history.getAll()).toContain('session1');
    expect(session2.history.getAll()).toContain('session2');
    expect(session3.history.getAll()).toContain('session3');

    // Kill all
    umux.kill(session1.id);
    umux.kill(session2.id);
    umux.kill(session3.id);
  });

  it('watches for multiple patterns', async () => {
    const events: string[] = [];

    const session = await umux.spawn();

    umux.on('pattern', (e) => {
      events.push(e.name);
    });

    umux.watch(session.id, {
      patterns: [
        { name: 'start', pattern: /START/, once: true },
        { name: 'middle', pattern: /MIDDLE/, once: true },
        { name: 'end', pattern: /END/, once: true },
      ],
    });

    // Wait for shell to start
    await new Promise((r) => setTimeout(r, 300));

    // Send commands and wait for patterns to appear
    umux.send(session.id, 'echo START\n');
    await umux.waitFor(session.id, { pattern: /START/, timeout: 2000 });

    umux.send(session.id, 'echo MIDDLE\n');
    await umux.waitFor(session.id, { pattern: /MIDDLE/, timeout: 2000 });

    umux.send(session.id, 'echo END\n');
    await umux.waitFor(session.id, { pattern: /END/, timeout: 2000 });

    expect(events).toContain('start');
    expect(events).toContain('middle');
    expect(events).toContain('end');
  });

  it('respects working directory option', async () => {
    const session = await umux.spawn(undefined, { cwd: '/tmp' });

    // Wait for shell to start
    await new Promise((r) => setTimeout(r, 300));

    umux.send(session.id, 'pwd\n');
    await umux.waitFor(session.id, { pattern: /\/tmp/, timeout: 5000 });

    expect(session.history.getAll()).toContain('/tmp');
  });

  it('passes environment variables', async () => {
    const session = await umux.spawn(undefined, { env: { MY_VAR: 'test-value' } });

    // Wait for shell to start
    await new Promise((r) => setTimeout(r, 300));

    umux.send(session.id, 'echo $MY_VAR\n');
    // Wait for the pattern to appear in output
    await umux.waitFor(session.id, { pattern: /test-value/, timeout: 5000 });

    expect(session.history.getAll()).toContain('test-value');
  });

  it('detects foreground process', async () => {
    const session = await umux.spawn('bash -i');

    // Wait for bash to start
    await new Promise((r) => setTimeout(r, 300));

    await waitUntil(() => session.foregroundProcess === null, {
      timeoutMs: 2000,
      name: 'shell prompt (no foreground process)',
    });

    // Start a foreground command
    umux.send(session.id, 'sleep 2\n');

    await waitUntil(() => session.foregroundProcess?.command === 'sleep', {
      timeoutMs: 2000,
      name: 'foreground process = sleep',
    });

    // Kill the session
    umux.kill(session.id);
  });

  it('waits for ready condition', async () => {
    const session = await umux.spawn('bash -i');

    // Wait for bash to start
    await new Promise((r) => setTimeout(r, 300));

    // Run a short command
    umux.send(session.id, 'sleep 0.5\n');

    await waitUntil(() => session.foregroundProcess !== null, {
      timeoutMs: 2000,
      name: 'foreground process started',
    });

    // Wait for ready (shell becomes available again)
    const result = await umux.waitFor(session.id, {
      ready: true,
      timeout: 5000,
    });

    expect(result.reason).toBe('ready');
    expect(result.waitedMs).toBeGreaterThan(0);

    await waitUntil(() => session.foregroundProcess === null, {
      timeoutMs: 5000,
      name: 'shell prompt after ready',
    });

    umux.kill(session.id);
  });

  it('returns ready immediately if no foreground process', async () => {
    const session = await umux.spawn('bash -i');

    // Wait for bash to start
    await new Promise((r) => setTimeout(r, 300));

    // Wait for ready when already ready
    const result = await umux.waitFor(session.id, {
      ready: true,
      timeout: 5000,
    });

    expect(result.reason).toBe('ready');
    expect(result.waitedMs).toBeLessThan(200); // Should return almost immediately

    umux.kill(session.id);
  });
});

describe('Integration: Server + Core', () => {
  let umux: Umux;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    umux = new Umux();
    app = createApp(umux);
  });

  afterEach(() => {
    umux.destroy();
  });

  it('spawns session via API and gets output', async () => {
    // Spawn via API
    const spawnRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo "API test"' }),
    });

    expect(spawnRes.status).toBe(201);
    const { id } = await spawnRes.json();

    // Wait for exit
    const waitRes = await app.request(`/sessions/${id}/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition: { exit: true, timeout: 5000 } }),
    });

    expect(waitRes.status).toBe(200);

    // Get history
    const historyRes = await app.request(`/sessions/${id}/history`);
    const { lines } = await historyRes.json();

    expect(lines.join('\n')).toContain('API test');
  });

  it('sends input via API', async () => {
    // Spawn cat
    const spawnRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'cat' }),
    });
    const { id } = await spawnRes.json();

    // Send text
    await app.request(`/sessions/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'hello from API\n' }),
    });

    await new Promise((r) => setTimeout(r, 100));

    // Check history
    const historyRes = await app.request(`/sessions/${id}/history`);
    const { lines } = await historyRes.json();

    expect(lines.join('\n')).toContain('hello from API');

    // Kill
    await app.request(`/sessions/${id}/kill`, { method: 'POST' });
  });

  it('sends keys via API', async () => {
    const spawnRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'cat' }),
    });
    const { id } = await spawnRes.json();

    // Send keys sequence
    await app.request(`/sessions/${id}/send-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keys: [{ text: 'test' }, { key: 'Enter' }],
      }),
    });

    await new Promise((r) => setTimeout(r, 100));

    const historyRes = await app.request(`/sessions/${id}/history`);
    const { lines } = await historyRes.json();

    expect(lines.join('\n')).toContain('test');

    await app.request(`/sessions/${id}/kill`, { method: 'POST' });
  });

  it('manages sessions via API', async () => {
    // Spawn session
    const spawnRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'echo in-session',
        name: 'api-session',
      }),
    });

    expect(spawnRes.status).toBe(201);
    const session = await spawnRes.json();

    // Get session details
    const sessionRes = await app.request(`/sessions/${session.id}`);
    const sessionData = await sessionRes.json();

    expect(sessionData.id).toBe(session.id);
    expect(sessionData.name).toBe('api-session');
    expect(sessionData.pid).toBeGreaterThan(0);

    // Delete session
    const deleteRes = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });

    expect(deleteRes.status).toBe(204);
  });

  it('waits for ready condition via API', async () => {
    // Spawn bash
    const spawnRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'bash -i' }),
    });
    const { id } = await spawnRes.json();

    // Wait for bash to start
    await new Promise((r) => setTimeout(r, 300));

    // Send a sleep command
    await app.request(`/sessions/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'sleep 0.3\n' }),
    });

    // Wait for command to start
    await new Promise((r) => setTimeout(r, 100));

    // Check foregroundProcess is set
    const sessionRes = await app.request(`/sessions/${id}`);
    const sessionData = await sessionRes.json();
    expect(sessionData.foregroundProcess).not.toBeNull();

    // Wait for ready
    const waitRes = await app.request(`/sessions/${id}/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition: { ready: true, timeout: 5000 } }),
    });

    expect(waitRes.status).toBe(200);
    const result = await waitRes.json();
    expect(result.reason).toBe('ready');
    expect(result.waitedMs).toBeGreaterThan(100);

    // Kill
    await app.request(`/sessions/${id}/kill`, { method: 'POST' });
  });
});
