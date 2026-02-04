import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

// Compare tmux polling vs umux event-driven waiting for a marker that appears
// after dumping a large "log" to the terminal, plus repeated viewport captures.
//
// Requires: `npm run build` and `tmux` available.
//
// Usage:
//   node scripts/bench/logs-vs-tmux.mjs
//   LINES=200000 CAPTURES=200 node scripts/bench/logs-vs-tmux.mjs

const LINES = Number.parseInt(process.env.LINES ?? '200000', 10);
const CAPTURES = Number.parseInt(process.env.CAPTURES ?? '100', 10);
const KEEP_ALIVE_S = Number.parseInt(process.env.KEEP_ALIVE_S ?? '10', 10);

if (!Number.isFinite(LINES) || LINES <= 0) throw new Error(`invalid LINES: ${process.env.LINES}`);
if (!Number.isFinite(CAPTURES) || CAPTURES <= 0) throw new Error(`invalid CAPTURES: ${process.env.CAPTURES}`);
if (!Number.isFinite(KEEP_ALIVE_S) || KEEP_ALIVE_S <= 0) throw new Error(`invalid KEEP_ALIVE_S: ${process.env.KEEP_ALIVE_S}`);

const distIndex = new URL('../../dist/index.js', import.meta.url);
const { Umux, createGhosttyWasmTerminalEngine } = await import(distIndex.href);

const marker = 'UMUX_BENCH_DONE';

function msPerOp(totalMs, n) {
  return Math.round((totalMs / n) * 1000) / 1000;
}

function hrNowMs() {
  return performance.now();
}

const dir = mkdtempSync(join(tmpdir(), 'umux-bench-logs-'));
const logPath = join(dir, 'log.txt');
const runPath = join(dir, 'run.sh');

try {
  // Generate a deterministic-ish log file.
  // Keep line length reasonable so terminal parsing is realistic.
  const lines = [];
  for (let i = 0; i < LINES; i += 1) {
    const n = String(i + 1).padStart(6, '0');
    lines.push(`line ${n} lorem ipsum dolor sit amet`);
  }
  writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');
  writeFileSync(
    runPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `cat ${JSON.stringify(logPath)}`,
      `echo ${marker}`,
      `sleep ${KEEP_ALIVE_S}`,
      '',
    ].join('\n'),
    { encoding: 'utf-8', mode: 0o755 },
  );

  // -----------------------
  // umux (in-process engine)
  // -----------------------
  const umux = new Umux({ terminalEngine: createGhosttyWasmTerminalEngine });
  const session = await umux.spawn(
    `bash ${runPath}`,
    { cols: 80, rows: 43, env: { TERM: 'xterm-256color' } },
  );

  const t0 = hrNowMs();
  await umux.waitFor(session.id, { pattern: marker, timeout: 60_000 });
  const t1 = hrNowMs();

  // Warmup capture.
  session.capture({ format: 'text' });

  const t2 = hrNowMs();
  for (let i = 0; i < CAPTURES; i += 1) {
    session.capture({ format: 'text' });
  }
  const t3 = hrNowMs();
  umux.destroy();

  const umuxWaitMs = t1 - t0;
  const umuxCaptureMs = t3 - t2;

  // -----------------------
  // tmux (polling capture)
  // -----------------------
  const tmuxSess = `umuxbench-logs-${process.pid}`;
  spawnSync('tmux', ['new-session', '-d', '-s', tmuxSess, `bash ${runPath}`], {
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: 'ignore',
  });

  // Poll capture-pane until marker appears (typical automation loop).
  const t4 = hrNowMs();
  for (;;) {
    const out = spawnSync('tmux', ['capture-pane', '-p', '-t', tmuxSess], { encoding: 'utf-8' });
    if (String(out.stdout ?? '').includes(marker)) break;
  }
  const t5 = hrNowMs();

  // Repeated captures.
  const t6 = hrNowMs();
  for (let i = 0; i < CAPTURES; i += 1) {
    spawnSync('tmux', ['capture-pane', '-p', '-t', tmuxSess], { stdio: 'ignore' });
  }
  const t7 = hrNowMs();

  spawnSync('tmux', ['kill-session', '-t', tmuxSess], { stdio: 'ignore' });

  const tmuxWaitMs = t5 - t4;
  const tmuxCaptureMs = t7 - t6;

  console.log(JSON.stringify({
    lines: LINES,
    captures: CAPTURES,
    keep_alive_s: KEEP_ALIVE_S,
    umux: {
      engine: 'ghostty-strict',
      wait_ms: Math.round(umuxWaitMs),
      capture_total_ms: Math.round(umuxCaptureMs),
      capture_ms_per_op: msPerOp(umuxCaptureMs, CAPTURES),
    },
    tmux: {
      wait_ms: Math.round(tmuxWaitMs),
      capture_total_ms: Math.round(tmuxCaptureMs),
      capture_ms_per_op: msPerOp(tmuxCaptureMs, CAPTURES),
    },
  }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
