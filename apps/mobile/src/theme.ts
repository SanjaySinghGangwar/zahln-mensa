// Anthracite + gold, the same palette as the dashboard. Contrast checked for
// WCAG AA: text on surfaces >= 4.5:1, gold is only used behind dark text.
export const colors = {
  bg: '#f7f5f0',
  surface: '#ffffff',
  surface2: '#efece4',
  text: '#1f1f1f',
  muted: '#5a5a5a',
  line: '#e4e0d6',
  brand: '#1f1f1f',
  brandInk: '#ffffff',
  accent: '#f2b705',
  accentInk: '#1f1f1f',
  accentSoft: '#fbf1d0',
  ok: '#1e7d46',
  okSoft: '#e3f2e9',
  warn: '#8a5300',
  warnSoft: '#fdf0d5',
  bad: '#c8102e',
  badSoft: '#fbe5e8',
  info: '#2b5aa8',
  infoSoft: '#e6eefb',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = 12;
/** Android's minimum touch target. */
export const TOUCH = 48;

export type Tone = 'info' | 'ok' | 'warn' | 'bad' | 'muted';

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  info: { fg: colors.info, bg: colors.infoSoft },
  ok: { fg: colors.ok, bg: colors.okSoft },
  warn: { fg: colors.warn, bg: colors.warnSoft },
  bad: { fg: colors.bad, bg: colors.badSoft },
  muted: { fg: colors.muted, bg: colors.surface2 },
};

export const STATUS_TONE: Record<string, Tone> = {
  open: 'info',
  paying: 'warn',
  paid: 'ok',
  expired: 'muted',
  pending: 'warn',
  confirmed: 'ok',
  declined: 'bad',
  completed: 'ok',
  failed: 'bad',
};
