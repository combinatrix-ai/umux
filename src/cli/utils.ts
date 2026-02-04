/**
 * CLI utilities
 */

import type { WaitCondition } from '../core/index.js';

export interface BlockUntilCondition extends WaitCondition {
  // Extends WaitCondition
}

/**
 * Parse --block-until condition string
 *
 * Examples:
 *   "exit"
 *   "idle:5000"
 *   "pattern:ready"
 *   "exit,timeout:30000"
 *   "pattern:done,idle:5000,not:Error:"
 */
export function parseBlockUntil(input: string): BlockUntilCondition {
  const condition: BlockUntilCondition = {};
  const parts = input.split(',');

  for (const part of parts) {
    const trimmed = part.trim();

    if (trimmed === 'exit') {
      condition.exit = true;
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid condition: ${trimmed}`);
    }

    const key = trimmed.slice(0, colonIndex);
    const value = trimmed.slice(colonIndex + 1);

    switch (key) {
      case 'idle':
        condition.idle = parseInt(value, 10);
        if (Number.isNaN(condition.idle)) {
          throw new Error(`Invalid idle value: ${value}`);
        }
        break;

      case 'timeout':
        condition.timeout = parseInt(value, 10);
        if (Number.isNaN(condition.timeout)) {
          throw new Error(`Invalid timeout value: ${value}`);
        }
        break;

      case 'pattern':
        condition.pattern = new RegExp(value);
        break;

      case 'not':
        condition.not = new RegExp(value);
        break;

      default:
        throw new Error(`Unknown condition: ${key}`);
    }
  }

  return condition;
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format timestamp for display
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString();
}
