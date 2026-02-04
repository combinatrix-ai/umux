/**
 * Scenario-based E2E tests for umux
 *
 * These tests simulate real-world agent workflows.
 */

import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Check if Python3 is available
let hasPython3 = false;
try {
  execSync('python3 --version', { stdio: 'ignore' });
  hasPython3 = true;
} catch {
  hasPython3 = false;
}

// Use longer timeouts for CI
const isCI = process.env.CI === 'true';
const TIMEOUT = isCI ? 10000 : 5000;
const LONG_TIMEOUT = isCI ? 30000 : 10000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '../dist/cli/bin.js');

// Helper to run CLI command
function runCli(
  args: string[],
  options: { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout ?? 10000;
    const proc = spawn('node', [CLI_PATH, ...args], {
      timeout,
      env: { ...process.env, NO_COLOR: '1' },
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

// Helper to cleanup session
async function cleanup(sessionId: string): Promise<void> {
  await runCli(['kill', sessionId]).catch(() => {});
  await runCli(['rm', sessionId]).catch(() => {});
}

describe.skipIf(!hasPython3)('Scenario: Python REPL Session', () => {
  it('executes Python code interactively and verifies results', async () => {
    // Start Python REPL
    const spawnResult = await runCli(['spawn', 'python3']);
    const sessionId = spawnResult.stdout.trim();
    expect(sessionId).toMatch(/^sess-/);

    try {
      // Wait for Python prompt
      await runCli(['wait', sessionId, '--until-match', '>>>', '--timeout', String(LONG_TIMEOUT)]);

      // Execute simple calculation
      await runCli(['send', sessionId, '2 + 3', '--enter']);
      const result1 = await runCli(['wait', sessionId, '--until-match', '5', '--timeout', '3000']);
      expect(result1.exitCode).toBe(0);

      // Execute string operation
      await runCli(['send', sessionId, '"hello".upper()', '--enter']);
      const result2 = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'HELLO',
        '--timeout',
        '3000',
      ]);
      expect(result2.exitCode).toBe(0);

      // Execute multi-line code (define function)
      await runCli(['send', sessionId, 'def greet(name):', '--enter']);
      await runCli(['send', sessionId, '    return f"Hello, {name}!"', '--enter']);
      await runCli(['send', sessionId, '', '--enter']); // Empty line to finish definition
      await runCli(['wait', sessionId, '--until-match', '>>>', '--timeout', String(TIMEOUT)]);

      // Call the function
      await runCli(['send', sessionId, 'greet("World")', '--enter']);
      const result3 = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'Hello, World!',
        '--timeout',
        '3000',
      ]);
      expect(result3.exitCode).toBe(0);

      // Verify history contains all interactions
      const logs = await runCli(['logs', sessionId]);
      expect(logs.stdout).toContain('2 + 3');
      expect(logs.stdout).toContain('5');
      expect(logs.stdout).toContain('HELLO');
      expect(logs.stdout).toContain('Hello, World!');

      // Exit Python
      await runCli(['send', sessionId, 'exit()', '--enter']);
      const exitResult = await runCli(['wait', sessionId, '--until-exit', '--timeout', '3000']);
      expect(exitResult.exitCode).toBe(0);
    } finally {
      await cleanup(sessionId);
    }
  });

  it('handles Python errors gracefully', async () => {
    const spawnResult = await runCli(['spawn', 'python3']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-match', '>>>', '--timeout', String(LONG_TIMEOUT)]);

      // Cause a NameError (undefined variable)
      await runCli(['send', sessionId, 'undefined_variable', '--enter']);

      // Wait for prompt to return (error was handled)
      await runCli(['wait', sessionId, '--until-match', '>>>', '--timeout', String(TIMEOUT)]);

      // Check logs for error
      const logs = await runCli(['logs', sessionId]);
      expect(logs.stdout).toMatch(/NameError|Error/);

      // Verify we can still continue after error
      await runCli(['send', sessionId, '1 + 1', '--enter']);
      const recoveryResult = await runCli([
        'wait',
        sessionId,
        '--until-match',
        '>>> ',
        '--timeout',
        '3000',
      ]);
      expect(recoveryResult.exitCode).toBe(0);

      // Verify result
      const logsAfter = await runCli(['logs', sessionId, '--tail', '5']);
      expect(logsAfter.stdout).toContain('2');
    } finally {
      await cleanup(sessionId);
    }
  });
});

