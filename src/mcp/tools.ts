/**
 * MCP tool definitions and handlers
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Session, Umux } from '../core/index.js';
import * as keys from '../core/keys.js';
import { formatTerminalOutput } from '../core/terminal/sanitize.js';
import {
  type CaptureParams,
  CaptureSchema,
  type HistoryParams,
  HistorySchema,
  type KillParams,
  KillSchema,
  type SendKeyParams,
  SendKeySchema,
  type SendParams,
  SendSchema,
  type SessionRefParams,
  SessionRefSchema,
  type SpawnParams,
  SpawnSchema,
  type WaitParams,
  WaitSchema,
} from './schemas.js';

/**
 * Resolve session ID from name or ID
 */
function resolveSession(umux: Umux, ref: string): Session {
  // First try by ID
  const byId = umux.getSession(ref);
  if (byId) return byId;

  // Then try by name
  const sessions = umux.listSessions();
  const byName = sessions.find((s) => s.name === ref);
  if (byName) return byName;

  throw new Error(`Session not found: ${ref}`);
}

/**
 * Parse special key name to KeyInput
 */
function parseKey(keyName: string): keys.KeyInput {
  const keyMap: Record<string, keys.SpecialKey> = {
    enter: keys.Key.Enter,
    tab: keys.Key.Tab,
    escape: keys.Key.Escape,
    backspace: keys.Key.Backspace,
    delete: keys.Key.Delete,
    space: keys.Key.Space,
    up: keys.Key.Up,
    down: keys.Key.Down,
    left: keys.Key.Left,
    right: keys.Key.Right,
    home: keys.Key.Home,
    end: keys.Key.End,
    pageup: keys.Key.PageUp,
    pagedown: keys.Key.PageDown,
    insert: keys.Key.Insert,
    f1: keys.Key.F1,
    f2: keys.Key.F2,
    f3: keys.Key.F3,
    f4: keys.Key.F4,
    f5: keys.Key.F5,
    f6: keys.Key.F6,
    f7: keys.Key.F7,
    f8: keys.Key.F8,
    f9: keys.Key.F9,
    f10: keys.Key.F10,
    f11: keys.Key.F11,
    f12: keys.Key.F12,
  };

  const lowerKey = keyName.toLowerCase();
  if (lowerKey in keyMap) {
    return keyMap[lowerKey];
  }

  // Single character
  if (keyName.length === 1) {
    return keyName;
  }

  throw new Error(
    `Unknown key: ${keyName}. Valid keys: ${Object.keys(keyMap).join(', ')}, or single character`
  );
}

/**
 * Register all umux tools with the MCP server
 */
