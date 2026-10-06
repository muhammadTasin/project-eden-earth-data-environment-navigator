/**
 * The integrations report: what it prints, what it never prints, what it never calls, and that the settings list is complete.
 * A fake value placed in every provider variable must never appear in the report, the status list or a dry-run request.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INTEGRATION_ENV } from './services/api/src/config.ts';

// A fake secret in every variable of every provider. The point of the test is that none of them ever reaches an output.
const names = Object.values(INTEGRATION_ENV).flat();
const FAKE: Record<string, string> = {};
for (const name of names) FAKE[name] = `FAKE-${name}-s3cr3t`;
FAKE.SUPABASE_URL = 'https://fakeproject-s3cr3t.supabase.test';
FAKE.LLM_BASE_URL = 'https://llm-s3cr3t.example.test/v1';
FAKE.TTS_BASE_URL = 'https://tts-s3cr3t.example.test/speak';
FAKE.PUBLIC_BASE_URL = 'https://public-s3cr3t.example.test';
FAKE.AWAJ_BASE_URL = 'https://awaj-s3cr3t.example.test/api';
FAKE.AWAJ_LIVE = '0';
FAKE.OFFLINE = '';
FAKE.AWAJ_SENDER = '01800000999';
FAKE.AWAJ_OFFICER_NUMBER = '01700000888';
for (const [name, value] of Object.entries(FAKE)) process.env[name] = value;
const SECRET_VALUES = Object.entries(FAKE).filter(([name]) => !['AWAJ_LIVE', 'OFFLINE', 'AWAJ_VOICE', 'LLM_TIMEOUT_MS', 'EE_PYTHON', 'EE_WORKER_PATH', 'EE_IMERG_COLLECTION', 'TTS_VOICE', 'AUTH_EMAIL_DOMAIN'].includes(name)).map(([, value]) => value);
const FRAGMENTS = ['s3cr3t', '01800000999', '01700000888'];

const { NOTES, PROVIDERS, integrationStatuses, renderReport, runChecks, setState } = await import('./services/api/src/integrations.ts');
const awaj = await import('./services/api/src/awaj.ts');

console.log('========================================================');
console.log('  INTEGRATIONS REPORT TEST SUITE                        ');
console.log('========================================================\n');

// ---- 1. a fake fetch that echoes the secrets in its answers and in its errors: none of it may reach the report
const calls: Array<{ url: string; method: string }> = [];
let mode: 'echo-ok' | 'echo-error' | 'throws' | 'timeout' = 'echo-ok';
const fakeFetch = (async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, method: String(init?.method ?? 'GET') });
  const echo = JSON.stringify({ properties: {}, current: {}, hello: [url, init?.headers] });
  if (mode === 'throws') throw new Error(`connect failed for ${url} with ${JSON.stringify(init?.headers)}`);
  if (mode === 'timeout') {
    return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error(`aborted ${url}`), { name: 'AbortError' }))));
  }
  return new Response(mode === 'echo-error' ? echo : echo, { status: mode === 'echo-error' ? 500 : 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

const ee = async () => 'ready' as const;
const forbidden = ['/broadcasts', '/surveys', 'direct-tts', 'chat/completions', '/voices/upload', '/calls', 'speak'];
for (const next of ['echo-ok', 'echo-error', 'throws', 'timeout'] as const) {
  mode = next;
  calls.length = 0;
  const rows = await runChecks({ fetchImpl: fakeFetch, offline: false, timeoutMs: 20, eeReadiness: ee, now: new Date() });
  const report = renderReport(rows);
  assert.equal(rows.length, PROVIDERS.length);
  for (const fragment of FRAGMENTS) assert.ok(!report.includes(fragment), `[${next}] the report contains a fake value (${fragment})`);
  for (const value of SECRET_VALUES) assert.ok(!report.includes(value), `[${next}] the report contains ${value}`);
  assert.ok(!/Bearer|api_key|apikey|key=|https?:\/\//i.test(report), `[${next}] the report contains an address or a credential word`);
  for (const row of rows) {
    assert.ok(row.note in NOTES, `[${next}] ${row.id}: the note is from the closed list`);
    assert.ok(['PASS', 'FAIL', 'SKIPPED'].includes(row.result));
  }
  // safe probes only: reads, never a call, an SMS, a speech or text generation, and the only Awaj path is the account balance
  assert.ok(calls.every(call => call.method === 'GET'), `[${next}] every probe is a GET`);
  for (const call of calls) for (const word of forbidden) assert.ok(!call.url.includes(word), `[${next}] a probe touched ${word}`);
  const awajCalls = calls.filter(call => call.url.startsWith(FAKE.AWAJ_BASE_URL));
  assert.ok(awajCalls.every(call => call.url === `${FAKE.AWAJ_BASE_URL}/balance`), 'the only Awaj request is the balance read');
  assert.ok(!calls.some(call => call.url.startsWith(FAKE.TTS_BASE_URL)), 'the TTS endpoint is never contacted (any request may be billed)');
  const outcome = Object.fromEntries(rows.map(row => [row.id, `${row.result}:${row.note}`]));
  if (next === 'echo-ok') {
    assert.equal(outcome['nasa-power'], 'PASS:ok');
    assert.equal(outcome.supabase, 'PASS:ok');
    assert.equal(outcome.awaj, 'PASS:ok');
    assert.equal(outcome.tts, 'SKIPPED:not_probed_cost');
    assert.equal(outcome['earth-engine'], 'PASS:ok');
    assert.equal(outcome.earthdata, 'SKIPPED:not_probed_docs');
  }
  if (next === 'echo-error') assert.equal(outcome['nasa-power'], 'FAIL:http_error');
  if (next === 'throws') assert.equal(outcome.supabase, 'FAIL:network_error');
  if (next === 'timeout') assert.equal(outcome.supabase, 'FAIL:timeout');
}
console.log('✓ Report: with a fake secret in every variable and a provider that echoes it in answers and errors, no value, address or credential word is printed; probes are GET-only and never touch a call, an SMS, TTS or text generation.');

// ---- 2. offline mode never touches the network; unset providers are SKIPPED
calls.length = 0;
const offlineRows = await runChecks({ fetchImpl: fakeFetch, offline: true, eeReadiness: ee, now: new Date() });
assert.equal(calls.length, 0, 'offline: no request');
assert.equal(offlineRows.find(row => row.id === 'nasa-power')!.note, 'offline_mode');
for (const name of names) delete process.env[name];
calls.length = 0;
const unsetRows = await runChecks({ fetchImpl: fakeFetch, offline: false, eeReadiness: ee, now: new Date() });
for (const id of ['supabase', 'awaj', 'tts', 'llm', 'earth-engine', 'earthdata', 'firms', 'nasa-api', 'ads']) {
  const row = unsetRows.find(r => r.id === id)!;
  assert.deepEqual([row.set, row.result, row.note], ['UNSET', 'SKIPPED', 'not_configured'], id);
}
assert.ok(calls.every(call => /power\.larc|open-meteo|gibs\.earthdata/.test(call.url)), 'with nothing set only the three free no-key services are contacted');
console.log('✓ Offline mode uses no network; unset providers are SKIPPED, UNSET and make no request.');

// ---- 3. the four labels
const label = (id: string) => integrationStatuses(false).find(s => s.id === id)!.label;
assert.equal(label('awaj'), 'notset');
assert.equal(label('tts'), 'notset');
assert.equal(label('llm'), 'notset');
assert.equal(label('earth-engine'), 'notset');
assert.equal(label('supabase'), 'notset');
assert.equal(label('nasa-power'), 'live');
assert.equal(integrationStatuses(true).find(s => s.id === 'nasa-power')!.label, 'saved');
assert.equal(label('daily-update-file'), 'saved');
assert.equal(label('release-snapshot'), 'saved');
assert.equal(label('reference-tables'), 'saved');
assert.equal(label('demo-features'), 'demo');
for (const name of ['FIRMS_MAP_KEY', 'NASA_API_KEY', 'ADS_API_TOKEN']) { process.env[name] = 'x'; }
assert.equal(label('firms'), 'notset', 'a stored key with no feature behind it is not "live"');
assert.equal(label('nasa-api'), 'notset');
assert.equal(label('ads'), 'notset');
process.env.AWAJ_API_TOKEN = 'x'; process.env.AWAJ_SENDER = '01800000999';
assert.equal(label('awaj'), 'demo', 'a token without AWAJ_LIVE=1 is a dry run: demo, simulated');
process.env.AWAJ_LIVE = '1';
assert.equal(label('awaj'), 'live');
process.env.EDL_USER = 'u'; process.env.EDL_PASS = 'p';
assert.equal(label('earthdata'), 'saved', 'the Earthdata login is used only by the nightly job');
for (const name of ['FIRMS_MAP_KEY', 'NASA_API_KEY', 'ADS_API_TOKEN', 'AWAJ_API_TOKEN', 'AWAJ_SENDER', 'AWAJ_LIVE', 'EDL_USER', 'EDL_PASS']) delete process.env[name];
for (const status of integrationStatuses(false)) {
  assert.ok(['live', 'saved', 'demo', 'notset'].includes(status.label));
  for (const text of [status.name, status.reason, status.usedBy, status.reality]) assert.ok(text.bn.length > 3 && text.en.length > 3, `${status.id}: text in both languages`);
}
assert.equal(setState(PROVIDERS.find(p => p.id === 'reference-tables')!), 'NOT_APPLICABLE');
assert.equal(setState(PROVIDERS.find(p => p.id === 'nasa-power')!), 'NOT_NEEDED');
console.log('✓ Labels: live, saved, demo or notset for every provider; a dry-run Awaj is "demo", a stored key nobody uses is "notset".');

// ---- 4. the status list holds no value even with every variable set
for (const [name, value] of Object.entries(FAKE)) process.env[name] = value;
const statusText = JSON.stringify(integrationStatuses(false));
for (const fragment of FRAGMENTS) assert.ok(!statusText.includes(fragment), 'the status list contains a fake value');
console.log('✓ The status list contains no value.');

// ---- 5. the call provider's dry runs and manager status show no key, address with a key, or configured number
const shownRequests = JSON.stringify([
  await awaj.sendKeypadSurvey({ phoneNumbers: ['01712345678'], questionVoice: 'menu', options: [{ key: '1' }], officerKey: '9', officerNumber: '01700000888', webhookUrl: `${FAKE.PUBLIC_BASE_URL}/api/v1/calls/survey-webhook?key=${FAKE.AWAJ_WEBHOOK_KEY}`, metadata: {} }),
  await awaj.sendTtsCall({ phoneNumbers: ['01712345678'], texts: ['hello'] }),
  await awaj.sendTemplateSurvey({ phoneNumbers: ['01712345678'], templateName: 't', webhookUrl: `${FAKE.PUBLIC_BASE_URL}/x?key=${FAKE.AWAJ_WEBHOOK_KEY}` }),
  await awaj.sendTtsCall({ phoneNumbers: ['not a number'], texts: ['hello'] }),
  awaj.awajPublicStatus(),
]);
for (const secret of [FAKE.AWAJ_WEBHOOK_KEY, FAKE.AWAJ_API_TOKEN, FAKE.AWAJ_SENDER, FAKE.AWAJ_OFFICER_NUMBER]) assert.ok(!shownRequests.includes(secret), `a dry run or the manager status shows ${secret}`);
assert.ok(shownRequests.includes('<AWAJ_SENDER>') && shownRequests.includes('<AWAJ_WEBHOOK_KEY>'), 'the dry run still shows the shape of the request, with placeholders');
assert.ok(shownRequests.includes('01712345678'), 'the farmer\'s own number the caller supplied is shown');
console.log('✓ Awaj dry runs and the manager call status show placeholders, never the sender, officer number or webhook key.');

// ---- 6. every variable the code reads, and every integration variable, is in .env.example and in docs/integrations.md
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? (entry.name === 'node_modules' ? [] : walk(path.join(dir, entry.name))) : [path.join(dir, entry.name)]));
const sources = [...walk('services/api/src'), ...walk('services/api/scripts'), ...walk('packages')].filter(file => /\.ts$/.test(file) && !/\/data\//.test(file));
const used = new Set<string>();
for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|\benv\.([A-Z][A-Z0-9_]{3,})|\bread\('([A-Z][A-Z0-9_]+)'\)|\benv(?:Value|IsSet)\('([A-Z][A-Z0-9_]+)'\)/g)) used.add(match[1] ?? match[2] ?? match[3] ?? match[4]);
}
const example = fs.readFileSync('.env.example', 'utf8');
const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(match => match[1]));
const missing = [...used, ...names].filter(name => !documented.has(name));
assert.deepEqual([...new Set(missing)], [], `variables the code reads that .env.example does not list: ${[...new Set(missing)].join(', ')}`);
const placeholders = example.split('\n').filter(line => /^[A-Z][A-Z0-9_]+=\S/.test(line) && !/^(PORT|AWAJ_VOICE|AWAJ_LIVE|DEMO_MODE|SEED_DEMO_DATA|LLM_TIMEOUT_MS|CATTLE_JOB_TIMEOUT_MS|EE_IMERG_COLLECTION|OFFLINE)=/.test(line));
assert.deepEqual(placeholders, [], `.env.example holds a value that is not a placeholder: ${placeholders.map(line => line.split('=')[0]).join(', ')}`);
const docs = fs.readFileSync('docs/integrations.md', 'utf8');
for (const provider of PROVIDERS) assert.ok(docs.includes(`\`${provider.id}\``), `docs/integrations.md does not list ${provider.id}`);
for (const name of names) assert.ok(docs.includes(name), `docs/integrations.md does not name ${name}`);
console.log(`✓ Settings: all ${used.size} variables the code reads and all ${names.length} integration variables are in .env.example (placeholders only) and in docs/integrations.md.\n`);

console.log('========================================================');
console.log('  ALL INTEGRATIONS REPORT TESTS PASSED                  ');
console.log('========================================================\n');
