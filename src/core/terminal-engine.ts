import xtermSerialize from '@xterm/addon-serialize';
import xtermHeadless from '@xterm/headless';
import type { CaptureOptions, CaptureResult, TerminalEngine, TerminalEngineFactory } from './types.js';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = xtermSerialize;

export class XtermTerminalEngine implements TerminalEngine {
  private readonly terminal: InstanceType<typeof Terminal>;
  private readonly serializeAddon: InstanceType<typeof SerializeAddon>;

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({ cols, rows, allowProposedApi: true, logLevel: 'off' });
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);
  }

  write(data: string, onScreen?: () => void): void {
    const core = (this.terminal as unknown as { _core?: { writeSync?: (data: string) => void } })
      ._core;
    if (core?.writeSync) {
      core.writeSync(data);
      onScreen?.();
      return;
    }

    this.terminal.write(data, () => {
      onScreen?.();
    });
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  capture(options: CaptureOptions = {}): CaptureResult {
    const format = options.format ?? 'text';
    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    const content = format === 'ansi' ? this.serializeScreenAnsi() : this.captureScreenText();
    return { content, format, cols, rows };
  }

  dispose(): void {
    this.terminal.dispose();
  }

  private captureScreenText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.terminal.rows; row += 1) {
      const line = buffer.getLine(row);
      lines.push(line ? line.translateToString(true) : '');
    }
    return lines.join('\n');
  }

  private serializeScreenAnsi(): string {
    try {
      return this.serializeAddon.serialize();
    } catch {
      return this.captureScreenText();
    }
  }
}

export const createXtermTerminalEngine: TerminalEngineFactory = ({ cols, rows }) => {
  return new XtermTerminalEngine(cols, rows);
};

