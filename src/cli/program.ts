/**
 * CLI program definition
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';
import { startServer } from '../server/index.js';
import { createClient, type UmuxClient } from './client.js';
import { parseKeySpec } from './keyspec.js';
import { ensureServer, ensureServerTcp, getDefaultSocketPath } from './socket.js';

// Default timeout from environment variable
const DEFAULT_TIMEOUT = process.env.UMUX_DEFAULT_TIMEOUT
  ? parseInt(process.env.UMUX_DEFAULT_TIMEOUT, 10)
  : undefined;

// Cached client
let client: UmuxClient | null = null;
let clientKey: string | null = null;

function stripHelpMargin(text: string): string {
  return text.replace(/^[\t ]*\|/gm, '');
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function parsePort(value: unknown): number {
  const str = String(value ?? '').trim();
  const port = parseInt(str, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function getPackageRootDir(): string {
  // Bundled CLI ends up at dist/cli/bin.js; go up to package root.
  const here = resolve(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..');
}

type GlobalOpts = {
  socket?: string;
  tcp?: boolean;
  host?: string;
  port?: string | number;
  token?: string;
};

function getConnectionConfig(
  opts: GlobalOpts
):
  | { mode: 'socket'; socketPath: string; token?: string }
  | { mode: 'tcp'; host: string; port: number; token?: string } {
  const token = opts.token ?? process.env.UMUX_TOKEN;

  if (opts.tcp) {
    const host = opts.host ?? process.env.UMUX_HOST ?? 'localhost';
    const port = parsePort(opts.port ?? process.env.UMUX_PORT ?? 7070);
    return { mode: 'tcp', host, port, token };
  }

  const socketPath = opts.socket ?? getDefaultSocketPath();
  return { mode: 'socket', socketPath, token };
}

async function getClient(globalOpts: GlobalOpts): Promise<UmuxClient> {
  const conn = getConnectionConfig(globalOpts);
  const nextKey =
    conn.mode === 'socket'
      ? `socket:${conn.socketPath}:token:${conn.token ?? ''}`
      : `tcp:${conn.host}:${conn.port}:token:${conn.token ?? ''}`;

  if (client && clientKey === nextKey) {
    return client;
  }

  // Auto-start server if not running (local only)
  if (conn.mode === 'socket') {
    await ensureServer(conn.socketPath);
    client = createClient({ socketPath: conn.socketPath, token: conn.token });
  } else {
    if (isLoopbackHost(conn.host)) {
      await ensureServerTcp({ host: conn.host, port: conn.port, token: conn.token });
    }
    client = createClient({ host: conn.host, port: conn.port, token: conn.token });
  }

  clientKey = nextKey;
  return client;
}

/**
 * Resolve session ID - if not provided and only one session exists, use it
 */
async function resolveSessionId(
  client: UmuxClient,
  sessionId: string | undefined
): Promise<string> {
  if (sessionId) {
    return sessionId;
  }

  const sessions = await client.listSessions();
  const aliveSessions = sessions.filter((s) => s.isAlive);

  if (aliveSessions.length === 0) {
    throw new Error('No active sessions. Specify a session ID or spawn a new session.');
  }

  if (aliveSessions.length === 1) {
    return aliveSessions[0].id;
  }

  throw new Error(
    `Multiple sessions active (${aliveSessions.length}). Specify a session ID:\n` +
      aliveSessions.map((s) => `  ${s.id}  ${s.name}`).join('\n')
  );
}

function isSessionId(value: string): boolean {
  return /^sess-[A-Za-z0-9_-]{8}$/.test(value);
}

async function resolveSessionName(client: UmuxClient, name: string): Promise<string> {
  const sessions = await client.listSessions();
  const aliveSessions = sessions.filter((s) => s.isAlive);
  const matches = aliveSessions.filter((s) => s.name === name);

  if (matches.length === 0) {
    throw new Error(`No active sessions named "${name}".`);
  }

  if (matches.length === 1) {
    return matches[0].id;
  }

  throw new Error(
    `Multiple sessions named "${name}" (${matches.length}). Specify an ID:\n` +
      matches.map((s) => `  ${s.id}  ${s.name}`).join('\n')
  );
}

type SessionSelectorOptions = {
  id?: string;
  name?: string;
};

