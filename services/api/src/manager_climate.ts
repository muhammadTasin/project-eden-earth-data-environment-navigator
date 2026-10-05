import type http from 'node:http';
import { ApiError } from './errors.ts';
import { managerSite, requireManager } from './auth.ts';
import type { VerifyToken } from './auth.ts';
import { getPowerClimate } from './power.ts';
import type { PowerClientOptions, PowerClimateResult } from './power.ts';
import { managerSiteConfig } from './sites.ts';

export interface ManagerClimateOptions {
  verify?: VerifyToken;
  power?: PowerClientOptions;
  loadClimate?: typeof getPowerClimate;
}

/** Site-scoped climate API logic, separated so auth and provider calls can be exercised with mocks. */
export async function managerClimate(req: http.IncomingMessage, options: ManagerClimateOptions = {}): Promise<PowerClimateResult> {
  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]?.trim() ?? '';
  // Demo tokens are not Supabase JWTs and have no app_metadata.site claim.
  if (token.split('.').length !== 3 || token.split('.').some(part => !part)) {
    throw new ApiError('unauthorized', 'A Supabase manager session is required for site climate data');
  }
  await requireManager(req, options.verify);
  const siteId = managerSite(req);
  if (!siteId) throw new ApiError('forbidden', 'This manager account has no site in app_metadata');
  const site = managerSiteConfig(siteId);
  if (!site) throw new ApiError('forbidden', 'Climate data is not configured for this manager site');
  const loadClimate = options.loadClimate ?? getPowerClimate;
  return loadClimate(site, options.power);
}
