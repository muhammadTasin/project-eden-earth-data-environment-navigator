/**
 * One row per upazila for the dashboard's map of Bangladesh, read from the same files the advice uses:
 * MODIS crops a year and winter greenness (research/explore/national_greenness.py), the district's 25-season NASA
 * replay and GLDAS groundwater (national_replay.py), NASA SEDAC PEST-CHEMGRIDS pesticide on rice and on pulses and
 * oilseeds (pesticide_load.py), SRDI soil fertility classes (soil_atlas_export.py), and today's NASA conditions
 * (research/live/daily_update.py). District-level values repeat for every upazila of the district, and say so.
 */
import fs from 'node:fs';
import { liveStatus, liveUpazilas } from './live.ts';

const DATA = new URL('../../../packages/rotation-engine/src/data/', import.meta.url);
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, DATA), 'utf8'));

interface StaticRow {
  name: string;
  district: string;
  cropsNow: number | null;
  cropsThen: number | null;
  winterNdvi: number | null;
  boroIrrigationMm: number | null;
  groundwaterMmPerYear: number | null;
  pesticideRice: [number, number] | null;
  pesticideOther: [number, number] | null;
  organicMatter: string | null;
  ph: string | null;
}

let fixed: { rows: Record<string, StaticRow>; sources: Record<string, string> } | null = null;

function staticRows() {
  if (fixed) return fixed;
  const national = read('national_replay.json');
  const green = read('greenness_upazila.json');
  const atlas = read('soil_atlas.json');
  const pest = read('pesticide_load.json');
  const rows: Record<string, StaticRow> = {};
  for (const u of national.upazilas as Array<{ id: string; name: string; district: string }>) {
    const d = national.districts[u.district];
    const g = green.upazilas[u.id];
    const s = atlas.classes[u.id];
    const p = pest.upazilas[u.id] ?? {};
    rows[u.id] = {
      name: u.name,
      district: u.district,
      cropsNow: g?.recent?.cyclesPerYear ?? null,
      cropsThen: g?.early?.cyclesPerYear ?? null,
      winterNdvi: g?.recent?.peakNdvi ?? null,
      boroIrrigationMm: d?.rabi?.['BRRI dhan28']?.netIrrigationMm ?? null,
      groundwaterMmPerYear: d?.conditions?.groundwater?.trendMmPerYear ?? null,
      pesticideRice: p.rice ?? null,
      pesticideOther: p.other ?? null,
      organicMatter: s?.organicMatter ?? null,
      ph: s?.ph ?? null,
    };
  }
  fixed = {
    rows,
    sources: {
      crops: `${green.source}; ${green.upazilas[national.upazilas[0].id]?.early?.years ?? ''} against ${green.upazilas[national.upazilas[0].id]?.recent?.years ?? ''}`,
      water: 'NASA POWER + GPM IMERG 25-season replay at the district point (FAO-56); GLDAS-2.2 GRACE-assimilated groundwater, 2003-2025',
      pesticide: `${pest.source.name}, ${pest.source.year}: ${pest.source.units}. ${pest.source.caution}`,
      soil: atlas.source,
    },
  };
  return fixed;
}

/** Every upazila with its map values; `live` is today's NASA update (null before the first run). */
export function mapLayers() {
  const { rows, sources } = staticRows();
  const live = liveUpazilas() ?? [];
  const byId = new Map(live.map(r => [r.id, r]));
  const status = liveStatus();
  return {
    generatedAt: new Date().toISOString(),
    liveDate: status?.sources?.find((s: any) => s.id === 'power')?.latestDate ?? null,
    sources: { ...sources, live: status ? `NASA POWER daily, ${status.normalYears} normal; GPM IMERG ${status.sources?.find((s: any) => s.id === 'imerg')?.latestDate ?? 'not available'}` : 'not run yet' },
    upazilas: Object.fromEntries(Object.entries(rows).map(([id, r]) => {
      const l = byId.get(id);
      return [id, {
        ...r,
        rainPctOfNormal: l?.rain30PctOfNormal ?? null,
        rainStatus: l?.rainStatus ?? null,
        soilStatus: l?.soilStatus ?? null,
        hotDays7: l?.hotDays7 ?? null,
        rain7: l?.rain7 ?? null,
        blastDays7: l?.blastDays7 ?? null,
        blastStatus: l?.blastStatus ?? null,
        lateBlightDays7: l?.lateBlightDays7 ?? null,
        lateBlightStatus: l?.lateBlightStatus ?? null,
      }];
    })),
  };
}
