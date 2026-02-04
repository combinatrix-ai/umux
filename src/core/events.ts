/**
 * Type-safe event emitter
 */

type EventHandler<T> = (event: T) => void;

export class EventEmitter<EventMap extends Record<string, unknown>> {
  private handlers = new Map<keyof EventMap, Set<EventHandler<unknown>>>();

  /**
   * Register an event handler
   */
  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<unknown>);
    return this;
  }

  /**
   * Register a one-time event handler
   */
  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this {
    const wrapper: EventHandler<EventMap[K]> = (e) => {
      this.off(event, wrapper);
      handler(e);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove an event handler
   */
  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler as EventHandler<unknown>);
    }
    return this;
  }

  /**
   * Emit an event
   */
  protected emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in event handler for ${String(event)}:`, err);
        }
      }
    }
  }

  /**
   * Remove all handlers for an event (or all events if no event specified)
   */
  removeAllListeners(event?: keyof EventMap): this {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
    return this;
  }
}