async function resolveSessionSelector(
  client: UmuxClient,
  sessionIdOrNameArg: string | undefined,
  options: SessionSelectorOptions
): Promise<string> {
  if (options.id && options.name) {
    throw new Error('Options --id and --name are mutually exclusive.');
  }

  if (options.id) {
    return options.id;
  }

  if (options.name) {
    return resolveSessionName(client, options.name);
  }

  // If the positional argument doesn't look like a session id, treat it as a session name.
  if (sessionIdOrNameArg && !isSessionId(sessionIdOrNameArg)) {
    return resolveSessionName(client, sessionIdOrNameArg);
  }

  return resolveSessionId(client, sessionIdOrNameArg);
}

/**
 * Format wait result for display
 */
function formatWaitResult(result: {
  reason: string;
  waitedMs: number;
  output?: string;
  match?: unknown;
}): string {
  const seconds = (result.waitedMs / 1000).toFixed(1);
  let message = `Waited ${seconds}s, ended by: ${result.reason}`;

  if ((result.reason === 'pattern' || result.reason === 'screen') && result.match) {
    const matchText = Array.isArray(result.match) ? result.match[0] : String(result.match);
    message += ` (matched: "${matchText.slice(0, 50)}${matchText.length > 50 ? '...' : ''}")`;
  }

  return message;
}

/**
 * Gracefully kill a session: SIGTERM → wait → SIGKILL if still alive
 */
