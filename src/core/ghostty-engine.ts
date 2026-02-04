import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { XtermTerminalEngine } from './terminal-engine.js';
import type { CaptureOptions, CaptureResult, TerminalEngine, TerminalEngineFactory } from './types.js';

const require = createRequire(import.meta.url);

type GhosttyWasmExports = {
  memory: WebAssembly.Memory;
  umux_vt_alloc_u8_array: (len: number) => number;
  umux_vt_free_u8_array: (ptr: number, len: number) => void;
  umux_vt_terminal_new: (cols: number, rows: number) => number;
  umux_vt_terminal_free: (handle: number) => void;
  umux_vt_terminal_resize: (handle: number, cols: number, rows: number) => void;
  umux_vt_terminal_feed: (handle: number, dataPtr: number, dataLen: number) => void;
  umux_vt_terminal_snapshot: (handle: number, format: number, outLenPtr: number) => number;
};

type GhosttyWasm = {
  exports: GhosttyWasmExports;
  view: () => DataView;
  u8: () => Uint8Array;
};

let cachedModule: WebAssembly.Module | null = null;
let cachedWasm: GhosttyWasm | null = null;

function installSuppressedWasiWarningOnce(): void {
  const suppress = (process.env.UMUX_SUPPRESS_WASI_WARNING ?? '1') !== '0';
  if (!suppress) return;

  const kInstalled = Symbol.for('umux.suppressWasiWarning.installed');
  const anyProcess = process as any;
  if (anyProcess[kInstalled]) return;
  anyProcess[kInstalled] = true;

  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...rest: any[]) => {
    try {
      const message =
        typeof warning === 'string'
          ? warning
          : warning && typeof warning === 'object' && 'message' in (warning as any)
            ? String((warning as any).message)
            : '';
      const type =
        warning && typeof warning === 'object' && 'name' in (warning as any)
          ? String((warning as any).name)
          : typeof rest[0] === 'string'
            ? rest[0]
            : rest[0] && typeof rest[0] === 'object' && 'type' in rest[0]
              ? String((rest[0] as any).type)
              : '';
      if (type === 'ExperimentalWarning' && message.includes('WASI')) {
        return;
      }
    } catch {
      // fall through
    }
    return originalEmitWarning(warning as any, ...rest);
  }) as typeof process.emitWarning;
}

function loadWasiCtor(): (new (opts: any) => any) | null {
  try {
    // Load lazily so non-ghostty users don't pay the cost (and don't see warnings).
    // Note: Node prints an ExperimentalWarning for WASI on some versions.
    installSuppressedWasiWarningOnce();
    return (require('node:wasi') as { WASI: new (opts: any) => any }).WASI;
  } catch {
    return null;
  }
}

function loadWasmModule(): WebAssembly.Module {
  if (cachedModule) return cachedModule;
  const envPath = process.env.UMUX_GHOSTTY_WASM_PATH?.trim();
  const candidates: Array<{ label: string; bytes: Uint8Array } | { label: string; url: URL }> = [];
  if (envPath) {
    candidates.push({ label: `UMUX_GHOSTTY_WASM_PATH=${envPath}`, bytes: readFileSync(envPath) });
  }

  // During tests, this file lives at src/core/ghostty-engine.ts, so ../../assets works.
  // In the published package (tsup bundled), this module is part of dist/index.js, so ../assets works.
  candidates.push({ label: '../../assets', url: new URL('../../assets/umux-ghostty-vt.wasm', import.meta.url) });
  candidates.push({ label: '../assets', url: new URL('../assets/umux-ghostty-vt.wasm', import.meta.url) });
  candidates.push({ label: './assets', url: new URL('./assets/umux-ghostty-vt.wasm', import.meta.url) });

  const tried: string[] = [];
  let bytes: Uint8Array | null = null;
  for (const c of candidates) {
    if ('bytes' in c) {
      bytes = c.bytes;
      break;
    }
    const path = fileURLToPath(c.url);
    tried.push(`${c.label}: ${path}`);
    try {
      bytes = readFileSync(path);
      break;
    } catch {
      // continue
    }
  }
  if (!bytes) {
    throw new Error(`umux ghostty wasm: failed to locate wasm file. Tried:\n- ${tried.join('\n- ')}`);
  }
  // WebAssembly.Module expects a strict ArrayBuffer / ArrayBufferView backed by ArrayBuffer.
  // Node's Buffer is backed by ArrayBufferLike; create a copy backed by a real ArrayBuffer.
  const ab: ArrayBuffer = new Uint8Array(bytes).buffer;
  cachedModule = new WebAssembly.Module(ab);
  return cachedModule;
}

