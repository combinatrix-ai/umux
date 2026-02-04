import { describe, expect, it } from 'vitest';
import { createGhosttyTerminalEngine, createGhosttyWasmTerminalEngine } from './ghostty-engine.js';

describe('Ghostty Terminal Engine', () => {
  it('captures plain text from VT stream (resilient)', () => {
    const engine = createGhosttyTerminalEngine({ cols: 40, rows: 10 });
    engine.write('hello\r\nworld');
    const cap = engine.capture({ format: 'text' });
    expect(cap.content).toContain('hello');
    expect(cap.content).toContain('world');
    engine.dispose();
  });

  it('captures VT snapshot (wasm)', () => {
    const engine = createGhosttyWasmTerminalEngine({ cols: 40, rows: 10 });
    engine.write('\u001b[31mred\u001b[0m\r\n');
    const cap = engine.capture({ format: 'ansi' });
    expect(cap.format).toBe('ansi');
    expect(cap.content).toContain('red');
    engine.dispose();
  });
});

