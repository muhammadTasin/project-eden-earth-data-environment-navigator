/**
 * One row per upazila for the dashboard's map of Bangladesh, read from the same files the advice uses:
 * MODIS crops a year and winter greenness (research/explore/national_greenness.py), the district's 25-season NASA
 * replay and GLDAS groundwater (national_replay.py), NASA SEDAC PEST-CHEMGRIDS pesticide on rice and on pulses and
 * oilseeds (pesticide_load.py), SRDI soil fertility classes (soil_atlas_export.py), and today's NASA conditions
 * (research/live/daily_update.py). District-level values repeat for every upazila of the district, and say so.
 * This week's field alerts use the engine's rules (field_alerts.ts) with the usual crop calendar: every Aman variety
 * the advice knows (the most serious result counts), BRRI dhan28 for Boro and BARI Gom 33 for wheat, where the
 * upazila grows them (BRRI's 2014-15 cropping patterns; Aman not on low land).
 */
import fs from 'node:fs';
import { liveFields, liveStatus, liveUpazilas } from './live.ts';
import { LOC } from '../../../packages/rotation-engine/src/data/location.ts';
import { AMAN_CATALOG } from '../../../packages/rotation-engine/src/data/crop_catalog.ts';
import { fieldAlerts, worstLevel, type FieldAlert, type FieldCrops } from '../../../packages/rotation-engine/src/field_alerts.ts';

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
      field: "Paddy water from NASA GPM IMERG rain and POWER evapotranspiration (the replay's water balance); heat and cold from NASA POWER and Open-Meteo's 7-day forecast (a weather model, not NASA)",
      soil: atlas.source,
    },
  };
  return fixed;
}

let grows: Record<string, { aman: boolean; boro: boolean; wheat: boolean }> | null = null;
/** Which of the alert crops each upazila grows, from BRRI's cropping patterns (all three where the survey has none). */
function cropsGrown() {
  if (grows) return grows;
  const profile = read('upazila_profile.json');
  grows = {};
  for (const [id, u] of Object.entries<any>(profile.upazilas)) {
    const pats: string[] = (u.patterns ?? []).map((p: [string, number]) => p[0]);
    const any = (re: RegExp) => !pats.length || pats.some(p => re.test(p));
    grows[id] = { aman: u.land?.type !== 'low' && any(/Aman/), boro: any(/Boro/), wheat: pats.some(p => /Wheat/.test(p)) };
  }
  return grows;
}

/** This week's field alerts for one upazila on the usual calendar. */
function fieldNow(id: string, field: any, today: string): FieldAlert[] {
  const g = cropsGrown()[id] ?? { aman: true, boro: true, wheat: false };
  const boro = LOC.rabi['BRRI dhan28'];
  const wheat = LOC.rabi['BARI Gom 33 (Early)'];
  const base: FieldCrops = {
    boro: g.boro && boro ? { variety: 'BRRI dhan28', varietyBangla: 'ব্রি ধান২৮', transplant: boro.sowing, harvest: boro.harvest } : null,
    wheat: g.wheat && wheat ? { sowing: wheat.sowing, harvest: wheat.harvest } : null,
    boroSeedbed: g.boro,
  };
  const out = fieldAlerts(today, base, field);
  if (g.aman) {
    for (const [variety, a] of Object.entries(LOC.aman)) {
      out.push(...fieldAlerts(today, { aman: { variety, varietyBangla: AMAN_CATALOG[variety]?.varietyBangla ?? variety, flowering: a.flowering } }, field));
    }
  }
  return out;
}

/** Every upazila with its map values; `live` is today's NASA update (null before the first run). */
export function mapLayers() {
  const { rows, sources } = staticRows();
  const live = liveUpazilas() ?? [];
  const fields = liveFields();
  const today = new Date().toISOString().slice(0, 10);
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
        ...fieldRow(id, fields.get(id), today),
      }];
    })),
  };
}

/** The field-alert values the map colours by: the most serious level of each rule, and the paddy's water. */
function fieldRow(id: string, field: any, today: string) {
  if (!field) return { amanDryStatus: null, riceHeatStatus: null, coldStatus: null, wheatHeatStatus: null, paddyWaterMm: null };
  const alerts = fieldNow(id, field, today);
  return {
    amanDryStatus: worstLevel(alerts, 'aman_dry_spell') ?? 'none',
    riceHeatStatus: worstLevel(alerts, 'rice_heat') ?? 'none',
    coldStatus: worstLevel(alerts, 'cold_seedbed') ?? 'none',
    wheatHeatStatus: worstLevel(alerts, 'wheat_heat') ?? 'none',
    paddyWaterMm: field.paddyWaterMm ?? null,
    forecastRain7: field.forecast ? Math.round(field.forecast.rain.reduce((a: number, b: number | null) => a + (b ?? 0), 0)) : null,
  };
}
