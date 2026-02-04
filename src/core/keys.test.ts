import { describe, expect, it } from 'vitest';
import { alt, ctrl, encodeKey, encodeKeys, Key, shift } from './keys.js';

describe('encodeKey', () => {
  it('encodes plain strings as-is', () => {
    expect(encodeKey('hello')).toBe('hello');
    expect(encodeKey('ls -la')).toBe('ls -la');
  });

  it('encodes special keys', () => {
    expect(encodeKey(Key.Enter)).toBe('\r');
    expect(encodeKey(Key.Tab)).toBe('\t');
    expect(encodeKey(Key.Escape)).toBe('\x1b');
    expect(encodeKey(Key.Backspace)).toBe('\x7f');
  });

  it('encodes arrow keys', () => {
    expect(encodeKey(Key.Up)).toBe('\x1b[A');
    expect(encodeKey(Key.Down)).toBe('\x1b[B');
    expect(encodeKey(Key.Left)).toBe('\x1b[D');
    expect(encodeKey(Key.Right)).toBe('\x1b[C');
  });

  it('encodes function keys', () => {
    expect(encodeKey(Key.F1)).toBe('\x1bOP');
    expect(encodeKey(Key.F5)).toBe('\x1b[15~');
    expect(encodeKey(Key.F12)).toBe('\x1b[24~');
  });

  it('encodes Ctrl+letter', () => {
    expect(encodeKey(ctrl('c'))).toBe('\x03'); // Ctrl+C
    expect(encodeKey(ctrl('d'))).toBe('\x04'); // Ctrl+D
    expect(encodeKey(ctrl('z'))).toBe('\x1a'); // Ctrl+Z
    expect(encodeKey(ctrl('a'))).toBe('\x01'); // Ctrl+A
  });

  it('encodes Alt+letter', () => {
    expect(encodeKey(alt('f'))).toBe('\x1bf');
    expect(encodeKey(alt('b'))).toBe('\x1bb');
  });

  it('encodes modified arrow keys', () => {
    expect(encodeKey(ctrl(Key.Up))).toBe('\x1b[1;5A');
    expect(encodeKey(shift(Key.Down))).toBe('\x1b[1;2B');
    expect(encodeKey({ key: Key.Left, ctrl: true, shift: true })).toBe('\x1b[1;6D');
  });

  it('encodes Shift-Tab (backtab)', () => {
    expect(encodeKey(shift(Key.Tab))).toBe('\x1b[Z');
    expect(encodeKey({ key: Key.Tab, ctrl: true, shift: true })).toBe('\x1b[1;6Z');
  });

  it('treats Ctrl-Shift-<letter> as Ctrl-<letter>', () => {
    expect(encodeKey({ key: 'c', ctrl: true, shift: true })).toBe('\x03');
    expect(encodeKey({ key: 'C', ctrl: true, shift: true })).toBe('\x03');
  });

  it('encodes Alt-Shift-<letter> as ESC + <letter>', () => {
    expect(encodeKey({ key: 'F', alt: true, shift: true })).toBe('\x1bF');
  });
});

describe('encodeKeys', () => {
  it('encodes multiple keys', () => {
    const result = encodeKeys([Key.Escape, ':wq', Key.Enter]);
    expect(result).toBe('\x1b:wq\r');
  });
});
