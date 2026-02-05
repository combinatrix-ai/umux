/**
 * Hono app for umux server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { nanoid } from 'nanoid';
import { HookManager } from '../core/hooks.js';
import type { WaitCondition } from '../core/index.js';
import { Key, type Umux } from '../core/index.js';
import { formatTerminalOutput } from '../core/terminal/sanitize.js';
import type {
  CreateHookRequest,
  KillRequest,
  ResizeRequest,
  SendKeyRequest,
  SendKeysRequest,
  SendRequest,
  ServerConfig,
  SpawnSessionRequest,
  WaitRequest,
} from './types.js';

export function createApp(umux: Umux, config: ServerConfig = {}) {
  const app = new Hono();
  const hooks = new HookManager(config.hooks);

  // CORS
  app.use('*', cors());

  // Auth middleware
  if (config.auth?.type === 'token' && config.auth.token) {
    const token = config.auth.token;
    app.use('*', async (c, next) => {
      const authHeader = c.req.header('Authorization');
      const queryToken = c.req.query('token');

      const providedToken = authHeader?.replace('Bearer ', '') ?? queryToken;

      if (providedToken !== token) {
        return c.json(
          { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } },
          401
        );
      }

      await next();
    });
  }

  // ===========================================================================
  // Sessions
  // ===========================================================================

  // Spawn a new session
  app.post('/sessions', async (c) => {
    const body = await c.req.json<SpawnSessionRequest>();

    const session = await umux.spawn(body.command ?? '', {
      name: body.name,
      cwd: body.cwd,
      env: body.env,
      cols: body.cols,
      rows: body.rows,
    });

    return c.json(
      {
        id: session.id,
        name: session.name,
        pid: session.pid,
        cwd: session.cwd,
        isAlive: session.isAlive,
        exitCode: session.exitCode,
        foregroundProcess: session.foregroundProcess,
        createdAt: session.createdAt.toISOString(),
      },
      201
    );
  });

  // List all sessions
  app.get('/sessions', (c) => {
    const sessions = umux.listSessions();

    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        pid: s.pid,
        isAlive: s.isAlive,
        foregroundProcess: s.foregroundProcess,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  });

  // Get session by ID
  app.get('/sessions/:id', (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    return c.json({
      id: session.id,
      name: session.name,
      pid: session.pid,
      cwd: session.cwd,
      isAlive: session.isAlive,
      exitCode: session.exitCode,
      foregroundProcess: session.foregroundProcess,
      historyLineCount: session.history.lineCount(),
      lastOutputAt: session.history.lastOutputAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
    });
  });

  // Delete session
  app.delete('/sessions/:id', (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    umux.destroySession(session.id);
    return new Response(null, { status: 204 });
  });

  // Send text to session
  app.post('/sessions/:id/send', async (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const body = await c.req.json<SendRequest>();
    umux.send(session.id, body.data);

    return new Response(null, { status: 204 });
  });

  // Send key to session
  app.post('/sessions/:id/send-key', async (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const body = await c.req.json<SendKeyRequest>();
    const key = parseKey(body);
    umux.sendKey(session.id, key);

    return new Response(null, { status: 204 });
  });

  // Send multiple keys to session
  app.post('/sessions/:id/send-keys', async (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const body = await c.req.json<SendKeysRequest>();
    const keys = body.keys.map((k) => {
      if (k.text) return k.text;
      return parseKey(k as SendKeyRequest);
    });
    umux.sendKeys(session.id, keys);

    return new Response(null, { status: 204 });
  });

  // Kill session process
  app.post('/sessions/:id/kill', async (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const body = (await c.req.json<KillRequest>().catch(() => ({}))) as KillRequest;
    umux.kill(session.id, (body.signal as NodeJS.Signals) ?? 'SIGTERM');

    return new Response(null, { status: 204 });
  });

  // Resize session terminal
  app.post('/sessions/:id/resize', async (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const body = await c.req.json<ResizeRequest>();
    session.resize(body.cols, body.rows);

    return new Response(null, { status: 204 });
  });

  // Get session history
  app.get('/sessions/:id/history', (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const stream = c.req.query('stream') ?? 'output';
    const formatQuery = c.req.query('format') ?? 'text';
    const format = formatQuery === 'raw' || formatQuery === 'color' ? formatQuery : 'text';
    const tail = c.req.query('tail');
    const head = c.req.query('head');
    const start = c.req.query('start');
    const end = c.req.query('end');
    const search = c.req.query('search');

    if (stream !== 'output' && stream !== 'input') {
      return c.json(
        { error: { code: 'INVALID_QUERY', message: 'Invalid stream. Use output|input.' } },
        400
      );
    }

    const history = stream === 'input' ? session.inputHistory : session.history;

    let content: string;

    if (search) {
      const matches = history.search(search);
      return c.json({
        matches,
        totalLines: history.lineCount(),
      });
    }

    if (tail) {
      content = history.tail(parseInt(tail, 10));
    } else if (head) {
      content = history.head(parseInt(head, 10));
    } else if (start) {
      const endNum = end ? parseInt(end, 10) : undefined;
      content = history.slice(parseInt(start, 10), endNum);
    } else {
      content = history.getAll();
    }

    const formatted = formatTerminalOutput(content, format);
    const lines = formatted.split('\n');

    return c.json({
      lines,
      totalLines: history.lineCount(),
    });
  });

  // Capture current screen buffer
  app.get('/sessions/:id/capture', (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const format = c.req.query('format');
    const capture = session.capture({
      format: format === 'ansi' ? 'ansi' : 'text',
    });

    return c.json(capture);
  });

  // Wait for condition on session
  app.post('/sessions/:id/wait', async (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const body = await c.req.json<WaitRequest>();
    const condition: WaitCondition = {};

    if (body.condition.pattern) condition.pattern = new RegExp(body.condition.pattern);
    if (body.condition.screenPattern)
      condition.screenPattern = new RegExp(body.condition.screenPattern);
    if (body.condition.idle) condition.idle = body.condition.idle;
    if (body.condition.exit) condition.exit = body.condition.exit;
    if (body.condition.ready) condition.ready = body.condition.ready;
    if (body.condition.timeout) condition.timeout = body.condition.timeout;
    if (body.condition.not) condition.not = new RegExp(body.condition.not);

    const result = await umux.waitFor(session.id, condition);

    if (result.reason === 'timeout') {
      return c.json(
        {
          error: { code: 'TIMEOUT', message: 'Wait condition timed out' },
          ...result,
        },
        408
      );
    }

    return c.json(result);
  });

  // SSE streaming
  app.get('/sessions/:id/stream', (c) => {
    const session = umux.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } }, 404);
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const onOutput = (e: { sessionId: string; data: string }) => {
          if (e.sessionId === session.id) {
            controller.enqueue(encoder.encode(`event: output\ndata: ${JSON.stringify(e)}\n\n`));
          }
        };

        const onExit = (e: { sessionId: string; exitCode: number }) => {
          if (e.sessionId === session.id) {
            controller.enqueue(encoder.encode(`event: exit\ndata: ${JSON.stringify(e)}\n\n`));
            controller.close();
          }
        };

        umux.on('output', onOutput);
        umux.on('exit', onExit);

        // Cleanup on close
        c.req.raw.signal.addEventListener('abort', () => {
          umux.off('output', onOutput);
          umux.off('exit', onExit);
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  // ===========================================================================
  // Hooks
  // ===========================================================================

  app.get('/hooks', (c) => {
    return c.json({ hooks: hooks.list() });
  });

  app.post('/hooks', async (c) => {
    const body = await c.req.json<CreateHookRequest>();
    const hookId = `hook-${nanoid(8)}`;
    try {
      hooks.add({
        id: hookId,
        ...body,
      });
    } catch (err) {
      return c.json({ error: { code: 'INVALID_HOOK', message: (err as Error).message } }, 400);
    }
    return c.json({ id: hookId }, 201);
  });

  app.delete('/hooks/:id', (c) => {
    const id = c.req.param('id');
    if (!hooks.remove(id)) {
      return c.json({ error: { code: 'HOOK_NOT_FOUND', message: 'Hook not found' } }, 404);
    }
    return new Response(null, { status: 204 });
  });

  // ===========================================================================
  // Wire up umux events to hooks
  // ===========================================================================

  umux.on('output', (e) => {
    hooks.fire('match', {
      sessionId: e.sessionId,
      data: e.data,
    });
  });

  umux.on('exit', (e) => {
    hooks.fire('exit', {
      sessionId: e.sessionId,
    });
  });

  umux.on('ready', (e) => {
    hooks.fire('ready', {
      sessionId: e.sessionId,
    });
  });

  return app;
}

// ===========================================================================
// Key parsing
// ===========================================================================

const KEY_MAP: Record<string, symbol> = {
  Enter: Key.Enter,
  Tab: Key.Tab,
  Escape: Key.Escape,
  Backspace: Key.Backspace,
  Delete: Key.Delete,
  Space: Key.Space,
  Up: Key.Up,
  Down: Key.Down,
  Left: Key.Left,
  Right: Key.Right,
  Home: Key.Home,
  End: Key.End,
  PageUp: Key.PageUp,
  PageDown: Key.PageDown,
  Insert: Key.Insert,
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,
};

function parseKey(
  req: SendKeyRequest
):
  | symbol
  | string
  | { key: symbol | string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } {
  const { key, ctrl: isCtrl, alt: isAlt, shift: isShift, meta: isMeta } = req;

  // Check if it's a special key
  const specialKey = KEY_MAP[key];
  const baseKey = specialKey ?? key;

  // Apply modifiers
  if (isCtrl || isAlt || isShift || isMeta) {
    return {
      key: baseKey,
      ctrl: isCtrl,
      alt: isAlt,
      shift: isShift,
      meta: isMeta,
    };
  }

  return baseKey;
}
