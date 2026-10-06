/**
 * Types for the generated research release in tanore_replay_data.ts.
 * Dates are calendar days written 'MM-DD'; every number comes from a WinR research table.
 */

export type MonthDay = string;

export interface ReleaseInfo {
  id: string;
  generatedOn: string;
  researchCommit: string;
  generator: string;
  pilot: string;
  seasons: string;
}

export interface AmanRecord {
  variety: string;
  durationDays: [number, number];
  seedbedWindow: [MonthDay, MonthDay];
  transplant: MonthDay;
  flowering: MonthDay;
  maturity: MonthDay;
  fieldFree: MonthDay; // harvest + 7 days, when the next crop can be sown
  rescueSeasons: number; // seasons with 5+ dry days around flowering in the paddy water balance
  totalSeasons: number;
  rescueYears: number[];
  cropWaterUseMm: number;
  floweringNightTempC: number | null;
  fieldDays: number; // transplanting to maturity
}

export interface HeatExposure {
  stage: string;
  stageBangla: string;
  thresholdC: number;
  windowDays: number;
  hotDays: number;
}

export interface FertilizerDose {
  cropGroupBangla: string;
  ureaKgHa: number;
  tspKgHa: number;
  mopKgHa: number;
  gypsumKgHa: number;
  zincSulphateKgHa: number;
  boricAcidKgHa: number;
}

export interface RabiRecord {
  key: string;
  replayLabel: string;
  sowing: MonthDay;
  harvest: MonthDay;
  sowingWindow: [MonthDay, MonthDay] | null;
  sowingWindowSource: string | null;
  seasons: number;
  netIrrigationMm: number;
  netIrrigationRangeMm: [number, number];
  pumpedM3PerHa: number; // median net irrigation as groundwater pumped per hectare
  fieldDays: number; // sowing to harvest, both days counted
  cropWaterUseMm: number;
  heat: HeatExposure | null;
  /** The dose from the SRDI card; null at a place with no soil card (every place except the pilot), where no fertilizer amount is given. */
  fertilizer: FertilizerDose | null;
  districtYieldTPerHa: number | null;
}

export interface SrdiCard {
  siteId: string;
  unionBangla: string;
  soilTypeBangla: string;
  landTypeBangla: string;
  aman: FertilizerDose;
  source: string;
}

interface GreennessPeriod {
  years: string;
  peakNdvi: number;
  cyclesPerYear: number;
}

export interface PilotConditions {
  siteId: string;
  lat: number;
  lon: number;
  bmdStation: string;
  bmdStationKm: number;
  smap: {
    date: string;
    rootZoneM3M3: number;
    sameDatePastYears: Array<{ year: number; rootZoneM3M3: number }>;
    nov10TypicalM3M3: number;
    nov10Years: number[];
  } | null;
  rainLast30Days: {
    from: string;
    to: string;
    imergLateMm: number;
    lateFinalRatio: number;
    pctOfNormal: { imergLate: number; imergAdjusted: number; merra2: number };
    verdict: string;
  };
  rootZoneGldasMm: { oct20: number; nov10: number; nov19: number; lostNov10To19: number; smapSpearman: number };
  groundwater: { source: string; trendMmPerYear: number; changeMm: number; period: string };
  winterGreenness: { product: string; early: GreennessPeriod; recent: GreennessPeriod };
  landUse: { year: string; croppingIntensityPct: number; topPattern: string; topPatternPct: number };
  cattlePerKm2: number;
}

export interface PilotAdvisories {
  heatTrends: Array<{ measure: string; mean1991to2005: number; mean2011to2025: number; trendPerDecade: number; kendallP: number }>;
  cattleHeat: Array<{ month: number; meanThi: number; dangerShare: number; emergencyShare: number; nightsWithoutReliefPct: number; coolestHours: string[] }>;
  cattleSource: string;
}

export interface HaorFlashFlood {
  window: [MonthDay, MonthDay];
  sohra: { lat: number; lon: number };
  dharmapasha: { lat: number; lon: number };
  watchMm: number;
  warningMm: number;
  source: string;
  seasons: Array<{ year: number; sohraMax3Mm: number; sohraMax3End: string; label: 'flood' | 'no flood' | 'unlabelled'; first200mm: string | null }>;
  skill: Array<{ thresholdMm: number; floodYearsCaught: string; noFloodYearsFlagged: string; seasonsFlagged: string }>;
  escape: Array<{ variety: string; sowing: string; medianHarvest: string; burstsBeforeHarvest: number; bursts: number; caughtYears: number[] }>;
}

export interface SoilAndProductivity {
  soilCarbonGm2: number;
  soilCarbonTrendGm2PerYear: number;
  dryDaysVsAmanGppRho: number;
  dryDaysVsAmanGppSeasons: number;
  monsoonRainVsAmanGppRho: number;
  source: string;
}

export interface LedgerCheckRow {
  rotation: string;
  pumpedM3PerHa: number;
  floodedRiceDays: number;
  ureaKgHa: number;
  bareDays: number;
}
