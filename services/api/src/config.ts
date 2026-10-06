/**
 * NASA data-source configuration: the one place the server reads these environment variables.
 *
 *  - Everything here is server-side. None of it may reach apps/saao-dashboard/public/ or any API response
 *    (test_config.ts fails if a variable name appears in public/ or in nasaConfigStatus()).
 *  - Values come from .env (git-ignored; copy .env.example). Nothing is read until a function is called, so tests can set variables.
 *  - Keys and tokens are returned only to server code that needs to call the provider. For status, use nasaConfigStatus(): it says
 *    which variables are set and never contains a value.
 *
 * Source: the Space Apps 2026 field guide (Environment variables, Data sources, Challenge 07 Field Shift).
 */

/** Public, non-secret base URLs of the data sources the guide lists. */
export const NASA_ENDPOINTS = {
  earthdataLogin: 'https://urs.earthdata.nasa.gov',
  cmrSearch: 'https://cmr.earthdata.nasa.gov/search',
  harmony: 'https://harmony.earthdata.nasa.gov',
  appeears: 'https://appeears.earthdatacloud.nasa.gov/api',
  firms: 'https://firms.modaps.eosdis.nasa.gov/api',
  power: 'https://power.larc.nasa.gov/api',
  powerDailyPoint: 'https://power.larc.nasa.gov/api/temporal/daily/point',
  apiNasaGov: 'https://api.nasa.gov',
  gibs: 'https://gibs.earthdata.nasa.gov/wmts',
  asf: 'https://api.daac.asf.alaska.edu',
  ads: 'https://api.adsabs.harvard.edu/v1',
} as const;

export interface NasaConfig {
  earthdata: { username: string; password: string; token: string };
  /** FIRMS active-fire MAP_KEY; the key is part of the request URL, so only ever call FIRMS from the server. */
  firmsMapKey: string;
  /** api.nasa.gov key. DEMO_KEY (30 requests/hour, 50/day) when none is set; a registered key allows 1,000/hour. */
  nasaApiKey: string;
  /** NASA ADS bearer token (literature search, citations). */
  adsApiToken: string;
  /** OFFLINE=1: read the cache and fixtures only, never the network (for a demo without wifi). */
  offline: boolean;
  endpoints: typeof NASA_ENDPOINTS;
}

const read = (name: string): string => (process.env[name] ?? '').trim();

export function nasaConfig(): NasaConfig {
  return {
    earthdata: {
      // EDL_USER / EDL_PASS are the guide's names for the same Earthdata Login credentials
      username: read('EARTHDATA_USERNAME') || read('EDL_USER'),
      password: read('EARTHDATA_PASSWORD') || read('EDL_PASS'),
      token: read('EARTHDATA_TOKEN'),
    },
    firmsMapKey: read('FIRMS_MAP_KEY'),
    nasaApiKey: read('NASA_API_KEY') || 'DEMO_KEY',
    adsApiToken: read('ADS_API_TOKEN'),
    offline: read('OFFLINE') === '1',
    endpoints: NASA_ENDPOINTS,
  };
}

export type NasaConfigStatus = Record<'earthdataLogin' | 'earthdataToken' | 'firmsMapKey' | 'nasaApiKey' | 'adsApiToken', 'set' | 'unset'> & { offline: boolean };

/** Which credentials are configured. Never contains a value, so it is safe to log or return. */
export function nasaConfigStatus(): NasaConfigStatus {
  const flag = (value: string): 'set' | 'unset' => (value ? 'set' : 'unset');
  return {
    earthdataLogin: read('EARTHDATA_USERNAME') && read('EARTHDATA_PASSWORD') || read('EDL_USER') && read('EDL_PASS') ? 'set' : 'unset',
    earthdataToken: flag(read('EARTHDATA_TOKEN')),
    firmsMapKey: flag(read('FIRMS_MAP_KEY')),
    nasaApiKey: flag(read('NASA_API_KEY')),
    adsApiToken: flag(read('ADS_API_TOKEN')),
    offline: read('OFFLINE') === '1',
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Integrations: which environment variables belong to which outside service. Names only. The status card, the
// `npm run check:integrations` command and docs/integrations.md all read this one list, and values leave this module only to
// server code that has to call the provider (never into a report, a log line or a response).
// ---------------------------------------------------------------------------------------------------------------------

export const INTEGRATION_ENV = {
  nasaPower: [],
  openMeteo: ['OPEN_METEO_API_KEY'],
  supabase: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AUTH_EMAIL_DOMAIN'],
  awaj: ['AWAJ_API_TOKEN', 'AWAJ_SENDER', 'AWAJ_LIVE', 'AWAJ_VOICE', 'AWAJ_MENU_VOICE', 'AWAJ_SURVEY_TEMPLATE', 'AWAJ_OFFICER_NUMBER', 'AWAJ_WEBHOOK_KEY', 'PUBLIC_BASE_URL', 'AWAJ_BASE_URL'],
  tts: ['TTS_BASE_URL', 'TTS_API_KEY', 'TTS_VOICE'],
  llm: ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_TIMEOUT_MS'],
  earthEngine: ['EE_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS', 'EE_PYTHON', 'EE_WORKER_PATH', 'EE_IMERG_COLLECTION'],
  earthdata: ['EARTHDATA_USERNAME', 'EARTHDATA_PASSWORD', 'EARTHDATA_TOKEN', 'EDL_USER', 'EDL_PASS'],
  firms: ['FIRMS_MAP_KEY'],
  nasaApi: ['NASA_API_KEY'],
  ads: ['ADS_API_TOKEN'],
} as const;

export type IntegrationGroup = keyof typeof INTEGRATION_ENV;

/** The trimmed value of a variable, '' when unset. For server code that calls the provider; never put the result in output. */
export function envValue(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function envIsSet(name: string): boolean {
  return envValue(name) !== '';
}

/** Every group's variables that are set, by name only (the CLI and the status card print provider-level SET/UNSET, never a value). */
export function setVariables(group: IntegrationGroup): string[] {
  return INTEGRATION_ENV[group].filter(envIsSet);
}
