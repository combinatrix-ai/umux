import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library and CLI
  {
    entry: ['src/index.ts', 'src/cli/bin.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    external: ['node-pty'],
  },
  // MCP server
  {
    entry: ['src/mcp/index.ts'],
    outDir: 'dist/mcp',
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    external: ['node-pty'],
  },
]);
