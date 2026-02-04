export type KeyRequest = {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
};

const modifierAliases: Record<string, keyof Omit<KeyRequest, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
  windows: 'meta',
};

const specialKeyAliases: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  bs: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  space: 'Space',
  spacebar: 'Space',

  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',

  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  insert: 'Insert',
  ins: 'Insert',
};

for (let i = 1; i <= 12; i++) {
  specialKeyAliases[`f${i}`] = `F${i}`;
}

function normalizeToken(token: string): string {
  return token.trim().replaceAll('_', '').replaceAll(' ', '').toLowerCase();
}

export function parseKeySpec(input: string): KeyRequest {
  const raw = input.trim();
  if (!raw) {
    throw new Error('Key spec is empty');
  }

  const tokens = raw
    .split(/[+-]/g)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error('Key spec is empty');
  }

  const mods: Omit<KeyRequest, 'key'> = {};
  const baseTokens: string[] = [];

  for (const token of tokens) {
    const normalized = normalizeToken(token);
    const mod = modifierAliases[normalized];
    if (mod) {
      mods[mod] = true;
      continue;
    }
    baseTokens.push(token);
  }

  if (baseTokens.length !== 1) {
    throw new Error(`Invalid key spec (expected exactly one key): ${input}`);
  }

  const baseRaw = baseTokens[0].trim();
  const baseNormalized = normalizeToken(baseRaw);

  const special = specialKeyAliases[baseNormalized];
  if (special) {
    return { key: special, ...mods };
  }

  if (baseRaw.length === 1) {
    return { key: baseRaw, ...mods };
  }

  throw new Error(`Unknown key: ${input}`);
}