async function gracefulKill(
  client: UmuxClient,
  sessionId: string,
  signal?: string,
  gracePeriodMs = 500
): Promise<void> {
  // If user explicitly requested a signal, just use that
  if (signal) {
    await client.kill(sessionId, signal);
    return;
  }

  // Graceful: SIGTERM → wait → SIGKILL
  try {
    await client.kill(sessionId, 'SIGTERM');
  } catch {
    return; // Session might already be dead
  }

  await new Promise((r) => setTimeout(r, gracePeriodMs));

  // Check if still alive, send SIGKILL if needed
  try {
    const session = await client.getSession(sessionId);
    if (session.isAlive) {
      await client.kill(sessionId, 'SIGKILL');
    }
  } catch {
    // Session gone, that's fine
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('umux')
    .description('Agent-ready terminal multiplexer')
    .version('0.0.1')
    .option('-S, --socket <path>', 'Socket path', getDefaultSocketPath())
    .option('--tcp', 'Use TCP on localhost instead of a Unix socket')
    .option('--host <host>', 'TCP host (when --tcp)', process.env.UMUX_HOST ?? 'localhost')
    .option('--port <n>', 'TCP port (when --tcp)', process.env.UMUX_PORT ?? '7070')
    .option('--token <token>', 'Auth token', process.env.UMUX_TOKEN);

  program.addHelpText(
    'after',
    stripHelpMargin(`
      |Detailed docs/examples: run \`umux guide\`.
      |
      |Workflow quickstart:
      |  # 1) Start a persistent session
      |  SESSION_NAME="agent-$$"; umux spawn -n "$SESSION_NAME" bash
      |  # 2) Send commands (state persists: cwd/env/history)
      |  umux send --name "$SESSION_NAME" "cd /project" --enter; umux send --name "$SESSION_NAME" "npm test" --enter
      |  # 3) Block explicitly when you care about completion/settling
      |  umux wait --name "$SESSION_NAME" --block-until-ready --timeout 60000
      |  # 4) Read output / snapshot screen (logs defaults to last 100 lines)
      |  umux logs --name "$SESSION_NAME"; umux capture --name "$SESSION_NAME"
      |  # 5) Clean up
      |  umux rm --name "$SESSION_NAME"
      |
      |TUI automation pattern:
      |  APP_NAME="app-$$"; umux spawn -n "$APP_NAME" some-tui
      |  # Prefer a stable screen match for "startup ready" when possible:
      |  umux wait --name "$APP_NAME" --block-until-screen-match "Welcome|Ready" --timeout 30000 || umux wait --name "$APP_NAME" --block-until-idle 1000 --timeout 30000
      |  # After key presses, wait briefly for the UI to settle, then capture:
      |  umux send --name "$APP_NAME" --key Tab --block-until-idle 200 --timeout 3000; umux capture --name "$APP_NAME"
      |
      |Notes:
      |  - umux runs a local server; auto-starts on first command (e.g. \`umux spawn\`). Use \`--socket\` to control the socket path.
      |  - Most commands accept \`--name\` / \`--id\`. If exactly one session is active, you can omit it; prefer \`--id\` in scripts.
      |  - Keys: \`umux send --key Enter\` / \`Ctrl-C\`, or \`umux send --keys "Escape,:wq,Enter"\` (supports Enter/Tab/Escape/Backspace/Delete/Space, Up/Down/Left/Right, Home/End/PageUp/PageDown/Insert, F1-F12, Ctrl/Alt/Shift/Meta combos, and Shift-Tab).
      |  - Remote (SSH tunnel, no public bind): \`TOKEN=$(openssl rand -hex 16)\`; \`ssh ubuntu@machine "UMUX_TOKEN=$TOKEN nohup umux server --tcp --host 127.0.0.1 --port 7070 >/tmp/umux.log 2>&1 &"\`; \`ssh -N -L 7070:127.0.0.1:7070 ubuntu@machine\`; \`UMUX_TOKEN=$TOKEN umux --tcp --host 127.0.0.1 --port 7070 ls\`.
      |  - Env: \`UMUX_HOST\`/\`UMUX_PORT\`/\`UMUX_TOKEN\` (TCP config), \`UMUX_DEFAULT_TIMEOUT\` (default --timeout), \`UMUX_LOG_DIR\` (persist I/O as JSONL).
      |  - Codex: local socket may fail with EPERM in restricted sandbox; ask user to approve running \`umux\` (or enable allowlist/YOLO).
    `).trimEnd()
  );

  // ===========================================================================
  // Session commands
  // ===========================================================================

  program
    .command('guide')
    .description('Show bundled docs and examples')
    .argument('[topic]', 'One of: readme, cli, examples')
    .option('--json', 'Output locations as JSON')
    .action((topic: string | undefined, options) => {
      const root = getPackageRootDir();
      const readmePath = resolve(root, 'README.md');
      const cliDocPath = resolve(root, 'docs', 'cli.md');
      const examplesDir = resolve(root, 'examples');

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              root,
              readme: existsSync(readmePath) ? readmePath : null,
              docsCli: existsSync(cliDocPath) ? cliDocPath : null,
              examplesDir: existsSync(examplesDir) ? examplesDir : null,
            },
            null,
            2
          )
        );
        return;
      }

      const normalized = (topic ?? '').trim().toLowerCase();
      if (!normalized) {
        console.log(pc.bold('umux guide'));
        console.log('');
        console.log(`Package root: ${root}`);
        console.log(`README: ${existsSync(readmePath) ? readmePath : pc.dim('(missing)')}`);
        console.log(`CLI docs: ${existsSync(cliDocPath) ? cliDocPath : pc.dim('(missing)')}`);
        console.log(`Examples: ${existsSync(examplesDir) ? examplesDir : pc.dim('(missing)')}`);
        console.log('');
        console.log('Usage:');
        console.log('  umux guide readme     # print README.md');
        console.log('  umux guide cli        # print docs/cli.md');
        console.log('  umux guide examples   # list examples/');
        return;
      }

      if (normalized === 'readme') {
        if (!existsSync(readmePath)) {
          console.error(pc.red(`README not found: ${readmePath}`));
          process.exit(1);
        }
        process.stdout.write(readFileSync(readmePath, 'utf8'));
        return;
      }

      if (normalized === 'cli') {
        if (!existsSync(cliDocPath)) {
          console.error(pc.red(`CLI docs not found: ${cliDocPath}`));
          process.exit(1);
        }
        process.stdout.write(readFileSync(cliDocPath, 'utf8'));
        return;
      }

      if (normalized === 'examples') {
        if (!existsSync(examplesDir)) {
          console.error(pc.red(`Examples directory not found: ${examplesDir}`));
          process.exit(1);
        }
        const entries = readdirSync(examplesDir, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name)
          .sort();
        if (entries.length === 0) {
          console.log(pc.dim('No examples found'));
          return;
        }
        for (const name of entries) {
          console.log(name);
        }
        return;
      }

      console.error(pc.red(`Unknown guide topic: ${topic}`));
      process.exit(1);
    });

  program
    .command('ls')
    .description('List sessions')
    .option('--all', 'Show all sessions (including exited)')
    .option('--exited', 'Show only exited sessions')
    .option('--limit <n>', 'Limit number of sessions shown (newest first)')
    .option('--json', 'Output as JSON')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);
      const sessions = await client.listSessions();

      if (options.all && options.exited) {
        console.error(pc.red('Options --all and --exited are mutually exclusive.'));
        process.exit(1);
      }

      let filtered = sessions;
      if (options.exited) {
        filtered = filtered.filter((s) => !s.isAlive);
      } else if (!options.all) {
        filtered = filtered.filter((s) => s.isAlive);
      }

      // Newest first
      filtered = filtered.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      if (options.limit) {
        const limit = parseInt(options.limit, 10);
        if (!Number.isFinite(limit) || limit <= 0) {
          console.error(pc.red(`Invalid --limit value: ${options.limit}`));
          process.exit(1);
        }
        filtered = filtered.slice(0, limit);
      }

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        if (options.exited) {
          console.log(pc.dim('No exited sessions'));
        } else if (options.all) {
          console.log(pc.dim('No sessions'));
        } else {
          console.log(pc.dim('No active sessions'));
        }
        return;
      }

      console.log(pc.bold('SESSION ID\t\tNAME\t\tSTATUS\t\tCREATED'));
      for (const s of filtered) {
        let status: string;
        if (!s.isAlive) {
          status = pc.dim('exited');
        } else if (s.foregroundProcess) {
          status = pc.yellow(s.foregroundProcess.command);
        } else {
          status = pc.green('ready');
        }
        console.log(`${s.id}\t${s.name}\t\t${status}\t\t${s.createdAt}`);
      }
    });

  const spawnCommand = program
    .command('spawn')
    .description('Spawn an interactive session (shell, REPL, or other program)')
    .argument('[program]', 'Program to run (default: $SHELL)')
    .option('-n, --name <name>', 'Session name')
    .option('-d, --cwd <dir>', 'Working directory')
    .option(
      '--env <KEY=VALUE>',
      'Environment variable',
      (val, acc: Record<string, string>) => {
        const [key, ...rest] = val.split('=');
        acc[key] = rest.join('=');
        return acc;
      },
      {}
    )
    .option('--cols <n>', 'Terminal columns (default: 80)')
    .option('--rows <n>', 'Terminal rows (default: 43)')
    .option('--block-until-ready', 'Block until shell is ready')
    .option('--block-until-match <pattern>', 'Block until output matches pattern')
    .option('--block-until-screen-match <pattern>', 'Block until screen buffer matches pattern')
    .option('--block-until-idle <ms>', 'Block until no output for N ms')
    .option('--block-until-exit', 'Block until process exits')
    .option('--timeout <ms>', 'Timeout for block-until conditions')
    .option('--json', 'Output as JSON')
    .action(async (program, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      const hasBlockCondition =
        options.blockUntilReady ||
        options.blockUntilMatch ||
        options.blockUntilScreenMatch ||
        options.blockUntilIdle ||
        options.blockUntilExit;
      const timeout = hasBlockCondition
        ? options.timeout
          ? parseInt(options.timeout, 10)
          : DEFAULT_TIMEOUT
        : undefined;
      if (hasBlockCondition && timeout === undefined) {
        console.error(
          pc.red(
            'Error: --timeout is required for block-until conditions (or set UMUX_DEFAULT_TIMEOUT). Example: --timeout 30000'
          )
        );
        process.exit(1);
      }

      const session = await client.spawn(program ?? '', {
        name: options.name,
        cwd: options.cwd,
        env: options.env,
        cols: options.cols ? parseInt(options.cols, 10) : undefined,
        rows: options.rows ? parseInt(options.rows, 10) : undefined,
      });

      let waitResult: unknown;
      if (hasBlockCondition) {
        const condition: Record<string, unknown> = { timeout };
        if (options.blockUntilReady) condition.ready = true;
        if (options.blockUntilMatch) condition.pattern = options.blockUntilMatch;
        if (options.blockUntilScreenMatch) condition.screenPattern = options.blockUntilScreenMatch;
        if (options.blockUntilIdle) condition.idle = parseInt(options.blockUntilIdle, 10);
        if (options.blockUntilExit) condition.exit = true;

        const result = await client.wait(session.id, condition);
        waitResult = result;

        // Only express block-until failure via exit code; keep stdout stable (ID only by default).
        if (result.reason === 'rejected' || result.reason === 'timeout') {
          if (options.json) {
            console.log(JSON.stringify({ id: session.id, pid: session.pid, wait: result }));
          } else {
            console.log(session.id);
          }
          process.exit(1);
        }
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            hasBlockCondition
              ? { id: session.id, pid: session.pid, wait: waitResult }
              : { id: session.id, pid: session.pid }
          )
        );
      } else {
        console.log(session.id);
      }
    });

  spawnCommand.addHelpText(
    'after',
    `
Notes:
  - \`umux spawn\` creates a session. It may also auto-start the umux server if it is not running.
  - Prefer naming sessions (\`-n agent\`) so you can target them later with \`--name\`.
  - If you see socket/connect errors, check your --socket path and permissions.
`.trimEnd()
  );

  program
    .command('send')
    .description('Send text or keys to a session')
    .argument('[session-id]', 'Session ID (optional if only one session)')
    .argument('[text]', 'Text to send')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .option('--key <key>', 'Send a special key')
    .option('--keys <keys>', 'Send multiple keys (comma-separated)')
    .option('--enter', 'Append Enter key after text')
    .option('--block-until-ready', 'Block until shell is ready')
    .option('--block-until-match <pattern>', 'Block until output matches pattern')
    .option('--block-until-screen-match <pattern>', 'Block until screen buffer matches pattern')
    .option('--block-until-idle <ms>', 'Block until no output for N ms')
    .option('--block-until-exit', 'Block until process exits')
    .option('--timeout <ms>', 'Timeout for block-until conditions')
    .option('--json', 'Output as JSON')
    .action(async (sessionIdArg, text, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      let sessionIdInput: string | undefined = sessionIdArg;
      let textInput: string | undefined = text;
      const hasExplicitSession = Boolean(options.id || options.name);

      if (hasExplicitSession && textInput === undefined && sessionIdInput !== undefined) {
        textInput = sessionIdInput;
        sessionIdInput = undefined;
      }

      if (!hasExplicitSession && sessionIdInput && textInput === undefined) {
        if (!isSessionId(sessionIdInput)) {
          textInput = sessionIdInput;
          sessionIdInput = undefined;
        }
      }

      if (!hasExplicitSession && sessionIdInput && !isSessionId(sessionIdInput)) {
        console.error(
          pc.red(
            `Unknown session "${sessionIdInput}". Use --name, --id, or omit the session when only one is active.`
          )
        );
        process.exit(1);
      }

      // Resolve session ID
      let sessionId: string;
      try {
        if (options.id) {
          sessionId = options.id;
        } else if (options.name) {
          sessionId = await resolveSessionName(client, options.name);
        } else {
          sessionId = await resolveSessionId(client, sessionIdInput);
        }
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      // Send text
      if (textInput) {
        await client.send(sessionId, textInput);
      }

      // Send key
      if (options.key) {
        const key = parseKeySpec(options.key);
        await client.sendKey(sessionId, key);
      }

      // Send keys
      if (options.keys) {
        const keys = options.keys.split(',').map((k: string) => {
          const trimmed = k.trim();
          if (!trimmed) return { text: '' };
          try {
            return parseKeySpec(trimmed);
          } catch {
            return { text: trimmed };
          }
        });
        await client.sendKeys(sessionId, keys);
      }

      // Append enter
      if (options.enter) {
        await client.sendKey(sessionId, { key: 'Enter' });
      }

      // Block until condition
      const hasBlockCondition =
        options.blockUntilReady ||
        options.blockUntilMatch ||
        options.blockUntilScreenMatch ||
        options.blockUntilIdle ||
        options.blockUntilExit;
      if (hasBlockCondition) {
        const timeout = options.timeout ? parseInt(options.timeout, 10) : DEFAULT_TIMEOUT;
        if (timeout === undefined) {
          console.error(
            pc.red(
              'Error: --timeout is required for block-until conditions (or set UMUX_DEFAULT_TIMEOUT). Example: --timeout 30000'
            )
          );
          process.exit(1);
        }

        const condition: Record<string, unknown> = { timeout };
        if (options.blockUntilReady) condition.ready = true;
        if (options.blockUntilMatch) condition.pattern = options.blockUntilMatch;
        if (options.blockUntilScreenMatch) condition.screenPattern = options.blockUntilScreenMatch;
        if (options.blockUntilIdle) condition.idle = parseInt(options.blockUntilIdle, 10);
        if (options.blockUntilExit) condition.exit = true;

        const result = await client.wait(sessionId, condition);

        if (options.json) {
          console.log(JSON.stringify(result));
        } else {
          console.log(pc.dim(formatWaitResult(result)));
          if (result.output) {
            console.log(result.output);
          }
          process.exit(result.reason === 'rejected' || result.reason === 'timeout' ? 1 : 0);
        }
      }
    });

  program
    .command('wait')
    .description('Wait for a condition on a session')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .option('--block-until-ready', 'Block until shell is ready (no foreground process)')
    .option('--block-until-match <pattern>', 'Block until output matches pattern (regex)')
    .option(
      '--block-until-screen-match <pattern>',
      'Block until screen buffer matches pattern (regex)'
    )
    .option('--block-until-idle <ms>', 'Block until no output for N milliseconds')
    .option('--block-until-exit', 'Block until process exits')
    .option('--until-ready', 'Wait until shell is ready (no foreground process)')
    .option('--until-match <pattern>', 'Wait until output matches pattern (regex)')
    .option('--until-screen-match <pattern>', 'Wait until screen buffer matches pattern (regex)')
    .option('--until-idle <ms>', 'Wait until no output for N milliseconds')
    .option('--until-exit', 'Wait until process exits')
    .option(
      '--timeout <ms>',
      'Timeout in milliseconds (required unless UMUX_DEFAULT_TIMEOUT is set)'
    )
    .option('--json', 'Output as JSON')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      // Check if any wait condition is specified
      const hasCondition =
        options.blockUntilReady ||
        options.blockUntilMatch ||
        options.blockUntilScreenMatch ||
        options.blockUntilIdle ||
        options.blockUntilExit ||
        options.untilReady ||
        options.untilMatch ||
        options.untilScreenMatch ||
        options.untilIdle ||
        options.untilExit;
      if (!hasCondition) {
        cmd.help();
        return;
      }

      // Resolve timeout
      const timeout = options.timeout ? parseInt(options.timeout, 10) : DEFAULT_TIMEOUT;
      if (timeout === undefined) {
        console.error(
          pc.red(
            'Error: --timeout is required (or set UMUX_DEFAULT_TIMEOUT environment variable). Example: --timeout 30000'
          )
        );
        process.exit(1);
      }

      // Resolve session ID
      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      const condition: Record<string, unknown> = { timeout };
      if (options.blockUntilReady || options.untilReady) condition.ready = true;
      if (options.blockUntilMatch ?? options.untilMatch) {
        condition.pattern = (options.blockUntilMatch ?? options.untilMatch) as string;
      }
      if (options.blockUntilScreenMatch ?? options.untilScreenMatch) {
        condition.screenPattern = (options.blockUntilScreenMatch ??
          options.untilScreenMatch) as string;
      }
      if (options.blockUntilIdle ?? options.untilIdle) {
        condition.idle = parseInt((options.blockUntilIdle ?? options.untilIdle) as string, 10);
      }
      if (options.blockUntilExit || options.untilExit) condition.exit = true;

      const result = await client.wait(sessionId, condition);

      if (options.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(pc.dim(formatWaitResult(result)));
        if (result.output) {
          console.log(result.output);
        }
        process.exit(result.reason === 'rejected' || result.reason === 'timeout' ? 1 : 0);
      }
    });

  program
    .command('logs')
    .description('View session history')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .option('--tail <n>', 'Last N lines (default: 100)')
    .option('--head <n>', 'First N lines')
    .option('--all', 'Return all output (no default tail limit)')
    .option('--search <pattern>', 'Search in history')
    .option('--send-only', 'Show only input sent to the session')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      // Resolve session ID
      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      const stream = options.sendOnly ? 'input' : 'output';

      if (options.search) {
        const result = await client.searchHistory(sessionId, options.search, { stream });
        for (const m of result.matches) {
          console.log(`${pc.dim(String(m.line))}:${m.text}`);
        }
        return;
      }

      const historyOptions: { tail?: number; head?: number } = {};
      if (options.tail) {
        historyOptions.tail = parseInt(options.tail, 10);
      } else if (options.head) {
        historyOptions.head = parseInt(options.head, 10);
      } else if (!options.all) {
        // Default: last 100 lines to prevent overwhelming output
        historyOptions.tail = 100;
      }

      const result = await client.getHistory(sessionId, { ...historyOptions, stream });
      console.log(result.lines.join('\n'));
    });

  program
    .command('capture')
    .description('Capture current screen buffer')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .option('--format <format>', 'Output format (text|ansi)', 'text')
    .option('--json', 'Output as JSON')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      const format = options.format === 'ansi' ? 'ansi' : 'text';
      const result = await client.capture(sessionId, { format });

      if (options.json) {
        console.log(JSON.stringify(result));
        return;
      }

      process.stdout.write(result.content);
      if (!result.content.endsWith('\n')) {
        process.stdout.write('\n');
      }
    });

  program
    .command('status')
    .description('Get session status')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .option('--is-ready', 'Check if shell is ready (exit 0 if ready, 1 if not)')
    .option('--is-idle <ms>', 'Check if no output for N ms (exit 0 if idle, 1 if not)')
    .option('--json', 'Output as JSON')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      // Resolve session ID
      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      const session = await client.getSession(sessionId);

      // Check conditions
      if (options.isReady) {
        const isReady = !session.foregroundProcess && session.isAlive;
        if (options.json) {
          console.log(JSON.stringify({ isReady }));
        }
        process.exit(isReady ? 0 : 1);
      }

      if (options.isIdle) {
        const idleMs = parseInt(options.isIdle, 10);
        const lastOutputAt = session.lastOutputAt ? new Date(session.lastOutputAt) : null;
        const msSinceOutput = lastOutputAt ? Date.now() - lastOutputAt.getTime() : Infinity;
        const isIdle = msSinceOutput >= idleMs;
        if (options.json) {
          console.log(
            JSON.stringify({ isIdle, msSinceOutput: lastOutputAt ? msSinceOutput : null })
          );
        }
        process.exit(isIdle ? 0 : 1);
      }

      // Default: show human-readable status
      if (options.json) {
        console.log(JSON.stringify(session, null, 2));
        return;
      }

      let status: string;
      if (!session.isAlive) {
        status = pc.dim(`exited (${session.exitCode})`);
      } else if (session.foregroundProcess) {
        status = pc.yellow(`running: ${session.foregroundProcess.command}`);
      } else {
        status = pc.green('ready');
      }

      console.log(`${session.id}  ${status}`);
    });

  program
    .command('rm')
    .description('Remove a session')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .option('--exited', 'Remove all exited sessions')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      // Remove all exited sessions (concurrent)
      if (options.exited) {
        const sessions = await client.listSessions();
        const exitedSessions = sessions.filter((s) => !s.isAlive);
        await Promise.all(
          exitedSessions.map((session) => client.deleteSession(session.id).catch(() => {}))
        );
        console.log(`Removed ${exitedSessions.length} exited session(s)`);
        return;
      }

      // Resolve session ID
      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      try {
        // Kill first if alive, then delete
        const session = await client.getSession(sessionId);
        if (session.isAlive) {
          await gracefulKill(client, sessionId);
        }
        await client.deleteSession(sessionId);
      } catch (e) {
        console.error(pc.red(`Failed to remove session: ${(e as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command('kill')
    .description('Kill a session process')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .option('--all', 'Kill all alive sessions')
    .option('--signal <signal>', 'Signal to send (default: graceful SIGTERM→SIGKILL)')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      // Kill all sessions (concurrent)
      if (options.all) {
        const sessions = await client.listSessions();
        const aliveSessions = sessions.filter((s) => s.isAlive);
        await Promise.all(
          aliveSessions.map((session) =>
            gracefulKill(client, session.id, options.signal).catch(() => {})
          )
        );
        console.log(`Killed ${aliveSessions.length} session(s)`);
        return;
      }

      // Resolve session ID
      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      try {
        await gracefulKill(client, sessionId, options.signal);
      } catch (_e) {
        // If kill fails, try to delete the session
        try {
          await client.deleteSession(sessionId);
        } catch {
          console.error(pc.red(`Not found: ${sessionId}`));
          process.exit(4);
        }
      }
    });

  program
    .command('resize')
    .description('Resize session terminal')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .requiredOption('--cols <n>', 'Terminal columns')
    .requiredOption('--rows <n>', 'Terminal rows')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      // Resolve session ID
      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      await client.resize(sessionId, parseInt(options.cols, 10), parseInt(options.rows, 10));
    });

  // ===========================================================================
  // Hook commands
  // ===========================================================================

  const hookCommand = program
    .command('hook')
    .description('Manage hooks that run shell commands on events');

  hookCommand
    .command('ls')
    .description('List all hooks')
    .option('--json', 'Output as JSON')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const client = await getClient(globalOpts);
      const hooks = await client.listHooks();

      if (options.json) {
        console.log(JSON.stringify(hooks, null, 2));
        return;
      }

      if (hooks.length === 0) {
        console.log(pc.dim('No hooks'));
        return;
      }

      console.log(pc.bold('ID\t\tSESSION\t\tEVENT\t\tCOMMAND'));
      for (const h of hooks) {
        let event: string;
        if (h.onMatch) event = `match(${h.onMatch})`;
        else if (h.onReady) event = 'ready';
        else if (h.onExit) event = 'exit';
        else event = 'unknown';

        console.log(`${h.id}\t${h.sessionId}\t${event}\t${h.run}`);
      }
    });

  hookCommand
    .command('add')
    .description('Add a new hook')
    .argument('[session-id]', 'Session ID or name (optional if only one session)')
    .option('--id <session-id>', 'Session ID')
    .option('--name <name>', 'Session name')
    .requiredOption('--run <command>', 'Command to run when triggered')
    .option('--on-match <regex>', 'Trigger on output match')
    .option('--on-ready', 'Trigger when shell is ready')
    .option('--on-exit', 'Trigger when process exits')
    .option('--once', 'Remove hook after first trigger')
    .action(async (sessionIdArg, options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const client = await getClient(globalOpts);

      // Resolve session ID
      let sessionId: string;
      try {
        sessionId = await resolveSessionSelector(client, sessionIdArg, options);
      } catch (e) {
        console.error(pc.red((e as Error).message));
        process.exit(1);
      }

      const hook = await client.addHook({
        sessionId,
        run: options.run,
        onMatch: options.onMatch,
        onReady: options.onReady,
        onExit: options.onExit,
        once: options.once,
      });

      console.log(hook.id);
    });

  hookCommand
    .command('rm')
    .description('Remove a hook')
    .argument('<hook-id>', 'Hook ID')
    .action(async (hookId, _options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const client = await getClient(globalOpts);
      await client.removeHook(hookId);
    });

  // Hidden server command for background auto-start
  program
    .command('server', { hidden: true })
    .description('Start the umux server (internal use)')
    .option('-S, --socket <path>', 'Socket path')
    .option('--tcp', 'Use TCP instead of a Unix socket')
    .option('--host <host>', 'Host to bind (TCP mode)')
    .option('--port <n>', 'Port to bind (TCP mode)')
    .option('--token <token>', 'Auth token (recommended)')
    .option('--log-dir <dir>', 'Write session I/O logs as JSONL to this directory')
    .option(
      '--engine <engine>',
      'Terminal engine (xterm|ghostty|ghostty-strict)',
      process.env.UMUX_TERMINAL_ENGINE ?? 'ghostty'
    )
    .action(async (_options, cmd) => {
      const mergedOpts = { ...(cmd.parent?.opts() ?? {}), ...(cmd.opts() ?? {}) } as GlobalOpts;
      const conn = getConnectionConfig(mergedOpts);
      const serverOpts = cmd.opts() as { logDir?: string; engine?: string };
      const engine =
        serverOpts.engine === 'ghostty'
          ? 'ghostty'
          : serverOpts.engine === 'ghostty-strict'
            ? 'ghostty-strict'
            : 'xterm';

      if (conn.mode === 'tcp') {
        const isUnsafeBind = !isLoopbackHost(conn.host);
        if (isUnsafeBind && !conn.token) {
          console.error(
            pc.red(
              `Refusing to start TCP server on non-loopback host without --token (host: ${conn.host}). ` +
                `Example: TOKEN=$(openssl rand -hex 16); umux server --tcp --host ${conn.host} --port ${conn.port} --token $TOKEN`
            )
          );
          process.exit(1);
        }

        await startServer({
          host: conn.host,
          port: conn.port,
          auth: conn.token ? { type: 'token', token: conn.token } : { type: 'none' },
          logDir: serverOpts.logDir,
          terminalEngine: engine,
        });
      } else {
        await startServer({
          socketPath: conn.socketPath,
          auth: conn.token ? { type: 'token', token: conn.token } : { type: 'none' },
          logDir: serverOpts.logDir,
          terminalEngine: engine,
        });
      }

      // Keep the process running
      await new Promise(() => {});
    });

  return program;
}
