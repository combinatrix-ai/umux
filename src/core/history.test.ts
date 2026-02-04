import { describe, expect, it } from 'vitest';
import { History } from './history.js';

describe('History', () => {
  it('appends and retrieves data', () => {
    const h = new History();
    h.append('line1\n');
    h.append('line2\n');
    expect(h.getAll()).toBe('line1\nline2');
  });

  it('handles partial lines', () => {
    const h = new History();
    h.append('hello ');
    h.append('world\n');
    h.append('foo');
    expect(h.getAll()).toBe('hello world\nfoo');
  });

  it('returns tail lines', () => {
    const h = new History();
    h.append('line1\nline2\nline3\nline4\nline5\n');
    expect(h.tail(2)).toBe('line4\nline5');
  });

  it('returns head lines', () => {
    const h = new History();
    h.append('line1\nline2\nline3\nline4\nline5\n');
    expect(h.head(2)).toBe('line1\nline2');
  });

  it('returns slice of lines', () => {
    const h = new History();
    h.append('line1\nline2\nline3\nline4\nline5\n');
    expect(h.slice(1, 3)).toBe('line2\nline3');
  });

  it('searches for patterns', () => {
    const h = new History();
    h.append('foo bar\nbaz qux\nfoo baz\n');

    const matches = h.search(/foo/);
    expect(matches).toHaveLength(2);
    expect(matches[0].line).toBe(0);
    expect(matches[1].line).toBe(2);
  });

  it('reports line count', () => {
    const h = new History();
    h.append('line1\nline2\nline3\n');
    expect(h.lineCount()).toBe(3);

    h.append('partial');
    expect(h.lineCount()).toBe(4);
  });

  it('enforces history limit', () => {
    const h = new History(3);
    h.append('1\n2\n3\n4\n5\n');
    expect(h.lineCount()).toBe(3);
    expect(h.getAll()).toBe('3\n4\n5');
  });
});
