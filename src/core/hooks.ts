/**
 * Hook manager - executes local commands on events
 */

import { exec } from 'node:child_process';
import type { HookConfig, HookEvent } from './types.js';

export class HookManager {
  private hooks = new Map<string, HookConfig>();

  constructor(initial?: HookConfig[]) {
    if (initial) {
      for (const hook of initial) {
        this.add(hook);
      }
    }
  }

  add(config: HookConfig): void {
    if (config.onMatch) {
      try {
        new RegExp(config.onMatch);
      } catch (_err) {
        throw new Error(`Invalid onMatch regex: ${config.onMatch}`);
      }
    }
    this.hooks.set(config.id, config);
  }

  remove(id: string): boolean {
    return this.hooks.delete(id);
  }

  get(id: string): HookConfig | undefined {
    return this.hooks.get(id);
  }

  list(sessionId?: string): HookConfig[] {
    const hooks = Array.from(this.hooks.values());
    if (sessionId) {
      return hooks.filter((h) => h.sessionId === sessionId);
    }
    return hooks;
  }

  /**
   * Fire hooks for an event
   */
  async fire(
    event: HookEvent,
    payload: { sessionId: string; data?: string; match?: string }
  ): Promise<void> {
    for (const hook of this.hooks.values()) {
      if (hook.sessionId !== payload.sessionId) continue;

      let triggered = false;
      let matchedText = payload.match;

      if (event === 'match' && hook.onMatch) {
        const regex = new RegExp(hook.onMatch);
        // Use payload.data (raw output) to check for match if not already matched
        if (payload.data && !matchedText) {
          const m = regex.exec(payload.data);
          if (m) {
            triggered = true;
            matchedText = m[0];
          }
        } else if (matchedText) {
          // If match was already provided, just verify it matches this hook's pattern
          if (regex.test(matchedText)) {
            triggered = true;
          }
        }
      } else if (event === 'ready' && hook.onReady) {
        triggered = true;
      } else if (event === 'exit' && hook.onExit) {
        triggered = true;
      }

      if (triggered) {
        this.runCommand(hook, event, matchedText);
        if (hook.once) {
          this.remove(hook.id);
        }
      }
    }
  }

  private runCommand(hook: HookConfig, event: HookEvent, match?: string): void {
    const env = {
      ...process.env,
      UMUX_SESSION_ID: hook.sessionId,
      UMUX_EVENT: event,
      UMUX_MATCH: match || '',
      UMUX_HOOK_ID: hook.id,
    };

    exec(hook.run, { env }, (error, _stdout, stderr) => {
      if (error) {
        console.error(`Hook ${hook.id} command failed:`, error);
        if (stderr) console.error(stderr);
      }
    });
  }
}