describe('Scenario: Build & Test Execution', () => {
  it('runs npm test and detects success/failure', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Run a simple test command that will succeed
      await runCli(['send', sessionId, 'echo "Running tests..." && exit 0', '--enter']);

      const result = await runCli(['wait', sessionId, '--until-exit', '--timeout', '10000']);
      expect(result.exitCode).toBe(0);

      // Check logs for expected output
      const logs = await runCli(['logs', sessionId]);
      expect(logs.stdout).toContain('Running tests...');
    } finally {
      await cleanup(sessionId);
    }
  });

  it('detects test failure from exit code', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Run a command that will fail
      await runCli(['send', sessionId, 'echo "Test failed!" && exit 1', '--enter']);

      await runCli(['wait', sessionId, '--until-exit', '--timeout', String(LONG_TIMEOUT)]);

      // Check session status for exit code
      const status = await runCli(['status', sessionId, '--json']);
      const statusData = JSON.parse(status.stdout);
      expect(statusData.exitCode).toBe(1);
    } finally {
      await cleanup(sessionId);
    }
  });
});

describe('Scenario: Multiple Sessions Parallel Operation', () => {
  it('manages multiple concurrent sessions', async () => {
    // Spawn multiple sessions for different purposes
    const frontendSession = (await runCli(['spawn', 'bash', '-n', 'frontend'])).stdout.trim();
    const backendSession = (await runCli(['spawn', 'bash', '-n', 'backend'])).stdout.trim();
    const dbSession = (await runCli(['spawn', 'bash', '-n', 'database'])).stdout.trim();

    try {
      // Wait for all to be ready
      await Promise.all([
        runCli(['wait', frontendSession, '--until-ready', '--timeout', String(TIMEOUT)]),
        runCli(['wait', backendSession, '--until-ready', '--timeout', String(TIMEOUT)]),
        runCli(['wait', dbSession, '--until-ready', '--timeout', String(TIMEOUT)]),
      ]);

      // Send commands to each concurrently
      await Promise.all([
        runCli(['send', frontendSession, 'echo "Frontend starting on port 3000"', '--enter']),
        runCli(['send', backendSession, 'echo "Backend starting on port 8080"', '--enter']),
        runCli(['send', dbSession, 'echo "Database ready on port 5432"', '--enter']),
      ]);

      // Wait for outputs
      await Promise.all([
        runCli([
          'wait',
          frontendSession,
          '--until-match',
          'port 3000',
          '--timeout',
          String(TIMEOUT),
        ]),
        runCli([
          'wait',
          backendSession,
          '--until-match',
          'port 8080',
          '--timeout',
          String(TIMEOUT),
        ]),
        runCli(['wait', dbSession, '--until-match', 'port 5432', '--timeout', String(TIMEOUT)]),
      ]);

      // Verify each session has its own history
      const [frontendLogs, backendLogs, dbLogs] = await Promise.all([
        runCli(['logs', frontendSession]),
        runCli(['logs', backendSession]),
        runCli(['logs', dbSession]),
      ]);

      expect(frontendLogs.stdout).toContain('port 3000');
      expect(frontendLogs.stdout).not.toContain('port 8080');
      expect(backendLogs.stdout).toContain('port 8080');
      expect(dbLogs.stdout).toContain('port 5432');

      // List sessions and verify names
      const lsResult = await runCli(['ls', '--json']);
      const sessions = JSON.parse(lsResult.stdout);
      const names = sessions.map((s: { name: string }) => s.name);
      expect(names).toContain('frontend');
      expect(names).toContain('backend');
      expect(names).toContain('database');
    } finally {
      await Promise.all([cleanup(frontendSession), cleanup(backendSession), cleanup(dbSession)]);
    }
  });
});

