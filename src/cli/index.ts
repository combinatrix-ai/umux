/**
 * @umux/cli - Command line interface for umux
 */

export { type ClientConfig, createClient, type UmuxClient } from './client.js';
export { createProgram } from './program.js';
export {
  ensureServer,
  ensureSocketDir,
  getDefaultSocketPath,
  getSocketDir,
  isServerRunning,
} from './socket.js';
export { type BlockUntilCondition, parseBlockUntil } from './utils.js';
