/**
 * HTTP client for umux server
 */

import http from 'node:http';
import type {
  CreateHookRequest,
  KillRequest,
  SendKeyRequest,
  SendKeysRequest,
  SendRequest,
  SpawnSessionRequest,
  WaitRequest,
} from '../server/types.js';

export interface Hook {
  id: string;
  sessionId: string;
  run: string;
  onMatch?: string;
  onReady?: boolean;
  onExit?: boolean;
  once?: boolean;
}

export interface ClientConfig {
  socketPath?: string;
  host?: string;
  port?: number;
  token?: string;
}

export interface ForegroundProcess {
  pid: number;
  command: string;
}

export interface Session {
  id: string;
  name: string;
  pid: number;
  cwd?: string;
  isAlive: boolean;
  exitCode?: number | null;
  foregroundProcess?: ForegroundProcess | null;
  historyLineCount?: number;
  lastOutputAt?: string | null;
  createdAt: string;
}

export interface WaitResult {
  reason: 'pattern' | 'screen' | 'ready' | 'rejected' | 'idle' | 'exit' | 'timeout';
  output: string;
  match?: unknown;
  exitCode?: number;
  waitedMs: number;
}

export interface HistoryResult {
  lines: string[];
  totalLines: number;
}

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  totalLines: number;
}

export interface CaptureResult {
  content: string;
  format: 'text' | 'ansi';
  cols: number;
  rows: number;
}

/**
 * Create an HTTP client for umux server
 */
export function createClient(config: ClientConfig) {
  const socketPath = config.socketPath;
  const host = config.host ?? 'localhost';
  const port = config.port ?? 7070;
  const token = config.token;

  if (!socketPath && !host) {
    throw new Error('ClientConfig must include either socketPath or host.');
  }

  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    defaultHeaders.Authorization = `Bearer ${token}`;
  }

  function formatRequestError(err: unknown): Error {
    const anyErr = err as { code?: string; message?: string };
    const code = anyErr?.code;
    const message = anyErr?.message ?? String(err);

    // Common TCP cases
    if (
      !socketPath &&
      (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
    ) {
      return new Error(
        `${message}\n` +
          `Hint: cannot reach server at ${host}:${port}. Check \`--tcp --host --port\` (or UMUX_HOST/UMUX_PORT).`
      );
    }

    return err instanceof Error ? err : new Error(message);
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        ...(socketPath ? { socketPath } : { host, port }),
        path,
        method,
        headers: defaultHeaders,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 204) {
            resolve(undefined as T);
            return;
          }

          const statusCode = res.statusCode ?? 0;
          const isError = statusCode >= 400;

          try {
            const json = JSON.parse(data);
            if (isError) {
              let message: string = json.error?.message ?? `HTTP ${statusCode}`;
              if (statusCode === 401) {
                message += ' (set --token or UMUX_TOKEN)';
              }
              if (statusCode === 404 && json.error?.code === 'SESSION_NOT_FOUND') {
                message += ' (run `umux ls` to list sessions)';
              }
              reject(new Error(message));
            } else {
              resolve(json);
            }
          } catch (_e) {
            if (isError) {
              reject(new Error(data || `HTTP ${statusCode}`));
            } else {
              reject(new Error(`Failed to parse response: ${data}`));
            }
          }
        });
      });

      req.on('error', (e) => reject(formatRequestError(e)));

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  return {
    // Sessions
    async listSessions(): Promise<Session[]> {
      const result = await request<{ sessions: Session[] }>('GET', '/sessions');
      return result.sessions;
    },

    async spawn(command: string, options?: Omit<SpawnSessionRequest, 'command'>): Promise<Session> {
      return request<Session>('POST', '/sessions', { command, ...options } as SpawnSessionRequest);
    },

    async getSession(id: string): Promise<Session> {
      return request<Session>('GET', `/sessions/${id}`);
    },

    async deleteSession(id: string): Promise<void> {
      await request<void>('DELETE', `/sessions/${id}`);
    },

    async send(sessionId: string, data: string): Promise<void> {
      await request<void>('POST', `/sessions/${sessionId}/send`, { data } as SendRequest);
    },

    async sendKey(sessionId: string, key: SendKeyRequest): Promise<void> {
      await request<void>('POST', `/sessions/${sessionId}/send-key`, key);
    },

    async sendKeys(sessionId: string, keys: SendKeysRequest['keys']): Promise<void> {
      await request<void>('POST', `/sessions/${sessionId}/send-keys`, { keys } as SendKeysRequest);
    },

    async kill(sessionId: string, signal?: string): Promise<void> {
      await request<void>('POST', `/sessions/${sessionId}/kill`, { signal } as KillRequest);
    },

    async resize(sessionId: string, cols: number, rows: number): Promise<void> {
      await request<void>('POST', `/sessions/${sessionId}/resize`, { cols, rows });
    },

    async wait(sessionId: string, condition: WaitRequest['condition']): Promise<WaitResult> {
      return request<WaitResult>('POST', `/sessions/${sessionId}/wait`, {
        condition,
      } as WaitRequest);
    },

    async getHistory(
      sessionId: string,
      options?: {
        tail?: number;
        head?: number;
        start?: number;
        end?: number;
        stream?: 'output' | 'input';
        format?: 'text' | 'color' | 'raw';
      }
    ): Promise<HistoryResult> {
      const params = new URLSearchParams();
      if (options?.tail) params.set('tail', String(options.tail));
      if (options?.head) params.set('head', String(options.head));
      if (options?.start) params.set('start', String(options.start));
      if (options?.end) params.set('end', String(options.end));
      if (options?.stream) params.set('stream', options.stream);
      if (options?.format) params.set('format', options.format);

      const query = params.toString();
      const path = `/sessions/${sessionId}/history${query ? `?${query}` : ''}`;
      return request<HistoryResult>('GET', path);
    },

    async searchHistory(
      sessionId: string,
      pattern: string,
      options?: { stream?: 'output' | 'input' }
    ): Promise<SearchResult> {
      const params = new URLSearchParams({ search: pattern });
      if (options?.stream) params.set('stream', options.stream);
      return request<SearchResult>('GET', `/sessions/${sessionId}/history?${params}`);
    },

    async capture(
      sessionId: string,
      options?: { format?: 'text' | 'ansi' }
    ): Promise<CaptureResult> {
      const params = new URLSearchParams();
      if (options?.format) params.set('format', options.format);
      const query = params.toString();
      const path = `/sessions/${sessionId}/capture${query ? `?${query}` : ''}`;
      return request<CaptureResult>('GET', path);
    },

    // Hooks
    async listHooks(): Promise<Hook[]> {
      const result = await request<{ hooks: Hook[] }>('GET', '/hooks');
      return result.hooks;
    },

    async addHook(hook: CreateHookRequest): Promise<{ id: string }> {
      return request<{ id: string }>('POST', '/hooks', hook);
    },

    async removeHook(id: string): Promise<void> {
      await request<void>('DELETE', `/hooks/${id}`);
    },
  };
}

export type UmuxClient = ReturnType<typeof createClient>;
