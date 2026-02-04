/**
 * End-to-end tests for umux
 *
 * These tests run the actual CLI and server as separate processes.
 */

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '../dist/cli/bin.js');

// Helper to run CLI command
// Use longer timeout for CI
const isCI = process.env.CI === 'true';
const DEFAULT_CLI_TIMEOUT = isCI ? 30000 : 10000;

function runCli(
  args: string[],
  options: { timeout?: number; env?: Record<string, string | undefined> } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout ?? DEFAULT_CLI_TIMEOUT;
    const proc = spawn('node', [CLI_PATH, ...args], {
      timeout,
      env: { ...process.env, NO_COLOR: '1', ...(options.env ?? {}) },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', reject);
  });
}

describe('E2E: CLI', () => {
  it('shows help', async () => {
    const { stdout, exitCode } = await runCli(['--help']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Agent-ready terminal multiplexer');
    expect(stdout).toContain('spawn');
    expect(stdout).toContain('send');
    expect(stdout).toContain('wait');
  });

  it('guide --json returns bundled docs locations', async () => {
    const { stdout, exitCode } = await runCli(['guide', '--json']);

    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout) as {
      root: string;
      readme: string | null;
      docsCli: string | null;
      examplesDir: string | null;
    };

    expect(data.root).toBeTruthy();
    expect(data.readme).toMatch(/README\.md$/);
    expect(data.docsCli).toMatch(/docs[\\/]+cli\.md$/);
    expect(data.examplesDir).toMatch(/examples$/);
  });

  it('shows version', async () => {
    const { stdout, exitCode } = await runCli(['--version']);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('spawns interactive session and returns session ID', async () => {
    const { stdout, exitCode } = await runCli(['spawn', 'cat']);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^sess-[A-Za-z0-9_-]+$/);

    // Clean up - kill the session
    const sessionId = stdout.trim();
    await runCli(['kill', sessionId]);
  });

  it('spawns default shell when no program specified', async () => {
    const { stdout, exitCode } = await runCli(['spawn']);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^sess-[A-Za-z0-9_-]+$/);

    // Clean up
    const sessionId = stdout.trim();
    await runCli(['kill', sessionId]);
  });

  it('outputs JSON with --json flag', async () => {
    const { stdout, exitCode } = await runCli(['spawn', 'cat', '--json']);

    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.id).toMatch(/^sess-/);
    expect(data.pid).toBeGreaterThan(0);

    // Clean up
    await runCli(['kill', data.id]);
  });

  it('sends input and waits for ready', async () => {
    // Spawn a shell
    const spawnResult = await runCli(['spawn']);
    const sessionId = spawnResult.stdout.trim();

    // Send a command
    await runCli(['send', sessionId, 'echo "test output"', '--enter']);

    // Wait for ready
    const waitResult = await runCli(['wait', sessionId, '--until-ready', '--timeout', '5000']);
    expect(waitResult.exitCode).toBe(0);

    // Check logs
    const logsResult = await runCli(['logs', sessionId, '--tail', '5']);
    expect(logsResult.stdout).toContain('test output');

    // Check input logs
    const sendLogsResult = await runCli(['logs', sessionId, '--send-only', '--tail', '20']);
    expect(sendLogsResult.stdout).toContain('echo "test output"');

    // Clean up
    await runCli(['kill', sessionId]);
  });

  it('supports opting out of input logging via UMUX_LOG_INPUT=0', async () => {
    const socketPath = join(tmpdir(), `umux-e2e-${Date.now()}-${Math.random()}.sock`);
    const env = { UMUX_LOG_INPUT: '0' };

    const spawnResult = await runCli(['-S', socketPath, 'spawn'], { env });
    const sessionId = spawnResult.stdout.trim();

    await runCli(['-S', socketPath, 'send', sessionId, 'echo "x"', '--enter'], { env });
    await runCli(['-S', socketPath, 'wait', sessionId, '--until-ready', '--timeout', '5000'], {
      env,
    });

    const outputLogs = await runCli(['-S', socketPath, 'logs', sessionId, '--tail', '20'], { env });
    expect(outputLogs.stdout).toContain('x');

    const sendLogs = await runCli(['-S', socketPath, 'logs', sessionId, '--send-only'], { env });
    expect(sendLogs.stdout.trim()).toBe('');

    await runCli(['-S', socketPath, 'kill', sessionId], { env });
    await runCli(['-S', socketPath, 'rm', sessionId], { env });
  });

  it('kill --all kills all alive sessions', async () => {
    // Spawn multiple sessions
    const session1 = (await runCli(['spawn', 'cat'])).stdout.trim();
    const session2 = (await runCli(['spawn', 'cat'])).stdout.trim();
    const session3 = (await runCli(['spawn', 'cat'])).stdout.trim();

    // Verify they're alive
    const lsBefore = await runCli(['ls', '--json']);
    const sessionsBefore = JSON.parse(lsBefore.stdout);
    const aliveBefore = sessionsBefore.filter(
      (s: { id: string; isAlive: boolean }) =>
        [session1, session2, session3].includes(s.id) && s.isAlive
    );
    expect(aliveBefore.length).toBe(3);

    // Kill all
    const killResult = await runCli(['kill', '--all']);
    expect(killResult.exitCode).toBe(0);
    expect(killResult.stdout).toContain('session(s)');

    // Wait a bit for processes to exit
    await new Promise((r) => setTimeout(r, 100));

    // Verify all are exited
    const lsAfter = await runCli(['ls', '--all', '--json']);
    const sessionsAfter = JSON.parse(lsAfter.stdout);
    const aliveAfter = sessionsAfter.filter(
      (s: { id: string; isAlive: boolean }) =>
        [session1, session2, session3].includes(s.id) && s.isAlive
    );
    expect(aliveAfter.length).toBe(0);

    // Clean up
    await runCli(['rm', session1]);
    await runCli(['rm', session2]);
    await runCli(['rm', session3]);
  });

  it('rm --exited removes only exited sessions', async () => {
    // Spawn sessions
    const session1 = (await runCli(['spawn', 'cat'])).stdout.trim();
    const session2 = (await runCli(['spawn', 'cat'])).stdout.trim();

    // Kill one
    await runCli(['kill', session1]);
    await new Promise((r) => setTimeout(r, 100));

    // Verify states
    const status1 = await runCli(['status', session1, '--json']);
    const status2 = await runCli(['status', session2, '--json']);
    expect(JSON.parse(status1.stdout).isAlive).toBe(false);
    expect(JSON.parse(status2.stdout).isAlive).toBe(true);

    // Remove exited
    const rmResult = await runCli(['rm', '--exited']);
    expect(rmResult.exitCode).toBe(0);
    expect(rmResult.stdout).toContain('exited session(s)');

    // Verify session1 is gone, session2 still exists
    const lsAfter = await runCli(['ls', '--json']);
    const sessionsAfter = JSON.parse(lsAfter.stdout);
    const ids = sessionsAfter.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(session1);
    expect(ids).toContain(session2);

    // Clean up
    await runCli(['kill', session2]);
    await runCli(['rm', session2]);
  });

  it('ls defaults to active sessions, with --all/--exited to toggle', async () => {
    const sessionId = (await runCli(['spawn', 'cat'])).stdout.trim();

    // Kill it so it becomes exited
    await runCli(['kill', sessionId]);
    await new Promise((r) => setTimeout(r, 100));

    const lsActive = await runCli(['ls', '--json']);
    const activeSessions = JSON.parse(lsActive.stdout).map((s: { id: string }) => s.id);
    expect(activeSessions).not.toContain(sessionId);

    const lsExited = await runCli(['ls', '--exited', '--json']);
    const exitedSessions = JSON.parse(lsExited.stdout).map((s: { id: string }) => s.id);
    expect(exitedSessions).toContain(sessionId);

    const lsAll = await runCli(['ls', '--all', '--json']);
    const allSessions = JSON.parse(lsAll.stdout).map((s: { id: string }) => s.id);
    expect(allSessions).toContain(sessionId);

    await runCli(['rm', sessionId]);
  });

  it('graceful kill sends SIGKILL after SIGTERM fails', async () => {
    // Spawn bash (ignores SIGTERM in interactive mode)
    const sessionId = (await runCli(['spawn', 'bash'])).stdout.trim();

    // Verify it's alive
    const statusBefore = await runCli(['status', sessionId, '--json']);
    expect(JSON.parse(statusBefore.stdout).isAlive).toBe(true);

    // Kill without --signal (should use graceful kill)
    await runCli(['kill', sessionId], { timeout: 5000 });

    // Verify it's dead
    const statusAfter = await runCli(['status', sessionId, '--json']);
    expect(JSON.parse(statusAfter.stdout).isAlive).toBe(false);

    // Clean up
    await runCli(['rm', sessionId]);
  });
});

