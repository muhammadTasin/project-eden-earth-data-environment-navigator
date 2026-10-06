/**
 * Manager authentication: role and site come from app_metadata only, requireManager answers 401 / 403 correctly, and the
 * demo login is closed unless DEMO_MODE=true. Supabase itself is replaced by a stub token check (no network, no keys).
 */
import assert from 'node:assert/strict';
import type http from 'node:http';
import { ApiError } from './services/api/src/errors.ts';

delete process.env.DEMO_MODE;
delete process.env.EDEN_OFFICER_CODE;
const { managerFromUser, managerSite, requireManager, authConfig } = await import('./services/api/src/auth.ts');
const desk = await import('./services/api/src/officer_desk.ts');

console.log('========================================================');
console.log('  MANAGER AUTHENTICATION TEST SUITE                     ');
console.log('========================================================\n');

const user = (extra: Record<string, unknown>) => ({ id: 'u-1', email: 'saao_talanda_01@marvel.com', app_metadata: {}, user_metadata: {}, ...extra }) as any;
const request = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as http.IncomingMessage;
const verifier = (users: Record<string, any>) => async (token: string) => users[token] ?? null;

// TEST 1: role and site are read from app_metadata only
const officer = managerFromUser(user({ app_metadata: { role: 'manager', site: 'talanda' } }));
assert.equal(officer?.site, 'talanda');
assert.equal(officer?.id, 'u-1');
assert.equal(officer?.nameEnglish, 'saao_talanda_01', 'the @domain suffix is dropped from the display name');
assert.equal(managerFromUser(user({})), null, 'no role is not a manager');
assert.equal(managerFromUser(user({ app_metadata: { role: 'farmer' } })), null);
assert.equal(managerFromUser(user({ app_metadata: { role: 'officer' } })), null, 'only the manager role is allowed');
assert.equal(managerFromUser(user({ user_metadata: { role: 'manager', site: 'talanda' } })), null, 'user_metadata can be edited by the user and must never grant the manager role');
assert.equal(managerFromUser(user({ app_metadata: { role: 'manager' }, user_metadata: { site: 'dhaka' } }))?.site, undefined, 'site is not taken from user_metadata either');
console.log('✓ TEST 1 PASSED: role and site come from app_metadata only.');

// TEST 2: requireManager: 401 without or with a bad token, 403 for a non-manager, success sets the site
const users = {
  good: user({ app_metadata: { role: 'manager', site: 'talanda' } }),
  farmer: user({ id: 'u-2', app_metadata: { role: 'farmer' } }),
  sneaky: user({ id: 'u-3', user_metadata: { role: 'manager' } }),
};
const verify = verifier(users);
const status = async (authorization?: string) => {
  try {
    await requireManager(request(authorization), verify);
    return 200;
  } catch (err) {
    assert.ok(err instanceof ApiError, `unexpected error ${err}`);
    return err.status;
  }
};
assert.equal(await status(undefined), 401, 'no Authorization header');
assert.equal(await status('Bearer '), 401, 'empty token');
assert.equal(await status('Basic abc'), 401, 'not a Bearer token');
assert.equal(await status('Bearer nope'), 401, 'a token Supabase does not know');
assert.equal(await status('Bearer farmer'), 403, 'valid user without the manager role');
assert.equal(await status('Bearer sneaky'), 403, 'manager role only in user_metadata');
assert.equal(await status('Bearer good'), 200);
const req = request('Bearer good');
await requireManager(req, verify);
assert.equal(managerSite(req), 'talanda', 'the site is attached to the request');
console.log('✓ TEST 2 PASSED: requireManager answers 401 / 403 / success, and exposes the site.');

// TEST 3: without Supabase configured a real token cannot be checked (503), a missing token is still 401
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
await assert.rejects(requireManager(request('Bearer something')), (e: any) => e instanceof ApiError && e.status === 503);
await assert.rejects(requireManager(request()), (e: any) => e instanceof ApiError && e.status === 401);
delete process.env.AUTH_EMAIL_DOMAIN;
assert.deepEqual(authConfig(), { supabaseUrl: '', supabaseAnonKey: '', emailDomain: '', demoMode: false });
process.env.AUTH_EMAIL_DOMAIN = ' @Marvel.com ';
assert.equal(authConfig().emailDomain, 'marvel.com', 'the domain is trimmed, lowercased and loses a leading @');
delete process.env.AUTH_EMAIL_DOMAIN;
console.log('✓ TEST 3 PASSED: unconfigured server answers 503 for a token and 401 for none.');

