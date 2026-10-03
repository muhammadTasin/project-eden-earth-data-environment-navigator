/**
 * Bangla digits and dates for farmer-facing text. Dates in the research release are 'MM-DD'.
 */

const DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const LAND_TYPE_BANGLA: Record<string, string> = {
  high: 'উঁচু',
  medium_high: 'মাঝারি উঁচু',
  medium_low: 'মাঝারি নিচু',
  low: 'নিচু',
  very_low: 'খুব নিচু',
};

export function bnDigits(value: number | string): string {
  return String(value).replace(/\d/g, d => DIGITS[Number(d)]);
}

/** 110000 -> '১,১০,০০০' */
export function bnNumber(value: number): string {
  return Math.round(value).toLocaleString('bn-BD');
}

/** 7.25 -> '৭.৩' */
export function bnDecimal(value: number, digits = 1): string {
  return bnDigits(value.toFixed(digits));
}

function parts(monthDay: string): [number, number] {
  const [m, d] = monthDay.split('-').map(Number);
  return [m, d];
}

/** '11-10' -> '১০ নভেম্বর' */
export function bnDate(monthDay: string): string {
  const [m, d] = parts(monthDay);
  return `${bnDigits(d)} ${MONTHS_BN[m - 1]}`;
}

/** '11-10' -> '10 Nov' */
export function enDate(monthDay: string): string {
  const [m, d] = parts(monthDay);
  return `${d} ${MONTHS_EN[m - 1]}`;
}

/** ['07-05', '07-15'] -> '৫–১৫ জুলাই'; across months '২৩ অক্টোবর – ১৪ নভেম্বর' */
export function bnRange(start: string, end: string): string {
  const [m0, d0] = parts(start);
  const [m1, d1] = parts(end);
  return m0 === m1 ? `${bnDigits(d0)}–${bnDigits(d1)} ${MONTHS_BN[m0 - 1]}` : `${bnDate(start)} – ${bnDate(end)}`;
}

export function bnMonth(monthIndex: number): string {
  return MONTHS_BN[monthIndex];
}

export function enMonth(monthIndex: number): string {
  return MONTHS_EN[monthIndex];
}

/** 'তালন্দ ইউনিয়ন' -> 'তালন্দ ইউনিয়নের' */
export function bnOf(name: string): string {
  return name.endsWith('ইউনিয়ন') ? `${name}ের` : `${name}-এর`;
}

/** Genitive of a crop or place name: 'সূর্যমুখী' -> 'সূর্যমুখীর', 'মুগ' -> 'মুগের' */
export function bnGenitive(name: string): string {
  return /[\u0985-\u0994\u09BE-\u09CC]$/.test(name) ? `${name}র` : `${name}ের`;
}

/** 'সেচ লাগে প্রায় ১৯৯ মিমি', or 'সেচ প্রায় লাগে না' below 20 mm (the replay's rain covers it) */
export function bnIrrigation(mm: number): string {
  return mm < 20 ? 'সেচ প্রায় লাগে না' : `সেচ লাগে প্রায় ${bnDigits(mm)} মিমি`;
}

/** Genitive of a date or range ending in a month: '১০ নভেম্বর' -> '১০ নভেম্বরের', '৫–১৫ জুলাই' -> '৫–১৫ জুলাইয়ের' */
export function bnDateOf(text: string): string {
  if (text.endsWith('ি') || text.endsWith('ে')) return `${text}র`;
  if (text.endsWith('ই')) return `${text}য়ের`;
  return `${text}ের`;
}

/**
 * Days since 1 July of the crop year, so Aman (Jul-Dec) and Rabi (Jan-Jun) dates sort in field order.
 * '07-01' -> 0, '11-10' -> 132, '03-01' -> 243.
 */
export function seasonDay(monthDay: string): number {
  const [m, d] = parts(monthDay);
  const monthStart = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const dayOfYear = monthStart[m - 1] + d - 1;
  return (dayOfYear - 181 + 365) % 365;
}

/** Calendar date of 'MM-DD' in the crop year that starts in July of seasonYear. */
export function seasonDate(monthDay: string, seasonYear: number): Date {
  const [m, d] = parts(monthDay);
  return new Date(Date.UTC(m >= 7 ? seasonYear : seasonYear + 1, m - 1, d));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
