import { describe, expect, it } from 'vitest';
import { formatDuration, formatTime, parseBlockUntil } from './utils.js';

describe('parseBlockUntil', () => {
  it('parses "exit"', () => {
    const result = parseBlockUntil('exit');
    expect(result.exit).toBe(true);
  });

  it('parses "idle:5000"', () => {
    const result = parseBlockUntil('idle:5000');
    expect(result.idle).toBe(5000);
  });

  it('parses "timeout:30000"', () => {
    const result = parseBlockUntil('timeout:30000');
    expect(result.timeout).toBe(30000);
  });

  it('parses "pattern:ready"', () => {
    const result = parseBlockUntil('pattern:ready');
    expect(result.pattern).toEqual(/ready/);
  });

  it('parses "not:Error:"', () => {
    const result = parseBlockUntil('not:Error:');
    expect(result.not).toEqual(/Error:/);
  });

  it('parses combined conditions', () => {
    const result = parseBlockUntil('exit,idle:5000,timeout:30000');
    expect(result.exit).toBe(true);
    expect(result.idle).toBe(5000);
    expect(result.timeout).toBe(30000);
  });

  it('parses complex pattern', () => {
    const result = parseBlockUntil('pattern:done,not:Error:,timeout:60000');
    expect(result.pattern).toEqual(/done/);
    expect(result.not).toEqual(/Error:/);
    expect(result.timeout).toBe(60000);
  });

  it('throws on invalid condition', () => {
    expect(() => parseBlockUntil('invalid')).toThrow();
  });

  it('throws on invalid idle value', () => {
    expect(() => parseBlockUntil('idle:abc')).toThrow();
  });

  it('throws on unknown key', () => {
    expect(() => parseBlockUntil('foo:bar')).toThrow();
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5.0s');
  });

  it('formats minutes', () => {
    expect(formatDuration(120000)).toBe('2.0m');
  });
});

describe('formatTime', () => {
  it('formats date to locale time', () => {
    const date = new Date('2025-01-14T12:30:00');
    const result = formatTime(date);
    // Result depends on locale, just check it's a string
    expect(typeof result).toBe('string');
  });
});
