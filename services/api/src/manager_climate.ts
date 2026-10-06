import type http from 'node:http';
import { ApiError } from './errors.ts';
import { managerSite, requireManager } from './auth.ts';
import type { VerifyToken } from './auth.ts';
import { getPowerClimate } from './power.ts';
import type { PowerClientOptions, PowerClimateResult } from './power.ts';
import { areaFor, managerSiteConfig } from './sites.ts';

export interface ManagerClimateOptions {
  verify?: VerifyToken;
  power?: PowerClientOptions;
  loadClimate?: typeof getPowerClimate;
}

export interface ManagerClimateResult extends PowerClimateResult {
  /** The place the numbers describe. isHome: it is the manager's own site (app_metadata.site). */
  area: { id: string; nameBangla: string; nameEnglish: string; district: string | null; isHome: boolean };
}

/** The manager's verified token, or an ApiError. Demo tokens are not Supabase JWTs and carry no app_metadata.site. */
async function verifiedManagerSite(req: http.IncomingMessage, verify?: VerifyToken) {
  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]?.trim() ?? '';
  if (token.split('.').length !== 3 || token.split('.').some(part => !part)) {
    throw new ApiError('unauthorized', 'A Supabase manager session is required for site climate data');
  }
  await requireManager(req, verify);
  const siteId = managerSite(req);
  if (!siteId) throw new ApiError('site_required', 'This manager account has no site in app_metadata');
  const site = managerSiteConfig(siteId);
  if (!site) throw new ApiError('forbidden', 'Climate data is not configured for this manager site');
  return site;
}

/** The manager's own area: the verified app_metadata.site and the dashboard place id it corresponds to. */
export async function managerArea(req: http.IncomingMessage, verify?: VerifyToken) {
  const site = await verifiedManagerSite(req, verify);
  return {
    siteId: site.id,
    placeId: site.placeId === 'ADM3_Tanore' ? 'talanda_tanore' : site.placeId ?? site.id,
    nameBangla: site.nameBangla,
    nameEnglish: site.nameEnglish,
    district: site.district ?? null,
  };
}

/**
 * Site-scoped climate API logic, separated so auth and provider calls can be exercised with mocks.
 * `?area=<ADM3 id>` asks for another place's public NASA weather (comparison); the id must be on the known upazila list and
 * its coordinates come from the server's own data, never from the request. No `area` means the manager's own site.
 * `?refresh=1` downloads again instead of using today's saved copy.
 */
export async function managerClimate(req: http.IncomingMessage, options: ManagerClimateOptions = {}): Promise<ManagerClimateResult> {
  const home = await verifiedManagerSite(req, options.verify);
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const areaId = query.get('area');
  const area = areaId ? areaFor(areaId) : home;
  if (!area) throw new ApiError('invalid_input', 'Unknown area', undefined, 422);
  const loadClimate = options.loadClimate ?? getPowerClimate;
  const result = await loadClimate(area, { ...options.power, forceRefresh: query.get('refresh') === '1' || options.power?.forceRefresh });
  return {
    ...result,
    area: {
      id: area.id,
      nameBangla: area.nameBangla,
      nameEnglish: area.nameEnglish,
      district: area.district ?? null,
      isHome: area.id === home.id,
    },
  };
}
