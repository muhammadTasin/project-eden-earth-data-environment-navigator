/**
 * Manager (desk) authentication with Supabase Auth.
 *
 *  - The browser signs in with the anon key (public by design) and sends its access token as a Bearer token.
 *  - requireManager() checks that token with supabase.auth.getUser(token), which asks the Auth server (so a revoked
 *    session or a removed role stops working at once) and then requires app_metadata.role === 'manager'.
 *  - Role and site are read from app_metadata only. user_metadata can be edited by the signed-in user and is never used
 *    for authorisation.
 *  - Only SUPABASE_URL and SUPABASE_ANON_KEY are read here. The privileged server key is never used by this project.
 *  - With DEMO_MODE=true the old in-memory demo token is accepted too (officer_desk.ts).
 */
import type http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ApiError } from './errors.ts';
import * as desk from './officer_desk.ts';

export interface AuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Domain the User ID is combined with: `<userId>@<emailDomain>` is the Supabase account email (AUTH_EMAIL_DOMAIN). */
  emailDomain: string;
  demoMode: boolean;
}

/** What the browser needs to sign in. The anon key is public by design; nothing secret is returned. */
export function authConfig(): AuthConfig {
  return {
    supabaseUrl: process.env.SUPABASE_URL?.trim() || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || '',
    emailDomain: (process.env.AUTH_EMAIL_DOMAIN ?? '').trim().toLowerCase().replace(/^@/, ''),
    demoMode: desk.demoEnabled(),
  };
}

let client: SupabaseClient | null | undefined;
function supabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const { supabaseUrl, supabaseAnonKey } = authConfig();
  client = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return client;
}

const SITE_NAMES: Record<string, { bn: string; en: string }> = {
  talanda: { bn: 'তালন্দ ব্লক', en: 'Talanda block' },
};

/** The desk record for a Supabase user, or null when app_metadata.role is not 'manager'. */
export function managerFromUser(user: Pick<User, 'id' | 'email' | 'app_metadata'>): desk.Officer | null {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  if (meta.role !== 'manager') return null;
  const site = typeof meta.site === 'string' ? meta.site : undefined;
  const userId = (user.email ?? '').split('@')[0] || user.id; // the part before the @ is the User ID
  return {
    id: user.id,
    nameBangla: userId,
    nameEnglish: userId,
    blockBangla: site ? SITE_NAMES[site]?.bn ?? site : '',
    blockEnglish: site ? SITE_NAMES[site]?.en ?? site : '',
    site,
  };
}

/** Looks a Bearer token up with Supabase. Returns the user, or null when the token is not valid. */
export type VerifyToken = (token: string) => Promise<Pick<User, 'id' | 'email' | 'app_metadata'> | null>;

const verifyWithSupabase: VerifyToken = async (token) => {
  const supabase = supabaseClient();
  if (!supabase) throw new ApiError('configuration_required', 'Manager sign-in is not configured on this server (SUPABASE_URL, SUPABASE_ANON_KEY)');
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : data.user;
};

/** The site (app_metadata.site, e.g. 'talanda') of the manager behind each request that passed requireManager, for later location filters. */
const siteByRequest = new WeakMap<http.IncomingMessage, string | undefined>();
export function managerSite(req: http.IncomingMessage): string | undefined {
  return siteByRequest.get(req);
}

/**
 * Throws 401 without a valid token and 403 for a valid user who is not a manager; otherwise returns the officer and
 * remembers their site for managerSite(req).
 */
export async function requireManager(req: http.IncomingMessage, verify: VerifyToken = verifyWithSupabase): Promise<desk.Officer> {
  const header = String(req.headers.authorization ?? '');
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? '';
  if (!token) throw new ApiError('unauthorized', 'Manager sign-in required');

  const demoOfficer = desk.officerForToken(header);
  if (demoOfficer) {
    siteByRequest.set(req, demoOfficer.site);
    return demoOfficer;
  }

  const user = await verify(token);
  if (!user) throw new ApiError('unauthorized', 'Manager sign-in required');
  const officer = managerFromUser(user);
  if (!officer) throw new ApiError('forbidden', 'This account is not allowed to use the manager desk');
  siteByRequest.set(req, officer.site);
  return officer;
}
