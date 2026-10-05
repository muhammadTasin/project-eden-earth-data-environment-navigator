/** Manager site locations used by site-scoped services. All coordinates come from pilot_sites.csv. */
export interface ManagerSite {
  id: string;
  nameBangla: string;
  nameEnglish: string;
  lat: number;
  lon: number;
}

const ENTRIES: Array<{ aliases: string[]; site: ManagerSite }> = [
  // talanda is the existing app_metadata.site value; RAJ_TANORE is the pilot_sites.csv id.
  { aliases: ['talanda', 'tanore', 'raj_tanore'], site: { id: 'talanda', nameBangla: 'তালন্দ, তানোর', nameEnglish: 'Talanda, Tanore', lat: 24.62, lon: 88.56 } },
  { aliases: ['sun_dharmapasha', 'dharmapasha'], site: { id: 'SUN_DHARMAPASHA', nameBangla: 'ধর্মপাশা', nameEnglish: 'Dharmapasha', lat: 24.89, lon: 91.00 } },
  { aliases: ['khu_batiaghata', 'batiaghata'], site: { id: 'KHU_BATIAGHATA', nameBangla: 'বটিয়াঘাটা', nameEnglish: 'Batiaghata', lat: 22.72, lon: 89.52 } },
  { aliases: ['sir_ullahpara', 'ullahpara'], site: { id: 'SIR_ULLAHPARA', nameBangla: 'উল্লাপাড়া', nameEnglish: 'Ullahpara', lat: 24.32, lon: 89.57 } },
  { aliases: ['ran_mithapukur', 'mithapukur'], site: { id: 'RAN_MITHAPUKUR', nameBangla: 'মিঠাপুকুর', nameEnglish: 'Mithapukur', lat: 25.55, lon: 89.29 } },
];

export const MANAGER_SITES: Readonly<Record<string, ManagerSite>> = Object.freeze(
  Object.fromEntries(ENTRIES.flatMap(({ aliases, site }) => aliases.map(alias => [alias, site]))),
);

export function managerSiteConfig(siteId: string): ManagerSite | undefined {
  return MANAGER_SITES[siteId.trim().toLowerCase()];
}