function instantiateWasm(): GhosttyWasm {
  if (cachedWasm) return cachedWasm;
  const module = loadWasmModule();
  const WasiCtor = loadWasiCtor();
  if (!WasiCtor) {
    throw new Error('umux ghostty wasm: node:wasi unavailable (requires a Node build with WASI)');
  }
  // Node's WASI API/options changed across major versions. Support both:
  // - Newer Node: requires `version: 'preview1'`
  // - Older Node: doesn't accept/need `version`
  let wasi: any;
  try {
    wasi = new WasiCtor({ version: 'preview1', args: [], env: {}, preopens: {} });
  } catch {
    wasi = new WasiCtor({ args: [], env: {}, preopens: {} });
  }
  const instance = new WebAssembly.Instance(module, {
    env: {
      log: (..._args: unknown[]) => {},
    },
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  if (typeof wasi.initialize === 'function') {
    wasi.initialize(instance);
  } else if (typeof (instance.exports as any)?._start === 'function' && typeof wasi.start === 'function') {
    // Should not happen for our reactor-style module, but keep a fallback.
    wasi.start(instance);
  }

  const exports = instance.exports as unknown as GhosttyWasmExports;
  if (!exports?.memory) {
    throw new Error('umux ghostty wasm: missing `memory` export');
  }

  cachedWasm = {
    exports,
    // wasm memory can grow; always materialize fresh views.
    view: () => new DataView(exports.memory.buffer),
    u8: () => new Uint8Array(exports.memory.buffer),
  };
  return cachedWasm;
}

class GhosttyWasmTerminalEngine implements TerminalEngine {
  private readonly wasm: GhosttyWasm;
  private readonly handle: number;
  private cols: number;
  private rows: number;
  private inputPtr = 0;
  private inputCap = 0;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(cols: number, rows: number) {
    this.wasm = instantiateWasm();
    this.cols = cols;
    this.rows = rows;
    this.handle = this.wasm.exports.umux_vt_terminal_new(cols, rows);
    if (!this.handle) throw new Error('umux ghostty wasm: terminal_new failed');
  }

  write(data: string, onScreen?: () => void): void {
    const bytes = this.encoder.encode(data);
    const ptr = this.ensureInput(bytes.byteLength);
    this.wasm.u8().set(bytes, ptr);
    this.wasm.exports.umux_vt_terminal_feed(this.handle, ptr, bytes.byteLength);
    onScreen?.();
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.wasm.exports.umux_vt_terminal_resize(this.handle, cols, rows);
  }

  capture(options: CaptureOptions = {}): CaptureResult {
    const format = options.format ?? 'text';
    const formatCode = format === 'ansi' ? 1 : 0;

    const outLenPtr = this.wasm.exports.umux_vt_alloc_u8_array(4);
    if (!outLenPtr) throw new Error('umux ghostty wasm: alloc outLen failed');
    this.wasm.view().setUint32(outLenPtr, 0, true);

    const outPtr = this.wasm.exports.umux_vt_terminal_snapshot(this.handle, formatCode, outLenPtr);
    // Snapshotting can grow wasm memory; always read via a fresh view.
    const outLen = this.wasm.view().getUint32(outLenPtr, true);
    this.wasm.exports.umux_vt_free_u8_array(outLenPtr, 4);

    if (!outPtr) {
      return { content: '', format, cols: this.cols, rows: this.rows };
    }

    const bytes = this.wasm.u8().subarray(outPtr, outPtr + outLen);
    const content = this.decoder.decode(bytes);
    this.wasm.exports.umux_vt_free_u8_array(outPtr, outLen);

    return { content, format, cols: this.cols, rows: this.rows };
  }

  dispose(): void {
    try {
      this.wasm.exports.umux_vt_terminal_free(this.handle);
    } catch {
      // ignore
    }
    if (this.inputPtr && this.inputCap) {
      try {
        this.wasm.exports.umux_vt_free_u8_array(this.inputPtr, this.inputCap);
      } catch {
        // ignore
      }
      this.inputPtr = 0;
      this.inputCap = 0;
    }
  }

  private ensureInput(len: number): number {
    if (len <= this.inputCap && this.inputPtr) return this.inputPtr;
    if (this.inputPtr && this.inputCap) {
      this.wasm.exports.umux_vt_free_u8_array(this.inputPtr, this.inputCap);
      this.inputPtr = 0;
      this.inputCap = 0;
    }
    const ptr = this.wasm.exports.umux_vt_alloc_u8_array(len);
    if (!ptr) throw new Error('umux ghostty wasm: alloc input failed');
    this.inputPtr = ptr;
    this.inputCap = len;
    return ptr;
  }
}

export const createGhosttyWasmTerminalEngine: TerminalEngineFactory = ({ cols, rows }) => {
  return new GhosttyWasmTerminalEngine(cols, rows);
};

export const createGhosttyTerminalEngine: TerminalEngineFactory = ({ cols, rows }) => {
  const maxReplayBytes = 2 * 1024 * 1024; // best-effort crash recovery; not a log

  const createFallback = (c: number, r: number) => new XtermTerminalEngine(c, r);
  const createPrimary = (c: number, r: number): TerminalEngine => new GhosttyWasmTerminalEngine(c, r);

  class ResilientEngine implements TerminalEngine {
    private impl: TerminalEngine;
    private replay = '';
    private c = cols;
    private r = rows;

    constructor() {
      try {
        this.impl = createPrimary(this.c, this.r);
      } catch {
        this.impl = createFallback(this.c, this.r);
      }
    }

    write(data: string, onScreen?: () => void): void {
      this.replay = (this.replay + data).slice(-maxReplayBytes);
      try {
        this.impl.write(data, onScreen);
      } catch {
        this.swapToFallback();
        this.impl.write(data, onScreen);
      }
    }

    resize(c: number, r: number): void {
      this.c = c;
      this.r = r;
      try {
        this.impl.resize(c, r);
      } catch {
        this.swapToFallback();
        this.impl.resize(c, r);
      }
    }

    capture(options?: CaptureOptions): CaptureResult {
      try {
        return this.impl.capture(options);
      } catch {
        this.swapToFallback();
        return this.impl.capture(options);
      }
    }

    dispose(): void {
      try {
        this.impl.dispose();
      } finally {
        this.replay = '';
      }
    }

    private swapToFallback(): void {
      try {
        this.impl.dispose();
      } catch {
        // ignore
      }
      this.impl = createFallback(this.c, this.r);
      try {
        this.impl.write(this.replay);
      } catch {
        // ignore; last resort, keep fallback but without replayed state
      }
    }
  }

  return new ResilientEngine();
};
