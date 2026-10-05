/**
 * The Supabase browser client for officer sign-in.
 *
 * The URL and anon key come from the server (GET /api/v1/auth/config); the anon key is public by design. A privileged
 * server key must never appear in this folder. The client script itself is served by the same server at /vendor/supabase.js.
 * Supabase keeps the session in this browser (and refreshes the access token), so a page refresh stays signed in.
 */

let configPromise = null;
let clientPromise = null;

/** { supabaseUrl, supabaseAnonKey, emailDomain, demoMode }, or null when the server cannot be reached. A failure is not cached. */
export function authConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/v1/auth/config')
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null)
      .then(cfg => {
        if (!cfg) configPromise = null;
        return cfg;
      });
  }
  return configPromise;
}

/** The Supabase client, or null when sign-in is not configured on the server or the client script did not load. */
export function supabaseClient() {
  if (!clientPromise) {
    clientPromise = authConfig().then(cfg => {
      if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey || !window.supabase?.createClient) {
        clientPromise = null;
        return null;
      }
      return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    });
  }
  return clientPromise;
}

/** A User ID as typed: trimmed and lowercased. */
export function normalizeUserId(userId) {
  return String(userId ?? '').trim().toLowerCase();
}

/**
 * The only place that builds an account email: `<userId>@<AUTH_EMAIL_DOMAIN>` (the domain comes from the server's config).
 * Returns null when the User ID is empty or the server has no AUTH_EMAIL_DOMAIN.
 */
export async function toAuthEmail(userId) {
  const id = normalizeUserId(userId);
  const cfg = await authConfig();
  return id && cfg?.emailDomain ? `${id}@${cfg.emailDomain}` : null;
}

/** The current access token (Supabase refreshes it when needed), or null when nobody is signed in. */
export async function accessToken() {
  try {
    const supabase = await supabaseClient();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Ends the Supabase session in this browser (best effort: the local session is cleared even when offline). */
export async function supabaseSignOut() {
  try {
    const supabase = await supabaseClient();
    if (supabase) await supabase.auth.signOut();
  } catch {
    // offline: signOut clears the local session first
  }
}
