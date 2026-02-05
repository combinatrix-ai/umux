export type HistoryFormat = 'text' | 'color' | 'raw';

function normalizeCarriageReturns(text: string): string {
  // Normalize CRLF to LF, and drop lone CR.
  // Dropping CR avoids terminal line-rewrite behavior without inflating line counts.
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '');
}

function applyBackspaces(text: string): string {
  // Handle common terminal output patterns like "abc\b\b12" => "a12"
  const out: string[] = [];
  for (const ch of text) {
    if (ch === '\b' || ch === '\x7f') {
      if (out.length > 0 && out[out.length - 1] !== '\n') out.pop();
      continue;
    }
    out.push(ch);
  }
  return out.join('');
}

function stripControlChars(text: string): string {
  // Remove C0 controls except TAB, LF, and ESC (CR handled earlier).
  // Keep ESC so downstream stripping can decide what to preserve (e.g. SGR colors).
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
}

function stripOscDcsAndFriends(text: string): string {
  // OSC: ESC ] ... (BEL | ST)
  text = text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '');
  // DCS: ESC P ... ST
  text = text.replace(/\x1bP[\s\S]*?\x1b\\/g, '');
  // SOS/PM/APC: ESC X / ESC ^ / ESC _ ... ST
  text = text.replace(/\x1b[X^_][\s\S]*?\x1b\\/g, '');
  return text;
}

function stripCsi(text: string, preserveSgr: boolean): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (seq) => {
    if (preserveSgr && /^\x1b\[[0-9;]*m$/.test(seq)) return seq;
    return '';
  });
}

function stripSingleEscapes(text: string): string {
  // 2-character sequences like ESC E, ESC 7, etc.
  return text.replace(/\x1b[@-Z\\-_]/g, '');
}

export function formatTerminalOutput(text: string, format: HistoryFormat): string {
  if (format === 'raw') return text;

  let out = text;
  out = normalizeCarriageReturns(out);
  out = applyBackspaces(out);
  out = stripControlChars(out);
  out = stripOscDcsAndFriends(out);
  out = stripCsi(out, format === 'color');
  out = stripSingleEscapes(out);
  return out;
}
