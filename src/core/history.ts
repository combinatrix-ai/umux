/**
 * Session history management
 */

import type { SearchMatch, SessionHistory } from './types.js';

export class History implements SessionHistory {
  private lines: string[] = [];
  private currentLine = '';
  private readonly limit: number;
  private readonly trackLastOutputAt: boolean;
  private _lastOutputAt: Date | null = null;

  constructor(limit = 10000, trackLastOutputAt = true) {
    this.limit = limit;
    this.trackLastOutputAt = trackLastOutputAt;
  }

  get lastOutputAt(): Date | null {
    return this._lastOutputAt;
  }

  /**
   * Append data to history
   */
  append(data: string): void {
    if (this.trackLastOutputAt) {
      this._lastOutputAt = new Date();
    }

    // Split by newlines, handling partial lines
    const parts = (this.currentLine + data).split('\n');

    // Last part is the incomplete line
    this.currentLine = parts.pop() ?? '';

    // Add complete lines
    for (const line of parts) {
      this.lines.push(line);

      // Enforce limit
      if (this.lines.length > this.limit) {
        this.lines.shift();
      }
    }
  }

  /**
   * Get all output as a single string
   */
  getAll(): string {
    const all = [...this.lines];
    if (this.currentLine) {
      all.push(this.currentLine);
    }
    return all.join('\n');
  }

  /**
   * Get last N lines (default: 10)
   */
  tail(n = 10): string {
    const all = [...this.lines];
    if (this.currentLine) {
      all.push(this.currentLine);
    }
    return all.slice(-n).join('\n');
  }

  /**
   * Get first N lines (default: 10)
   */
  head(n = 10): string {
    return this.lines.slice(0, n).join('\n');
  }

  /**
   * Get lines from start to end (0-indexed)
   */
  slice(start: number, end?: number): string {
    return this.lines.slice(start, end).join('\n');
  }

  /**
   * Search for pattern in history
   */
  search(pattern: RegExp | string): SearchMatch[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;
    const matches: SearchMatch[] = [];

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      let match: RegExpExecArray | null;

      // Reset regex state for global patterns
      if (regex.global) {
        regex.lastIndex = 0;
      }

      while ((match = regex.exec(line)) !== null) {
        matches.push({
          line: i,
          column: match.index,
          text: match[0],
          context: {
            before: i > 0 ? this.lines[i - 1] : '',
            after: i < this.lines.length - 1 ? this.lines[i + 1] : '',
          },
        });

        // Avoid infinite loop for non-global regex
        if (!regex.global) break;
      }
    }

    return matches;
  }

  /**
   * Total line count
   */
  lineCount(): number {
    return this.lines.length + (this.currentLine ? 1 : 0);
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.lines = [];
    this.currentLine = '';
  }

  /**
   * Get raw lines array (for internal use)
   */
  getRawLines(): readonly string[] {
    return this.lines;
  }
}
