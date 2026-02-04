import { describe, expect, it } from 'vitest';
import { parseKeySpec } from './keyspec.js';

describe('parseKeySpec', () => {
  it('parses special keys', () => {
    expect(parseKeySpec('Enter')).toEqual({ key: 'Enter' });
    expect(parseKeySpec('esc')).toEqual({ key: 'Escape' });
    expect(parseKeySpec('PgUp')).toEqual({ key: 'PageUp' });
    expect(parseKeySpec('f12')).toEqual({ key: 'F12' });
  });

  it('parses modifiers (order-insensitive, -/+ separators)', () => {
    expect(parseKeySpec('Ctrl-C')).toEqual({ key: 'C', ctrl: true });
    expect(parseKeySpec('shift+tab')).toEqual({ key: 'Tab', shift: true });
    expect(parseKeySpec('Alt-Shift-f')).toEqual({ key: 'f', alt: true, shift: true });
    expect(parseKeySpec('Ctrl-Shift-Up')).toEqual({ key: 'Up', ctrl: true, shift: true });
    expect(parseKeySpec('Cmd-Left')).toEqual({ key: 'Left', meta: true });
  });

  it('throws on invalid or unknown specs', () => {
    expect(() => parseKeySpec('')).toThrow();
    expect(() => parseKeySpec('Ctrl-Shift')).toThrow();
    expect(() => parseKeySpec('Ctrl-Shift-Up-Down')).toThrow();
    expect(() => parseKeySpec('Hyper-A')).toThrow();
  });
});