describe('Scenario: Interactive Prompt Response', () => {
  it('responds to y/n confirmation prompts', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Create a script that asks for confirmation
      await runCli([
        'send',
        sessionId,
        'read -p "Continue? [y/n] " answer && echo "You said: $answer"',
        '--enter',
      ]);

      // Wait for prompt
      await runCli([
        'wait',
        sessionId,
        '--until-match',
        'Continue\\?',
        '--timeout',
        String(TIMEOUT),
      ]);

      // Respond with 'y'
      await runCli(['send', sessionId, 'y', '--enter']);

      // Verify response was captured
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'You said: y',
        '--timeout',
        '3000',
      ]);
      expect(result.exitCode).toBe(0);
    } finally {
      await cleanup(sessionId);
    }
  });

  it('handles multi-step interactive wizard', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Simulate a multi-step wizard
      const wizardScript = `
        read -p "Name: " name
        read -p "Age: " age
        echo "Hello $name, you are $age years old"
      `
        .trim()
        .replace(/\n/g, '; ');

      await runCli(['send', sessionId, wizardScript, '--enter']);

      // Step 1: Enter name
      await runCli(['wait', sessionId, '--until-match', 'Name:', '--timeout', String(TIMEOUT)]);
      await runCli(['send', sessionId, 'Alice', '--enter']);

      // Step 2: Enter age
      await runCli(['wait', sessionId, '--until-match', 'Age:', '--timeout', String(TIMEOUT)]);
      await runCli(['send', sessionId, '30', '--enter']);

      // Verify final output
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'Hello Alice, you are 30 years old',
        '--timeout',
        '3000',
      ]);
      expect(result.exitCode).toBe(0);
    } finally {
      await cleanup(sessionId);
    }
  });
});

describe('Scenario: Long-running Command Cancellation', () => {
  it('cancels a long-running process with Ctrl+C', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Start a long-running command (use unique markers to avoid matching input line)
      await runCli([
        'send',
        sessionId,
        'echo "STARTED_MARKER"; sleep 60; echo "FINISHED_MARKER"',
        '--enter',
      ]);

      // Wait for it to start
      await runCli([
        'wait',
        sessionId,
        '--until-match',
        'STARTED_MARKER',
        '--timeout',
        String(TIMEOUT),
      ]);

      // Send Ctrl+C
      await runCli(['send', sessionId, '--key', 'Ctrl-c']);

      // Wait for shell to be ready again
      const result = await runCli(['wait', sessionId, '--until-ready', '--timeout', '3000']);
      expect(result.exitCode).toBe(0);

      // Count occurrences of markers - STARTED should appear twice (input + output),
      // FINISHED should appear once (only in input, not in output since cancelled)
      const logs = await runCli(['logs', sessionId]);
      const startedCount = (logs.stdout.match(/STARTED_MARKER/g) || []).length;
      const finishedCount = (logs.stdout.match(/FINISHED_MARKER/g) || []).length;

      // Input line has both, output has only STARTED (command was cancelled before FINISHED)
      expect(startedCount).toBeGreaterThanOrEqual(2); // in input + in output
      expect(finishedCount).toBe(1); // only in input line
    } finally {
      await cleanup(sessionId);
    }
  });
});

describe('Scenario: Error Recovery', () => {
  it('recovers from command failure and retries', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // First attempt: command that fails
      await runCli(['send', sessionId, 'cat /nonexistent/file.txt', '--enter']);
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Check for error
      const logsAfterError = await runCli(['logs', sessionId, '--tail', '5']);
      expect(logsAfterError.stdout).toMatch(/No such file|cannot open/i);

      // Recovery: create the file and retry
      await runCli(['send', sessionId, 'mkdir -p /tmp/test-recovery', '--enter']);
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      await runCli([
        'send',
        sessionId,
        'echo "recovered!" > /tmp/test-recovery/file.txt',
        '--enter',
      ]);
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      await runCli(['send', sessionId, 'cat /tmp/test-recovery/file.txt', '--enter']);
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'recovered!',
        '--timeout',
        '3000',
      ]);
      expect(result.exitCode).toBe(0);

      // Cleanup test files
      await runCli(['send', sessionId, 'rm -rf /tmp/test-recovery', '--enter']);
    } finally {
      await cleanup(sessionId);
    }
  });
});

