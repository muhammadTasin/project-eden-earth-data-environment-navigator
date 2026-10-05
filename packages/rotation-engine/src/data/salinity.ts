/**
 * How much of a crop's yield the upazila's soil salinity leaves. SRDI surveyed the coastal belt in May 2009, when salt
 * peaks before the monsoon washes it out, and gives each saline upazila's cultivated land in five ECe classes (S1 2-4,
 * S2 4.1-8, S3 8.1-12, S4 12.1-16, S5 above 16 dS/m; taken at 3, 6, 10, 14 and 18). FAO-61's salt tolerance (Annex 1,
 * after Maas and Grattan 1999) gives each crop the salinity where its yield starts to fall and how fast it falls:
 * relative yield = 1 - slope x (ECe - threshold). Averaged over the upazila's land, the non-saline part at full
 * yield. Salt counts for winter crops and crops sown before the monsoon, not for Aman or monsoon crops.
 */
import { LOC, listPlaces, profileData } from './location.ts';

/** A winter or pre-monsoon crop keeping less than this share of its yield is left out of a place's own plans. */
export const SALT_LIMIT = 0.5;

export interface SalinityEffect {
  relativeYield: number; // expected share of the crop's yield on the upazila's land
  /**
   * The same against the district's least saline upazila (one SRDI did not list counts as salt-free): a district's
   * BBS yield comes mostly from the land where the crop grows best, so income moves by this factor (at most 1).
   */
  againstDistrict: number;
  halfLossShare: number; // share of the cultivated land where it loses half its yield or more
  salineShare: number;
  strongShare: number; // above 8 dS/m
  rating: string; // FAO-61: S, MS, MT, T
  assumed: boolean; // no FAO-61 threshold for the crop: a class value stands in
}

type Salinity = NonNullable<typeof LOC.local.salinity>;
type Tolerance = { threshold: number; slope: number; rating: string; basis: string };

/** The engine crop id the salt tolerance table uses ('boro_early' stays, 'sunflower_kharif' -> 'sunflower'). */
const toleranceId = (cropId: string) => cropId.replace(/_kharif$/, '');

function relativeYield(sal: Salinity | null | undefined, tol: Tolerance): { y: number; half: number } {
  if (!sal) return { y: 1, half: 0 };
  const classes = profileData().salinityClassesDsM;
  let y = Math.max(0, 1 - sal.salineShare);
  let half = 0;
  sal.classShares.forEach((share, k) => {
    const at = Math.max(0, Math.min(1, 1 - (tol.slope / 100) * Math.max(0, classes[k] - tol.threshold)));
    y += share * at;
    if (at <= 0.5) half += share;
  });
  return { y: Math.min(1, y), half };
}

/** The best relative yield for a crop among the district's upazilas (those SRDI did not list at full yield). */
const districtBest = new Map<string, number>();
function bestInDistrict(district: string, cropId: string, tol: Tolerance): number {
  const key = `${district}|${cropId}`;
  if (!districtBest.has(key)) {
    const ys = listPlaces().filter(p => p.district === district)
      .map(p => relativeYield(profileData().upazilas[p.id]?.salinity, tol).y);
    districtBest.set(key, ys.length ? Math.max(...ys) : 1);
  }
  return districtBest.get(key)!;
}

export function salinityEffect(cropId: string): SalinityEffect | null {
  const sal = LOC.local.salinity;
  const tol = profileData().saltTolerance?.[toleranceId(cropId)];
  if (!sal || !tol) return null;
  const { y, half } = relativeYield(sal, tol);
  const best = bestInDistrict(LOC.district, toleranceId(cropId), tol);
  return {
    relativeYield: Math.round(y * 100) / 100,
    againstDistrict: Math.round(Math.min(1, best > 0 ? y / best : 1) * 100) / 100,
    halfLossShare: Math.round(half * 100) / 100,
    salineShare: sal.salineShare,
    strongShare: sal.strongShare,
    rating: tol.rating,
    assumed: tol.basis !== 'FAO-61 Table A1.1',
  };
}
