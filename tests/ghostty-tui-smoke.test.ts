import { describe, expect, test } from 'vitest';
import { Umux, createGhosttyWasmTerminalEngine } from '../src/core/index.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Ghostty VT: TUI smoke', () => {
  test('renders a curses screen and captures via ghostty engine', async () => {
    const umux = new Umux({ terminalEngine: createGhosttyWasmTerminalEngine });
    const dir = mkdtempSync(join(tmpdir(), 'umux-ghostty-tui-'));
    const scriptPath = join(dir, 'tui.py');
    writeFileSync(
      scriptPath,
      [
        'import curses, time',
        '',
        'def main(stdscr):',
        '    curses.curs_set(0)',
        '    stdscr.nodelay(True)',
        "    stdscr.addstr(0, 0, 'UMUX_GHOSTTY_OK')",
        "    stdscr.addstr(1, 0, 'Press q (auto-exit in ~2s)')",
        '    stdscr.refresh()',
        '    start = time.time()',
        '    while time.time() - start < 2.0:',
        '        ch = stdscr.getch()',
        "        if ch == ord('q'):",
        '            break',
        '        time.sleep(0.05)',
        '',
        'curses.wrapper(main)',
        '',
      ].join('\n'),
      'utf-8',
    );
    try {
      const session = await umux.spawn(`python3 ${scriptPath}`, {
        cols: 80,
        rows: 43,
        env: {
          TERM: 'xterm-256color',
          LC_ALL: 'C.UTF-8',
        },
      });

      await umux.waitFor(session.id, { screenPattern: 'UMUX_GHOSTTY_OK', timeout: 5000 });
      const snap = session.capture({ format: 'ansi' }).content;

      expect(snap).toContain('UMUX_GHOSTTY_OK');
      // Ghostty VT snapshot uses VT output; ensure some escape sequences exist.
      expect(snap).toContain('\u001b[');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      umux.destroy();
    }
  }, 30_000);

  test('can send keys to a curses TUI and observe screen changes', async () => {
    const umux = new Umux({ terminalEngine: createGhosttyWasmTerminalEngine });
    const dir = mkdtempSync(join(tmpdir(), 'umux-ghostty-tui-keys-'));
    const scriptPath = join(dir, 'tui_keys.py');
    writeFileSync(
      scriptPath,
      [
        'import curses, time',
        '',
        'def main(stdscr):',
        '    curses.curs_set(0)',
        '    stdscr.nodelay(True)',
        "    state = 'A'",
        '    start = time.time()',
        '    while time.time() - start < 5.0:',
        '        stdscr.erase()',
        "        stdscr.addstr(0, 0, 'UMUX_GHOSTTY_KEYS')",
        "        stdscr.addstr(1, 0, f'STATE:{state}')",
        "        stdscr.addstr(2, 0, 'Press t to toggle, q to quit')",
        '        stdscr.refresh()',
        '        ch = stdscr.getch()',
        "        if ch == ord('t'):",
        "            state = 'B' if state == 'A' else 'A'",
        "        elif ch == ord('q'):",
        '            return',
        '        time.sleep(0.05)',
        '',
        'curses.wrapper(main)',
        '',
      ].join('\n'),
      'utf-8',
    );
    try {
      const session = await umux.spawn(`python3 ${scriptPath}`, {
        cols: 80,
        rows: 24,
        env: {
          TERM: 'xterm-256color',
          LC_ALL: 'C.UTF-8',
        },
      });

      await umux.waitFor(session.id, { screenPattern: 'STATE:A', timeout: 5000 });
      umux.send(session.id, 't');
      await umux.waitFor(session.id, { screenPattern: 'STATE:B', timeout: 5000 });

      const snap = session.capture({ format: 'ansi' }).content;
      expect(snap).toContain('UMUX_GHOSTTY_KEYS');
      expect(snap).toContain('STATE:B');

      umux.send(session.id, 'q');
      await umux.waitFor(session.id, { exit: true, timeout: 5000 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      umux.destroy();
    }
  }, 30_000);
});
