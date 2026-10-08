/**
 * How much of a district's Boro land would move to a water-saving winter crop to stop its groundwater falling, from
 * NASA GLDAS-2.2 (GRACE-assimilated) storage trends, BBS Boro area and the district replay's net irrigation
 * (research/explore/groundwater_budget.py). A district average at GRACE's scale: Barind wells fall faster, so the
 * area to move is a floor.
 */
import fs from 'node:fs';
import { LOC } from './location.ts';

export interface DistrictBudget {
  trendMmPerYear: number;
  period: string;
  areaHa: number;
  boroHa: number;
  boroYear: string;
  boroShareOfArea: number;
  applies: boolean;
  boroNetIrrigationMm: number;
  lentilNetIrrigationMm: number;
  mustardNetIrrigationMm: number;
  fallM3PerYear: number;
  boroPumpedM3PerYear: number;
  fallShareOfBoroPumping: number | null;
  moveHaToLentil: number | null;
  moveShareToLentil: number | null;
  moveHaToMustard: number | null;
  moveShareToMustard: number | null;
}
interface BudgetFile { source: string; method: string; caution: string; districts: Record<string, DistrictBudget> }

let data: BudgetFile | null = null;
export function groundwaterBudgetData(): BudgetFile {
  if (!data) {
    const file = new URL('./groundwater_budget.json', import.meta.url);
    data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { source: '', method: '', caution: '', districts: {} };
  }
  return data!;
}

/** The current place's district budget, or null. */
export function budgetHere(): (DistrictBudget & { district: string }) | null {
  const district = LOC.district;
  const d = groundwaterBudgetData().districts[district];
  return d ? { ...d, district } : null;
}
