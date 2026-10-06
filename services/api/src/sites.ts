/** Manager site locations used by site-scoped services. All coordinates come from pilot_sites.csv. */
import { liveUpazila } from './live.ts';

export interface ManagerSite {
  id: string;
  nameBangla: string;
  nameEnglish: string;
  lat: number;
  lon: number;
  /** The upazila id (ADM3_*) this site sits in; a place picked in the dashboard with this id is the manager's own area. */
  placeId?: string;
  district?: string;
}

const ENTRIES: Array<{ aliases: string[]; site: ManagerSite }> = [
  // talanda is the existing app_metadata.site value; RAJ_TANORE is the pilot_sites.csv id.
  { aliases: ['talanda', 'tanore', 'raj_tanore'], site: { id: 'talanda', nameBangla: 'তালন্দ, তানোর', nameEnglish: 'Talanda, Tanore', lat: 24.62, lon: 88.56, placeId: 'ADM3_Tanore', district: 'Rajshahi' } },
  { aliases: ['sun_dharmapasha', 'dharmapasha'], site: { id: 'SUN_DHARMAPASHA', nameBangla: 'ধর্মপাশা', nameEnglish: 'Dharmapasha', lat: 24.89, lon: 91.00, placeId: 'ADM3_Dharampasha', district: 'Sunamganj' } },
  { aliases: ['khu_batiaghata', 'batiaghata'], site: { id: 'KHU_BATIAGHATA', nameBangla: 'বটিয়াঘাটা', nameEnglish: 'Batiaghata', lat: 22.72, lon: 89.52, placeId: 'ADM3_Batiaghata', district: 'Khulna' } },
  { aliases: ['sir_ullahpara', 'ullahpara'], site: { id: 'SIR_ULLAHPARA', nameBangla: 'উল্লাপাড়া', nameEnglish: 'Ullahpara', lat: 24.32, lon: 89.57, placeId: 'ADM3_UllahPara', district: 'Sirajganj' } },
  { aliases: ['ran_mithapukur', 'mithapukur'], site: { id: 'RAN_MITHAPUKUR', nameBangla: 'মিঠাপুকুর', nameEnglish: 'Mithapukur', lat: 25.55, lon: 89.29, placeId: 'ADM3_MithaPukur', district: 'Rangpur' } },
];

// A null-prototype object: a site such as "constructor" or "__proto__" is not found instead of resolving to an inherited member.
export const MANAGER_SITES: Readonly<Record<string, ManagerSite>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ManagerSite>, Object.fromEntries(ENTRIES.flatMap(({ aliases, site }) => aliases.map(alias => [alias, site])))),
);

/** The one way a site string is turned into a lookup key: trimmed and lower case. Anything that is not a non-empty string gives null. */
function siteKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return key || null;
}

export function managerSiteConfig(siteId: string): ManagerSite | undefined {
  const key = siteKey(siteId);
  return key !== null && Object.hasOwn(MANAGER_SITES, key) ? MANAGER_SITES[key] : undefined;
}

/**
 * The one way a site is written wherever sites are compared (desk records, call-backs, reset, climate, area): trimmed, lower case, and an
 * alias of a known site ("tanore", "RAJ_TANORE") turned into that site's id ("talanda"). An unknown site stays as typed (trimmed, lower
 * case), so it matches only itself; an empty or non-string site is null and matches nothing.
 */
export function normalizeSite(raw: unknown): string | null {
  const key = siteKey(raw);
  if (key === null) return null;
  const known = managerSiteConfig(key);
  return known ? known.id.toLowerCase() : key;
}

/**
 * Any upazila from the daily-update list (544 ids, coordinates from the same boundary data as the dashboard map), as a ManagerSite.
 * Only ids on that list are accepted: the browser never supplies coordinates. The pilot's dashboard id 'talanda_tanore' means ADM3_Tanore.
 * An upazila that is one of the manager sites resolves to that site, so its coordinates and cache are the site's own.
 */
export function areaFor(areaId: string): ManagerSite | undefined {
  const raw = areaId.trim();
  const id = raw === 'talanda_tanore' ? 'ADM3_Tanore' : raw;
  if (!/^ADM3_[A-Za-z0-9_]{1,60}$/.test(id)) return undefined;
  const home = Object.values(MANAGER_SITES).find(site => site.placeId === id);
  if (home) return home;
  const upazila = liveUpazila({ id });
  if (!upazila || upazila.id !== id || !Number.isFinite(upazila.lat) || !Number.isFinite(upazila.lon)) return undefined;
  return { id: upazila.id, nameBangla: upazila.name, nameEnglish: `${upazila.name}, ${upazila.district}`, lat: upazila.lat, lon: upazila.lon, placeId: upazila.id, district: upazila.district };
}
