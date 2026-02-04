import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

// Measures how long a big `cat` takes when its output must flow through:
// - umux + Ghostty VT engine (in-process, no CLI overhead)
// - tmux server (external control via `tmux wait-for`)
//
// This helps answer whether a terminal state engine becomes the bottleneck
// (backpressure on PTY writes can slow the producer).
//
// Usage:
//   npm run build
//   LINES=200000 node scripts/bench/cat-throughput.mjs
//
// Notes:
// - This is a best-effort benchmark and will vary by machine.
// - It prints the shell-reported elapsed time (nanoseconds) plus a host wall clock.

const LINES = Number.parseInt(process.env.LINES ?? '200000', 10);
const KEEP_ALIVE_S = Number.parseInt(process.env.KEEP_ALIVE_S ?? '3', 10);

if (!Number.isFinite(LINES) || LINES <= 0) throw new Error(`invalid LINES: ${process.env.LINES}`);
if (!Number.isFinite(KEEP_ALIVE_S) || KEEP_ALIVE_S <= 0) {
  throw new Error(`invalid KEEP_ALIVE_S: ${process.env.KEEP_ALIVE_S}`);
}

const distIndex = new URL('../../dist/index.js', import.meta.url);
const { Umux, createGhosttyWasmTerminalEngine } = await import(distIndex.href);

const dir = mkdtempSync(join(tmpdir(), 'umux-bench-cat-'));
const logPath = join(dir, 'log.txt');
const runPath = join(dir, 'run.sh');

function parseElapsedNs(text) {
  const m = String(text).match(/ELAPSED_NS=(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

try {
  // Generate a deterministic-ish log file.
  const parts = [];
  for (let i = 0; i < LINES; i += 1) {
    const n = String(i + 1).padStart(6, '0');
    parts.push(`line ${n} lorem ipsum dolor sit amet`);
  }
  writeFileSync(logPath, parts.join('\n') + '\n', 'utf-8');

  writeFileSync(
    runPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      't0=$(date +%s%N)',
      `cat ${JSON.stringify(logPath)}`,
      't1=$(date +%s%N)',
      'echo ELAPSED_NS=$((t1-t0))',
      `sleep ${KEEP_ALIVE_S}`,
      '',
    ].join('\n'),
    { encoding: 'utf-8', mode: 0o755 },
  );

  // -----------------------
  // umux (in-process engine)
  // -----------------------
  const umux = new Umux({ terminalEngine: createGhosttyWasmTerminalEngine });
  const t0 = performance.now();
  const session = await umux.spawn(`bash ${runPath}`, {
    cols: 80,
    rows: 43,
    env: { TERM: 'xterm-256color' },
  });

  // Wait until the shell emits the elapsed line without accumulating unbounded output in JS.
  // Use a simple polling loop over the bounded in-memory history.
  let umuxElapsedNs = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const tail = session.history.tail(50);
    umuxElapsedNs = parseElapsedNs(tail);
    if (umuxElapsedNs != null) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const t1 = performance.now();
  umux.destroy();

  // -----------------------
  // tmux (server, capture)
  // -----------------------
  const tmuxSess = `umuxbench-cat-${process.pid}`;
  const waitKey = `UMUXBENCH_${process.pid}`;
  // Keep the pane alive so we can capture after the marker (tmux will otherwise tear down the session).
  // Use `exec bash` as a portable "stay open" approach.
  spawnSync('tmux', ['new-session', '-d', '-s', tmuxSess, `bash -lc "bash ${runPath}; tmux wait-for -S ${waitKey}; exec bash"`], {
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: 'ignore',
  });
  const t2 = performance.now();
  spawnSync('tmux', ['wait-for', waitKey], { stdio: 'ignore' });
  const t3 = performance.now();
  const cap = spawnSync('tmux', ['capture-pane', '-p', '-t', tmuxSess, '-S', '-50'], {
    encoding: 'utf-8',
  });
  const tmuxElapsedNs = parseElapsedNs(cap.stdout);
  spawnSync('tmux', ['kill-session', '-t', tmuxSess], { stdio: 'ignore' });

  console.log(
    JSON.stringify({
      lines: LINES,
      keep_alive_s: KEEP_ALIVE_S,
      umux: {
        engine: 'ghostty-strict',
        elapsed_ns: umuxElapsedNs,
        wall_ms: Math.round(t1 - t0),
      },
      tmux: {
        elapsed_ns: tmuxElapsedNs,
        wall_ms: Math.round(t3 - t2),
      },
    }),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