describe('E2E: Server', () => {
  let server: Awaited<ReturnType<typeof startServer>> | null = null;
  const port = 7070;

  beforeAll(async () => {
    // Start server directly using the library
    server = await startServer({
      port,
      host: '127.0.0.1',
      auth: { type: 'none' },
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  }

  it('GET /sessions returns empty list initially', async () => {
    const res = await apiRequest('/sessions');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.sessions).toEqual([]);
  });

  it('POST /sessions spawns a session', async () => {
    const res = await apiRequest('/sessions', {
      method: 'POST',
      body: JSON.stringify({ command: 'echo "server e2e"', name: 'e2e-test' }),
    });

    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.id).toMatch(/^sess-/);
    expect(data.name).toBe('e2e-test');
    expect(data.pid).toBeGreaterThan(0);
  });

  it('POST /sessions spawns and runs command', async () => {
    // Spawn
    const spawnRes = await apiRequest('/sessions', {
      method: 'POST',
      body: JSON.stringify({ command: 'echo "server e2e"' }),
    });

    expect(spawnRes.status).toBe(201);
    const { id } = await spawnRes.json();

    // Wait
    const waitRes = await apiRequest(`/sessions/${id}/wait`, {
      method: 'POST',
      body: JSON.stringify({ condition: { exit: true, timeout: 5000 } }),
    });

    expect(waitRes.status).toBe(200);
    const waitData = await waitRes.json();
    expect(waitData.reason).toBe('exit');

    // History
    const historyRes = await apiRequest(`/sessions/${id}/history`);
    expect(historyRes.status).toBe(200);

    const historyData = await historyRes.json();
    expect(historyData.lines.join('\n')).toContain('server e2e');
  });

  it('full workflow: spawn, send, wait', async () => {
    // Spawn cat
    const spawnRes = await apiRequest('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        command: 'cat',
        name: 'workflow-test',
      }),
    });
    const session = await spawnRes.json();

    // Send input
    await apiRequest(`/sessions/${session.id}/send`, {
      method: 'POST',
      body: JSON.stringify({ data: 'workflow input\n' }),
    });

    // Wait a bit
    await new Promise((r) => setTimeout(r, 100));

    // Check history
    const historyRes = await apiRequest(`/sessions/${session.id}/history`);
    const history = await historyRes.json();
    expect(history.lines.join('\n')).toContain('workflow input');

    // Kill session
    await apiRequest(`/sessions/${session.id}/kill`, { method: 'POST' });

    // Delete session
    await apiRequest(`/sessions/${session.id}`, { method: 'DELETE' });
  });

  it('hooks can be registered and listed', async () => {
    // Register
    const registerRes = await apiRequest('/hooks', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'sess-123',
        run: 'echo "hook triggered"',
        onExit: true,
      }),
    });
    expect(registerRes.status).toBe(201);
    const { id: hookId } = await registerRes.json();

    // List
    const listRes = await apiRequest('/hooks');
    const data = await listRes.json();
    expect(data.hooks.some((h: { id: string }) => h.id === hookId)).toBe(true);

    // Delete
    const deleteRes = await apiRequest(`/hooks/${hookId}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);
  });
});