// TEST 4: the demo login is closed unless DEMO_MODE=true and a code is set
assert.equal(desk.login('saao_talanda_01', 'talanda-demo'), null, 'no built-in demo password');
assert.equal(desk.login('saao_talanda_01', ''), null);
assert.equal(desk.loginUser({ role: 'officer', officerId: 'saao_talanda_01', accessCode: 'talanda-demo' }), null);
process.env.EDEN_OFFICER_CODE = 'a-code-made-up-by-this-test';
assert.equal(desk.login('saao_talanda_01', 'a-code-made-up-by-this-test'), null, 'a code alone does not open the demo login');
process.env.DEMO_MODE = 'true';
assert.ok(desk.login('saao_talanda_01', 'a-code-made-up-by-this-test'), 'demo login works with DEMO_MODE=true and a code');
assert.equal(desk.login('saao_talanda_01', 'wrong'), null);
delete process.env.EDEN_OFFICER_CODE;
assert.equal(desk.login('saao_talanda_01', ''), null, 'demo mode without a configured code stays closed');
const demoSession = (() => { process.env.EDEN_OFFICER_CODE = 'a-code-made-up-by-this-test'; return desk.login('saao_talanda_01', 'a-code-made-up-by-this-test')!; })();
assert.equal((await requireManager(request(`Bearer ${demoSession.token}`), verify)).id, 'saao_talanda_01', 'the demo token passes requireManager in demo mode');
process.env.DEMO_MODE = 'false';
await assert.rejects(requireManager(request(`Bearer ${demoSession.token}`), verify), (e: any) => e instanceof ApiError && e.status === 401, 'the demo token stops working when demo mode is off');
console.log('✓ TEST 4 PASSED: the demo login works only behind DEMO_MODE=true.\n');

// Sign-in field: the browser helper that turns what was typed into the User ID (apps/saao-dashboard/public/auth-client.js)
const { resolveUserId } = await import('./apps/saao-dashboard/public/auth-client.js');
const domain = 'desk.example.test';
assert.equal(resolveUserId('sentry', domain), 'sentry', 'a plain User ID is used as it is');
assert.equal(resolveUserId('  Sentry ', domain), 'sentry', 'trimmed and lower-cased');
assert.equal(resolveUserId(`sentry@${domain}`, domain), 'sentry', 'an email with the server\'s domain is reduced to its User ID');
assert.equal(resolveUserId(`Sentry@${domain.toUpperCase()}`, domain), 'sentry', 'the domain is compared without case');
assert.equal(resolveUserId(`sentry@${domain}`, `@${domain}`), 'sentry', 'a leading @ in the configured domain is ignored');
assert.equal(resolveUserId('sentry@gmail.com', domain), null, 'any other domain is refused');
assert.equal(resolveUserId(`sentry@${domain}.evil.test`, domain), null, 'a longer domain is refused');
assert.equal(resolveUserId(`a@b@${domain}`, domain), null, 'two @ signs are refused');
assert.equal(resolveUserId(`@${domain}`, domain), null, 'no User ID before the @');
assert.equal(resolveUserId('sentry@', domain), null);
assert.equal(resolveUserId(`sentry@${domain}`, ''), null, 'with no domain configured an email cannot be reduced');
assert.equal(resolveUserId('sen try', domain), null, 'a space is refused');
assert.equal(resolveUserId('', domain), null);
assert.equal(resolveUserId(undefined, domain), null);
console.log('✓ Sign-in field: a plain User ID or an email with the server\'s own domain works; every other form is refused.\n');

console.log('========================================================');
console.log('  ALL MANAGER AUTHENTICATION TESTS PASSED               ');
console.log('========================================================\n');