describe('Scenario: Environment Setup', () => {
  it('sets up environment and verifies configuration', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Change directory
      await runCli(['send', sessionId, 'cd /tmp && pwd', '--enter']);
      await runCli(['wait', sessionId, '--until-match', '/tmp', '--timeout', String(TIMEOUT)]);

      // Set environment variables
      await runCli(['send', sessionId, 'export MY_VAR="test_value"', '--enter']);
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      await runCli(['send', sessionId, 'export NODE_ENV="development"', '--enter']);
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Verify environment
      await runCli(['send', sessionId, 'echo "MY_VAR=$MY_VAR NODE_ENV=$NODE_ENV"', '--enter']);
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'MY_VAR=test_value NODE_ENV=development',
        '--timeout',
        '3000',
      ]);
      expect(result.exitCode).toBe(0);

      // Verify working directory persists
      await runCli(['send', sessionId, 'pwd', '--enter']);
      const pwdResult = await runCli([
        'wait',
        sessionId,
        '--until-match',
        '/tmp',
        '--timeout',
        '3000',
      ]);
      expect(pwdResult.exitCode).toBe(0);
    } finally {
      await cleanup(sessionId);
    }
  });

  it('spawns session with custom environment', async () => {
    // Spawn with custom env vars
    const spawnResult = await runCli([
      'spawn',
      'bash',
      '--env',
      'CUSTOM_VAR=hello',
      '--env',
      'ANOTHER_VAR=world',
    ]);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Verify custom environment variables
      await runCli(['send', sessionId, 'echo "$CUSTOM_VAR $ANOTHER_VAR"', '--enter']);
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'hello world',
        '--timeout',
        '3000',
      ]);
      expect(result.exitCode).toBe(0);
    } finally {
      await cleanup(sessionId);
    }
  });
});

describe('Scenario: Pattern Wait Branching', () => {
  it('detects server startup success or failure', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Simulate server startup (success case)
      await runCli([
        'send',
        sessionId,
        'echo "Initializing..." && sleep 0.5 && echo "Server listening on port 3000"',
        '--enter',
      ]);

      // Wait for either success or error pattern
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'listening on port|error|failed',
        '--timeout',
        '5000',
        '--json',
      ]);

      const data = JSON.parse(result.stdout);
      expect(data.reason).toBe('pattern');
      expect(data.match[0]).toContain('listening on port');
    } finally {
      await cleanup(sessionId);
    }
  });

  it('detects server startup failure', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Simulate server startup (failure case)
      await runCli([
        'send',
        sessionId,
        'echo "Initializing..." && sleep 0.5 && echo "Error: Port 3000 already in use"',
        '--enter',
      ]);

      // Wait for either success or error pattern
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'listening on port|Error:',
        '--timeout',
        '5000',
        '--json',
      ]);

      const data = JSON.parse(result.stdout);
      expect(data.reason).toBe('pattern');
      expect(data.match[0]).toContain('Error:');
    } finally {
      await cleanup(sessionId);
    }
  });

  it('handles timeout when no pattern matches', async () => {
    const spawnResult = await runCli(['spawn', 'bash']);
    const sessionId = spawnResult.stdout.trim();

    try {
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Start something that won't match our pattern
      await runCli(['send', sessionId, 'echo "Something else entirely"', '--enter']);
      await runCli(['wait', sessionId, '--until-ready', '--timeout', String(TIMEOUT)]);

      // Wait for pattern that won't appear (with short timeout)
      const result = await runCli([
        'wait',
        sessionId,
        '--until-match',
        'this_pattern_will_not_match_xyz',
        '--timeout',
        '1000',
      ]);

      // Should timeout with exit code 1
      expect(result.exitCode).toBe(1);
      // stderr should mention timeout
      expect(result.stderr).toMatch(/timed? out/i);
    } finally {
      await cleanup(sessionId);
    }
  });
});
