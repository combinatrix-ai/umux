/**
 * Keyboard key definitions and encoding
 */

// ============================================================================
// Key Symbols
// ============================================================================

export const Key = {
  // Control keys
  Enter: Symbol('Enter'),
  Tab: Symbol('Tab'),
  Escape: Symbol('Escape'),
  Backspace: Symbol('Backspace'),
  Delete: Symbol('Delete'),
  Space: Symbol('Space'),

  // Arrow keys
  Up: Symbol('Up'),
  Down: Symbol('Down'),
  Left: Symbol('Left'),
  Right: Symbol('Right'),

  // Navigation
  Home: Symbol('Home'),
  End: Symbol('End'),
  PageUp: Symbol('PageUp'),
  PageDown: Symbol('PageDown'),
  Insert: Symbol('Insert'),

  // Function keys
  F1: Symbol('F1'),
  F2: Symbol('F2'),
  F3: Symbol('F3'),
  F4: Symbol('F4'),
  F5: Symbol('F5'),
  F6: Symbol('F6'),
  F7: Symbol('F7'),
  F8: Symbol('F8'),
  F9: Symbol('F9'),
  F10: Symbol('F10'),
  F11: Symbol('F11'),
  F12: Symbol('F12'),

  // Modifier keys (for type hints, not used directly)
  Ctrl: Symbol('Ctrl'),
  Alt: Symbol('Alt'),
  Shift: Symbol('Shift'),
  Meta: Symbol('Meta'),
} as const;

export type SpecialKey = (typeof Key)[keyof typeof Key];

// ============================================================================
// Key Input Types
// ============================================================================

export interface ModifiedKey {
  key: SpecialKey | string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export type KeyInput = string | SpecialKey | ModifiedKey;

// ============================================================================
// Helper Functions
// ============================================================================

/** Create Ctrl+key combination */
export function ctrl(key: SpecialKey | string): ModifiedKey {
  return { key, ctrl: true };
}

/** Create Alt+key combination */
export function alt(key: SpecialKey | string): ModifiedKey {
  return { key, alt: true };
}

/** Create Shift+key combination */
export function shift(key: SpecialKey | string): ModifiedKey {
  return { key, shift: true };
}

/** Create Meta+key combination */
export function meta(key: SpecialKey | string): ModifiedKey {
  return { key, meta: true };
}

// ============================================================================
// Key Encoding (to terminal escape sequences)
// ============================================================================

const KEY_MAP: Record<symbol, string> = {
  [Key.Enter]: '\r',
  [Key.Tab]: '\t',
  [Key.Escape]: '\x1b',
  [Key.Backspace]: '\x7f',
  [Key.Delete]: '\x1b[3~',
  [Key.Space]: ' ',

  [Key.Up]: '\x1b[A',
  [Key.Down]: '\x1b[B',
  [Key.Right]: '\x1b[C',
  [Key.Left]: '\x1b[D',

  [Key.Home]: '\x1b[H',
  [Key.End]: '\x1b[F',
  [Key.PageUp]: '\x1b[5~',
  [Key.PageDown]: '\x1b[6~',
  [Key.Insert]: '\x1b[2~',

  [Key.F1]: '\x1bOP',
  [Key.F2]: '\x1bOQ',
  [Key.F3]: '\x1bOR',
  [Key.F4]: '\x1bOS',
  [Key.F5]: '\x1b[15~',
  [Key.F6]: '\x1b[17~',
  [Key.F7]: '\x1b[18~',
  [Key.F8]: '\x1b[19~',
  [Key.F9]: '\x1b[20~',
  [Key.F10]: '\x1b[21~',
  [Key.F11]: '\x1b[23~',
  [Key.F12]: '\x1b[24~',
};

// Map for arrow keys with modifiers (xterm style)
// Modifier: 1 + (Shift ? 1 : 0) + (Alt ? 2 : 0) + (Ctrl ? 4 : 0) + (Meta ? 8 : 0)
const ARROW_BASE: Record<symbol, string> = {
  [Key.Up]: 'A',
  [Key.Down]: 'B',
  [Key.Right]: 'C',
  [Key.Left]: 'D',
  [Key.Home]: 'H',
  [Key.End]: 'F',
};

function isSpecialKey(key: unknown): key is SpecialKey {
  return typeof key === 'symbol';
}

function isModifiedKey(key: KeyInput): key is ModifiedKey {
  return typeof key === 'object' && key !== null && 'key' in key;
}

/**
 * Encode a key input to terminal bytes
 */
export function encodeKey(input: KeyInput): string {
  // Plain string - return as-is
  if (typeof input === 'string') {
    return input;
  }

  // Special key (symbol) without modifiers
  if (isSpecialKey(input)) {
    const encoded = KEY_MAP[input];
    if (!encoded) {
      throw new Error(`Unknown key: ${String(input)}`);
    }
    return encoded;
  }

  // Modified key
  if (isModifiedKey(input)) {
    const { key, ctrl, alt, shift, meta } = input;

    // Single character with Ctrl
    // Terminal protocols generally don't distinguish Ctrl+Shift+<letter> from Ctrl+<letter>,
    // so treat Shift as a no-op for Ctrl+<letter>.
    if (typeof key === 'string' && key.length === 1 && ctrl && !alt && !meta) {
      const code = key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) {
        // a-z
        return String.fromCharCode(code - 96); // Ctrl+a = 0x01, etc.
      }
    }

    // Special key with modifiers
    if (isSpecialKey(key)) {
      // Shift-Tab (Backtab) and variants (xterm style).
      if (key === Key.Tab && (ctrl || alt || shift || meta)) {
        const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (meta ? 8 : 0);
        return shift && !ctrl && !alt && !meta ? '\x1b[Z' : `\x1b[1;${mod}Z`;
      }

      const arrowCode = ARROW_BASE[key];
      if (arrowCode && (ctrl || alt || shift || meta)) {
        // Calculate modifier code
        const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (meta ? 8 : 0);
        return `\x1b[1;${mod}${arrowCode}`;
      }

      // No modifier or not an arrow key - use base encoding
      const encoded = KEY_MAP[key];
      if (encoded) {
        // Apply Alt prefix if needed (Shift typically doesn't change the escape sequence
        // for non-arrow keys in a portable way, but Alt prefix remains meaningful).
        if (alt && !ctrl && !meta) {
          return `\x1b${encoded}`;
        }
        return encoded;
      }
    }

    // String key with Alt (ESC prefix). Preserve case if Shift is set.
    if (typeof key === 'string' && alt && !ctrl && !meta) {
      return `\x1b${key}`;
    }

    // Fallback: just return the key
    if (typeof key === 'string') {
      return key;
    }

    throw new Error(`Cannot encode key: ${JSON.stringify(input)}`);
  }

  throw new Error(`Invalid key input: ${JSON.stringify(input)}`);
}

/**
 * Encode multiple keys
 */
export function encodeKeys(inputs: KeyInput[]): string {
  return inputs.map(encodeKey).join('');
}
