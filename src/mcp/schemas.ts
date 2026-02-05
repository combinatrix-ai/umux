/**
 * Zod schemas for MCP tool parameters
 */

import { z } from 'zod';

// ============================================================================
// Session Management
// ============================================================================

export const SpawnSchema = z.object({
  command: z.string().optional().describe('Command to execute (default: user shell)'),
  name: z.string().optional().describe('Session name for identification'),
  cwd: z.string().optional().describe('Working directory'),
  cols: z.number().optional().default(80).describe('Terminal columns'),
  rows: z.number().optional().default(24).describe('Terminal rows'),
});

export const SessionRefSchema = z.object({
  session: z.string().describe('Session ID or name'),
});

// ============================================================================
// Input
// ============================================================================

export const SendSchema = z.object({
  session: z.string().describe('Session ID or name'),
  text: z.string().describe('Text to send'),
  newline: z.boolean().optional().default(false).describe('Append newline (Enter key)'),
});

export const SendKeySchema = z.object({
  session: z.string().describe('Session ID or name'),
  key: z
    .string()
    .describe(
      'Key name: Enter, Tab, Escape, Backspace, Delete, Space, Up, Down, Left, Right, Home, End, PageUp, PageDown, Insert, F1-F12'
    ),
  ctrl: z.boolean().optional().describe('Hold Ctrl'),
  alt: z.boolean().optional().describe('Hold Alt'),
  shift: z.boolean().optional().describe('Hold Shift'),
});

// ============================================================================
// Wait Conditions
// ============================================================================

export const WaitSchema = z.object({
  session: z.string().describe('Session ID or name'),
  pattern: z.string().optional().describe('Wait for output matching regex pattern'),
  screenPattern: z.string().optional().describe('Wait for screen buffer matching regex pattern'),
  ready: z.boolean().optional().describe('Wait for shell to be ready (no foreground process)'),
  idle: z.number().optional().describe('Wait for N milliseconds of no output'),
  exit: z.boolean().optional().describe('Wait for process to exit'),
  not: z.string().optional().describe('Fail if this pattern matches (rejection)'),
  timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
});

// ============================================================================
// Capture
// ============================================================================

export const CaptureSchema = z.object({
  session: z.string().describe('Session ID or name'),
  format: z.enum(['text', 'ansi']).optional().default('text').describe('Output format'),
});

// ============================================================================
// History
// ============================================================================

export const HistorySchema = z.object({
  session: z.string().describe('Session ID or name'),
  tail: z.number().optional().describe('Get last N lines'),
  head: z.number().optional().describe('Get first N lines'),
  start: z.number().optional().describe('Start line (0-indexed) for slice'),
  end: z.number().optional().describe('End line (exclusive) for slice'),
  search: z.string().optional().describe('Search pattern (regex)'),
  format: z
    .enum(['text', 'color', 'raw'])
    .optional()
    .default('text')
    .describe('Output format (text strips control sequences; color keeps SGR colors only)'),
});

// ============================================================================
// Process Control
// ============================================================================

export const KillSchema = z.object({
  session: z.string().describe('Session ID or name'),
  signal: z
    .enum(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGQUIT'])
    .optional()
    .default('SIGTERM')
    .describe('Signal to send'),
});

// ============================================================================
// Type exports
// ============================================================================

export type SpawnParams = z.infer<typeof SpawnSchema>;
export type SessionRefParams = z.infer<typeof SessionRefSchema>;
export type SendParams = z.infer<typeof SendSchema>;
export type SendKeyParams = z.infer<typeof SendKeySchema>;
export type WaitParams = z.infer<typeof WaitSchema>;
export type CaptureParams = z.infer<typeof CaptureSchema>;
export type HistoryParams = z.infer<typeof HistorySchema>;
export type KillParams = z.infer<typeof KillSchema>;