export function registerTools(server: McpServer, umux: Umux): void {
  // ============================================================================
  // umux_spawn - Create a new terminal session
  // ============================================================================
  server.tool(
    'umux_spawn',
    'Create a new terminal session. Returns the session ID.',
    SpawnSchema.shape,
    async (params: SpawnParams) => {
      const session = await umux.spawn(params.command ?? '', {
        name: params.name,
        cwd: params.cwd,
        cols: params.cols,
        rows: params.rows,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: session.id,
              name: session.name,
              pid: session.pid,
              cwd: session.cwd,
            }),
          },
        ],
      };
    }
  );

  // ============================================================================
  // umux_send - Send text to a session
  // ============================================================================
  server.tool(
    'umux_send',
    'Send text to a terminal session. Use newline=true to press Enter after.',
    SendSchema.shape,
    async (params: SendParams) => {
      const session = resolveSession(umux, params.session);
      let text = params.text;
      if (params.newline) {
        text += '\n';
      }
      umux.send(session.id, text);

      return {
        content: [
          { type: 'text' as const, text: `Sent ${text.length} characters to ${session.name}` },
        ],
      };
    }
  );

  // ============================================================================
  // umux_send_key - Send a special key
  // ============================================================================
  server.tool(
    'umux_send_key',
    'Send a special key (Enter, Ctrl-C, etc.) to a session.',
    SendKeySchema.shape,
    async (params: SendKeyParams) => {
      const session = resolveSession(umux, params.session);
      const baseKey = parseKey(params.key);

      const keyInput: keys.KeyInput =
        params.ctrl || params.alt || params.shift
          ? {
              key: baseKey as keys.SpecialKey | string,
              ctrl: params.ctrl,
              alt: params.alt,
              shift: params.shift,
            }
          : baseKey;

      umux.sendKey(session.id, keyInput);

      const modifiers = [params.ctrl && 'Ctrl', params.alt && 'Alt', params.shift && 'Shift']
        .filter(Boolean)
        .join('+');

      const keyDesc = modifiers ? `${modifiers}+${params.key}` : params.key;
      return {
        content: [{ type: 'text' as const, text: `Sent ${keyDesc} to ${session.name}` }],
      };
    }
  );

  // ============================================================================
  // umux_wait - Wait for a condition
  // ============================================================================
  server.tool(
    'umux_wait',
    'Wait for a condition: output pattern, shell ready, idle timeout, or process exit.',
    WaitSchema.shape,
    async (params: WaitParams) => {
      const session = resolveSession(umux, params.session);

      const result = await umux.waitFor(session.id, {
        pattern: params.pattern ? new RegExp(params.pattern) : undefined,
        screenPattern: params.screenPattern ? new RegExp(params.screenPattern) : undefined,
        ready: params.ready,
        idle: params.idle,
        exit: params.exit,
        not: params.not ? new RegExp(params.not) : undefined,
        timeout: params.timeout,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              reason: result.reason,
              match: result.match?.[0],
              exitCode: result.exitCode,
              waitedMs: result.waitedMs,
              output: result.output.slice(-2000), // Limit output size
            }),
          },
        ],
      };
    }
  );

  // ============================================================================
  // umux_capture - Capture screen contents
  // ============================================================================
  server.tool(
    'umux_capture',
    'Capture the current screen buffer of a terminal session.',
    CaptureSchema.shape,
    async (params: CaptureParams) => {
      const session = resolveSession(umux, params.session);
      const result = umux.capture(session.id, { format: params.format });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              cols: result.cols,
              rows: result.rows,
              format: result.format,
              content: result.content,
            }),
          },
        ],
      };
    }
  );

  // ============================================================================
  // umux_history - Get session history
  // ============================================================================
  server.tool(
    'umux_history',
    'Get output history from a session: tail, head, slice, or search.',
    HistorySchema.shape,
    async (params: HistoryParams) => {
      const session = resolveSession(umux, params.session);
      const history = session.history;
      const format = params.format === 'raw' || params.format === 'color' ? params.format : 'text';

      let content: string;
      let mode: string;

      if (params.search) {
        const matches = history.search(new RegExp(params.search, 'g'));
        const limited = matches.slice(0, 100).map((m) => {
          if (format === 'raw') return m;
          return {
            ...m,
            text: formatTerminalOutput(m.text, format),
            context: m.context
              ? {
                  before: formatTerminalOutput(m.context.before, format),
                  after: formatTerminalOutput(m.context.after, format),
                }
              : undefined,
          };
        });
        content = JSON.stringify(limited); // Limit results
        mode = 'search';
      } else if (params.tail !== undefined) {
        content = history.tail(params.tail);
        mode = `tail(${params.tail})`;
      } else if (params.head !== undefined) {
        content = history.head(params.head);
        mode = `head(${params.head})`;
      } else if (params.start !== undefined) {
        content = history.slice(params.start, params.end);
        mode = `slice(${params.start}, ${params.end ?? 'end'})`;
      } else {
        content = history.tail(50); // Default: last 50 lines
        mode = 'tail(50)';
      }

      if (mode !== 'search' && format !== 'raw') {
        content = formatTerminalOutput(content, format);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              mode,
              lineCount: history.lineCount(),
              lastOutputAt: history.lastOutputAt?.toISOString(),
              content,
            }),
          },
        ],
      };
    }
  );

  // ============================================================================
  // umux_list - List all sessions
  // ============================================================================
  server.tool('umux_list', 'List all terminal sessions.', {}, async () => {
    const sessions = umux.listSessions();

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            sessions.map((s) => ({
              id: s.id,
              name: s.name,
              pid: s.pid,
              cwd: s.cwd,
              isAlive: s.isAlive,
              exitCode: s.exitCode,
              foregroundProcess: s.foregroundProcess,
              createdAt: s.createdAt.toISOString(),
            }))
          ),
        },
      ],
    };
  });

  // ============================================================================
  // umux_kill - Send signal to process
  // ============================================================================
  server.tool(
    'umux_kill',
    'Send a signal to the session process (default: SIGTERM).',
    KillSchema.shape,
    async (params: KillParams) => {
      const session = resolveSession(umux, params.session);
      umux.kill(session.id, params.signal as NodeJS.Signals);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Sent ${params.signal} to ${session.name} (pid: ${session.pid})`,
          },
        ],
      };
    }
  );

  // ============================================================================
  // umux_destroy - Destroy a session
  // ============================================================================
  server.tool(
    'umux_destroy',
    'Kill and remove a terminal session completely.',
    SessionRefSchema.shape,
    async (params: SessionRefParams) => {
      const session = resolveSession(umux, params.session);
      const sessionName = session.name;
      const sessionId = session.id;
      umux.destroySession(sessionId);

      return {
        content: [
          { type: 'text' as const, text: `Destroyed session: ${sessionName} (${sessionId})` },
        ],
      };
    }
  );
}
