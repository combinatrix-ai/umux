import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events.js';

interface TestEvents {
  foo: { value: number };
  bar: { message: string };
}

describe('EventEmitter', () => {
  it('emits events to handlers', () => {
    const emitter = new (class extends EventEmitter<TestEvents> {
      fire<K extends keyof TestEvents>(event: K, data: TestEvents[K]) {
        this.emit(event, data);
      }
    })();

    const handler = vi.fn();
    emitter.on('foo', handler);
    emitter.fire('foo', { value: 42 });

    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it('supports multiple handlers', () => {
    const emitter = new (class extends EventEmitter<TestEvents> {
      fire<K extends keyof TestEvents>(event: K, data: TestEvents[K]) {
        this.emit(event, data);
      }
    })();

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('foo', handler1);
    emitter.on('foo', handler2);
    emitter.fire('foo', { value: 1 });

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('removes handlers with off()', () => {
    const emitter = new (class extends EventEmitter<TestEvents> {
      fire<K extends keyof TestEvents>(event: K, data: TestEvents[K]) {
        this.emit(event, data);
      }
    })();

    const handler = vi.fn();
    emitter.on('foo', handler);
    emitter.off('foo', handler);
    emitter.fire('foo', { value: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('once() fires only once', () => {
    const emitter = new (class extends EventEmitter<TestEvents> {
      fire<K extends keyof TestEvents>(event: K, data: TestEvents[K]) {
        this.emit(event, data);
      }
    })();

    const handler = vi.fn();
    emitter.once('foo', handler);
    emitter.fire('foo', { value: 1 });
    emitter.fire('foo', { value: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('removeAllListeners() clears all handlers', () => {
    const emitter = new (class extends EventEmitter<TestEvents> {
      fire<K extends keyof TestEvents>(event: K, data: TestEvents[K]) {
        this.emit(event, data);
      }
    })();

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('foo', handler1);
    emitter.on('bar', handler2);
    emitter.removeAllListeners();

    emitter.fire('foo', { value: 1 });
    emitter.fire('bar', { message: 'hello' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('removeAllListeners(event) clears handlers for specific event', () => {
    const emitter = new (class extends EventEmitter<TestEvents> {
      fire<K extends keyof TestEvents>(event: K, data: TestEvents[K]) {
        this.emit(event, data);
      }
    })();

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('foo', handler1);
    emitter.on('bar', handler2);
    emitter.removeAllListeners('foo');

    emitter.fire('foo', { value: 1 });
    emitter.fire('bar', { message: 'hello' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });
});
