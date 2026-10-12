const CURRENCY = 'USD';

export const money = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY, maximumFractionDigits: 2 }).format(v);

export const num = (v: number) => new Intl.NumberFormat('en-US').format(Math.round(v));

export const compact = (v: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

export function dateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN');
}

export function relative(iso: string | null) {
  if (!iso) return 'chưa bao giờ';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

const regionNames = new Intl.DisplayNames(['vi'], { type: 'region' });
export function countryName(code: string) {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const FORMAT_LABELS: Record<string, string> = {
  BANNER: 'Banner',
  INTERSTITIAL: 'Interstitial',
  REWARDED: 'Rewarded',
  REWARDED_INTERSTITIAL: 'Rewarded interstitial',
  NATIVE: 'Native',
  APP_OPEN: 'App open',
};
export const formatName = (f: string) => FORMAT_LABELS[f] ?? f;

/** YYYY-MM-DD theo giờ địa phương (toISOString dùng UTC nên sẽ lệch ngày ở VN trước 7h sáng). */
export function isoDate(d: Date) {
  return new Intl.DateTimeFormat('en-CA').format(d);
}

export function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}
