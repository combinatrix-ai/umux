#!/usr/bin/env node
/**
 * umux CLI entry point
 */

// Suppress Node's ExperimentalWarning for WASI. We intentionally use WASI for
// Ghostty VT (WASM/WASI) support and don't want to spam users on every CLI call.
// Opt out with UMUX_SUPPRESS_WASI_WARNING=0.
const suppress = (process.env.UMUX_SUPPRESS_WASI_WARNING ?? '1') !== '0';
if (suppress) {
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

const { createProgram } = await import('./program.js');
const program = createProgram();
program.parse();
