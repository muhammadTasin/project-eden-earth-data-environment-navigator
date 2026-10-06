/**
 * Rebuilds services/api/fixtures/power-climate-fixture.json: about 11 years of real NASA POWER daily data for every manager site in
 * sites.ts, so OFFLINE=1 works on a computer that has never been online. POWER needs no key.
 *
 *   node --experimental-strip-types services/api/scripts/build_power_fixture.ts
 *
 * One request per site. If any site fails nothing is written. Only the 8 parameters the indicators use are kept, rounded to 2 decimals,
 * with -999 kept for missing days (see compactPowerResponse in power.ts).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nasaConfig } from '../src/config.ts';
import { compactPowerResponse, fetchPower, POWER_PARAMETERS } from '../src/power.ts';
import type { CompactPowerFixture } from '../src/power.ts';
import { MANAGER_SITES } from '../src/sites.ts';

const OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/power-climate-fixture.json');
const YEARS = 11;

if (nasaConfig().offline) throw new Error('OFFLINE=1 is set: the fixture can only be rebuilt online.');

const today = new Date();
const start = new Date(Date.UTC(today.getUTCFullYear() - YEARS, today.getUTCMonth(), today.getUTCDate()));
const compactDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '');

const sites = new Map(Object.values(MANAGER_SITES).map(site => [site.id, site]));
const fixture: CompactPowerFixture = { version: 1, parameters: [...POWER_PARAMETERS], generatedAt: today.toISOString(), sites: {} };

for (const site of sites.values()) {
  const url = new URL(nasaConfig().endpoints.powerDailyPoint);
  url.searchParams.set('parameters', POWER_PARAMETERS.join(','));
  url.searchParams.set('community', 'AG');
  url.searchParams.set('longitude', String(site.lon));
  url.searchParams.set('latitude', String(site.lat));
  url.searchParams.set('start', compactDate(start));
  url.searchParams.set('end', compactDate(today));
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('time-standard', 'UTC');
  const response = await fetchPower(url, fetch, 60_000);
  fixture.sites[site.id] = compactPowerResponse(response, site.lat, site.lon);
  console.log(`${site.id}: ${fixture.sites[site.id].from} to ${fixture.sites[site.id].to}`);
}

const json = JSON.stringify(fixture);
await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, json);
console.log(`wrote ${path.relative(process.cwd(), OUTPUT)} (${json.length} bytes, ${sites.size} sites)`);
