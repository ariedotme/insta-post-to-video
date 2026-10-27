export type Position = `${'top' | 'bottom'}-${'left' | 'center' | 'right'}`;
export type Transition = 'slide' | 'fade' | 'none';
export type Fit = 'contain' | 'cover';
export type Background = 'blur' | 'color';
export type CreditStyle = 'pill' | 'plain';

export interface Settings {
  /** Seconds each image stays on screen, not counting transitions. */
  slideDuration: number;
  transition: Transition;
  transitionDuration: number;
  fit: Fit;
  background: Background;
  backgroundColor: string;
  cornerRadius: number;
  showDots: boolean;
  handle: string;
  creditPosition: Position;
  creditStyle: CreditStyle;
}

export const DEFAULTS: Readonly<Settings> = {
  slideDuration: 3,
  transition: 'slide',
  transitionDuration: 0.45,
  fit: 'contain',
  background: 'blur',
  backgroundColor: '#101012',
  cornerRadius: 24,
  showDots: true,
  handle: '',
  creditPosition: 'top-left',
  creditStyle: 'pill',
};

const OPTIONS: { [K in keyof Settings]?: readonly Settings[K][] } = {
  transition: ['slide', 'fade', 'none'],
  fit: ['contain', 'cover'],
  background: ['blur', 'color'],
  creditStyle: ['pill', 'plain'],
  creditPosition: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
};

const RANGES: { [K in keyof Settings]?: [min: number, max: number] } = {
  slideDuration: [0.5, 30],
  transitionDuration: [0.1, 2],
  cornerRadius: [0, 80],
};

/** Coerces an arbitrary value into a valid setting, falling back to the default. */
export function sanitize<K extends keyof Settings>(key: K, value: unknown): Settings[K] {
  const fallback = DEFAULTS[key];
  const options = OPTIONS[key] as readonly unknown[] | undefined;
  if (options) return (options.includes(value) ? value : fallback) as Settings[K];

  if (typeof fallback === 'number') {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
    const [min, max] = RANGES[key] ?? [-Infinity, Infinity];
    return Math.min(max, Math.max(min, n)) as Settings[K];
  }
  if (key === 'backgroundColor') {
    return (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback) as Settings[K];
  }
  return (typeof value === typeof fallback ? value : fallback) as Settings[K];
}

/** "  @@Some.Handle " -> "Some.Handle" (Instagram handles are at most 30 chars). */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, 30);
}

const SETTINGS_KEY = 'ig2story:settings';

/** Only the look is remembered; the handle belongs to whichever post is loaded. */
const NOT_STORED: (keyof Settings)[] = ['handle'];

export function loadSettings(): Settings {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch {
    // Missing, corrupt or blocked storage: start from defaults.
  }
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (key in stored && !NOT_STORED.includes(key)) (settings as Record<string, unknown>)[key] = sanitize(key, stored[key]);
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  const stored: Partial<Settings> = { ...settings };
  for (const key of NOT_STORED) delete stored[key];
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  } catch {
    // Storage may be full or blocked; persistence is only a convenience.
  }
}
