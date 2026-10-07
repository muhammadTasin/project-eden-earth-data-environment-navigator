/**
 * Disease weather from NASA POWER: how many days in a typical season the place's weather favours rice blast or potato
 * late blight (research/explore/disease_climatology.py, 2001-2025), and this week's reading from the daily update
 * (research/live/daily_update.py). The rules are in research/live/disease_weather.py: leaves wet 10 hours or more
 * at 15-26 C for blast, the Hutton criteria for late blight. Disease weather is a reason to look, not to spray.
 */
import fs from 'node:fs';
import { LOC } from './location.ts';

type Spread = { median: number; p20: number; p80: number };
interface DiseaseFile {
  method: string;
  rules: Record<string, { nameEn: string; nameBn: string; windows: Record<string, [string, string]>; basis: string }>;
  places: Record<string, { blastAman: Spread; blastBoro: Spread; lateBlight: Spread }>;
}

let data: DiseaseFile | null = null;
export function diseaseData(): DiseaseFile {
  if (!data) {
    const file = new URL('./disease_weather.json', import.meta.url);
    data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { method: '', rules: {}, places: {} };
  }
  return data!;
}

/** Typical-season disease-weather days at the current place (the pilot's own point, else its district's). */
export function typicalDiseaseDays() {
  return diseaseData().places[LOC.kind === 'pilot' ? 'talanda_tanore' : LOC.district] ?? null;
}

/** Days of disease weather a plan's crops meet in a typical year: blast on Aman and Boro, late blight on potato. */
export function planDiseaseDays(crops: { aman: boolean; boro: boolean; potato: boolean }): number | null {
  const t = typicalDiseaseDays();
  if (!t) return null;
  return (crops.aman ? t.blastAman.median : 0) + (crops.boro ? t.blastBoro.median : 0) + (crops.potato ? t.lateBlight.median : 0);
}

export type DiseaseStatus = 'high' | 'watch' | 'low' | 'off';
export interface DiseaseNow {
  date: string;
  riceBlast?: { days7: number; status: DiseaseStatus; season: string | null };
  lateBlight?: { days7: number; status: DiseaseStatus; season: string | null };
}
