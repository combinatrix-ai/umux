import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

// Requires: npm run build
// Usage:
//   ITER=200 node scripts/bench/engine-vs-tmux.mjs

const ITER = Number.parseInt(process.env.ITER ?? '200', 10);
const DURATION = Number.parseInt(process.env.DURATION ?? '10', 10);

if (!Number.isFinite(ITER) || ITER <= 0) throw new Error(`invalid ITER: ${process.env.ITER}`);
if (!Number.isFinite(DURATION) || DURATION <= 0) throw new Error(`invalid DURATION: ${process.env.DURATION}`);

const distIndex = new URL('../../dist/index.js', import.meta.url);
const { Umux, createGhosttyWasmTerminalEngine } = await import(distIndex.href);

if (typeof Umux !== 'function') throw new Error('missing Umux export (run npm run build?)');
if (typeof createGhosttyWasmTerminalEngine !== 'function') {
  throw new Error('missing createGhosttyWasmTerminalEngine export (run npm run build?)');
}

const dir = mkdtempSync(join(tmpdir(), 'umux-bench-engine-'));
const scriptPath = join(dir, 'tui.py');
writeFileSync(
  scriptPath,
  [
    'import curses, time, os',
    '',
    'def main(stdscr):',
    '    curses.curs_set(0)',
    "    stdscr.addstr(0, 0, 'UMUX_BENCH_OK')",
    '    stdscr.refresh()',
    '    start = time.time()',
    "    duration = float(os.environ.get('UMUX_BENCH_DURATION', '10'))",
    '    while time.time() - start < duration:',
    '        time.sleep(0.01)',
    '',
    'curses.wrapper(main)',
    '',
  ].join('\n'),
  'utf-8',
);

function msPerOp(totalMs) {
  return Math.round((totalMs / ITER) * 1000) / 1000;
}

try {
  // umux (in-process)
  const umux = new Umux({ terminalEngine: createGhosttyWasmTerminalEngine });
  const session = await umux.spawn(`python3 ${scriptPath}`, {
    cols: 80,
    rows: 43,
    env: { TERM: 'xterm-256color', UMUX_BENCH_DURATION: String(DURATION) },
  });

  await umux.waitFor(session.id, { screenPattern: 'UMUX_BENCH_OK', timeout: 10_000 });

  // Warmup
  session.capture({ format: 'ansi' });

  const t0 = performance.now();
  for (let i = 0; i < ITER; i += 1) {
    session.capture({ format: 'ansi' });
  }
  const t1 = performance.now();
  const umuxMs = t1 - t0;
  umux.destroy();

  // tmux (external capture-pane)
  const sessName = `umuxbench-${process.pid}`;
  spawnSync('tmux', ['new-session', '-d', '-s', sessName, `python3 ${scriptPath}`], {
    env: { ...process.env, TERM: 'xterm-256color', UMUX_BENCH_DURATION: String(DURATION) },
    stdio: 'ignore',
  });
  // Give it a moment to render.
  spawnSync('sleep', ['0.2']);

  const t2 = performance.now();
  for (let i = 0; i < ITER; i += 1) {
    spawnSync('tmux', ['capture-pane', '-p', '-t', sessName], { stdio: 'ignore' });
  }
  const t3 = performance.now();
  const tmuxMs = t3 - t2;
  spawnSync('tmux', ['kill-session', '-t', sessName], { stdio: 'ignore' });

  console.log(JSON.stringify({
    iter: ITER,
    duration_s: DURATION,
    umux_engine: { total_ms: Math.round(umuxMs), ms_per_op: msPerOp(umuxMs) },
    tmux: { total_ms: Math.round(tmuxMs), ms_per_op: msPerOp(tmuxMs) },
  }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

