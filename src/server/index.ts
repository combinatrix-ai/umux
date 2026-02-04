/**
 * @umux/server - HTTP/WebSocket server for umux
 */

export { createApp } from './app.js';
export { startServer, type UmuxServer } from './server.js';
export type {
  CreateHookRequest,
  ErrorResponse,
  KillRequest,
  SendKeyRequest,
  SendKeysRequest,
  SendRequest,
  ServerConfig,
  SpawnSessionRequest,
  WaitRequest,
} from './types.js';
