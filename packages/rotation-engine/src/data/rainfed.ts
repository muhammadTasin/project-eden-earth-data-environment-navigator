/**
 * How much of a fully watered crop's yield an upland crop makes on rain and stored soil water alone at the current
 * place (research/explore/rainfed_yield.py): FAO-56's root-zone soil water balance on the same NASA POWER and GPM
 * IMERG weather as the replays, roots to the deep end of FAO-56 Table 22, and FAO-33's yield response. It leaves out
 * water a shallow water table can feed up to the roots, so on low floodplain land it is a lower bound.
 */
import fs from 'node:fs';
import { LOC } from './location.ts';
import { seasonDay } from '../bn.ts';

type Row = [string, number, number, number, number, number, number | null];

interface RainfedFile {
  method: string;
  crops: Record<string, { rootDepthM: number[]; depletionFraction: number; ky: number; kySource: string; kyAssumed: boolean }>;
  places: Record<string, Record<string, Row[]>>;
}

let data: RainfedFile | null = null;
function rainfed(): RainfedFile | null {
  if (data === null) {
    const file = new URL('./rainfed_yield.json', import.meta.url);
    data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { method: '', crops: {}, places: {} };
  }
  return data;
}

/** The research release's records under their crop-choice ids. */
const RELEASE_IDS: Record<string, string> = {
  'BARI Masur-8': 'lentil', 'BARI Sarisha-14': 'mustard', 'BARI Gom 33 (Early)': 'wheat_early', 'BARI Gom 33 (Late)': 'wheat_late',
};

/**
 * Crops BARI's production guide gives at most one irrigation (research/crops/bari_production_technology.csv: lentil 1,
 * chickpea 1, grass pea none, sesame 1): grown on residual moisture, so district yields are already rain-fed yields.
 */
const RAINFED_IN_PRACTICE = new Set(['lentil', 'chickpea', 'grasspea', 'sesame']);

export interface RainfedFacts {
  typical: number; // share of a fully watered crop's yield in the median season
  dryYear: number; // the same in the driest season in five
  etShare: number; // share of the crop's water use that rain and stored soil water cover
  /** Share of the usual (district) yield without irrigation: 1 where farmers already grow the crop on rain alone. */
  againstPractice: number;
  kyAssumed: boolean;
}

/** Rain-only yield for a Rabi or Kharif-1 record key ('BARI Masur-8', 'sunflower@11-25') at this place; null for rice. */
export function rainfedFacts(key: string, sowing?: string): RainfedFacts | null {
  const d = rainfed();
  const at = key.indexOf('@');
  const id = at >= 0 ? key.slice(0, at) : RELEASE_IDS[key];
  const place = LOC.kind === 'pilot' ? 'talanda_tanore' : LOC.district;
  const rows = id ? d?.places[place]?.[id] : undefined;
  if (!rows?.length) return null;
  const sow = at >= 0 ? key.slice(at + 1) : sowing ?? rows[0][0];
  const row = rows.reduce((best, r) => (Math.abs(seasonDay(r[0]) - seasonDay(sow)) < Math.abs(seasonDay(best[0]) - seasonDay(sow)) ? r : best));
  return {
    typical: row[1], dryYear: row[2], etShare: row[3], againstPractice: RAINFED_IN_PRACTICE.has(id) ? 1 : row[1],
    kyAssumed: Boolean(d?.crops[id]?.kyAssumed),
  };
}
