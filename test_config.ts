/**
 * NASA data-source configuration: read in one place (services/api/src/config.ts), server-side only. No variable name or secret
 * may appear in the website's public/ folder, and the status report never contains a value.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const NAMES = ['EARTHDATA_USERNAME', 'EARTHDATA_PASSWORD', 'EARTHDATA_TOKEN', 'EDL_USER', 'EDL_PASS', 'FIRMS_MAP_KEY', 'NASA_API_KEY', 'ADS_API_TOKEN', 'OFFLINE'];
for (const n of NAMES) delete process.env[n];
const { nasaConfig, nasaConfigStatus } = await import('./services/api/src/config.ts');

console.log('========================================================');
console.log('  NASA DATA-SOURCE CONFIGURATION TEST SUITE             ');
console.log('========================================================\n');

// TEST 1: nothing set: DEMO_KEY internally, online, unset credentials
let c = nasaConfig();
assert.equal(c.nasaApiKey, 'DEMO_KEY');
assert.equal(c.offline, false);
assert.equal(c.firmsMapKey, '');
assert.deepEqual(nasaConfigStatus(), { earthdataLogin: 'unset', earthdataToken: 'unset', firmsMapKey: 'unset', nasaApiKey: 'unset', adsApiToken: 'unset', offline: false });
console.log('✓ TEST 1 PASSED: defaults (DEMO_KEY, online, nothing set).');

// TEST 2: values are read (guide aliases too) and trimmed; the status report never contains them
const secrets = { EDL_USER: 'user-aaa', EDL_PASS: 'pass-bbb', FIRMS_MAP_KEY: ' firms-ccc ', NASA_API_KEY: 'nasa-ddd', ADS_API_TOKEN: 'ads-eee', EARTHDATA_TOKEN: 'tok-fff', OFFLINE: '1' };
Object.assign(process.env, secrets);
c = nasaConfig();
assert.deepEqual([c.earthdata.username, c.earthdata.password, c.firmsMapKey, c.nasaApiKey, c.adsApiToken, c.earthdata.token, c.offline],
  ['user-aaa', 'pass-bbb', 'firms-ccc', 'nasa-ddd', 'ads-eee', 'tok-fff', true]);
process.env.EARTHDATA_USERNAME = 'user-primary';
assert.equal(nasaConfig().earthdata.username, 'user-primary', 'EARTHDATA_USERNAME wins over the EDL_USER alias');
const status = JSON.stringify(nasaConfigStatus());
for (const v of ['user-aaa', 'user-primary', 'pass-bbb', 'firms-ccc', 'nasa-ddd', 'ads-eee', 'tok-fff']) assert.ok(!status.includes(v), 'status must not contain a value');
assert.equal(nasaConfigStatus().nasaApiKey, 'set');
for (const n of NAMES) delete process.env[n];
console.log('✓ TEST 2 PASSED: values and guide aliases are read; the status report holds no secret.');

// TEST 3: nothing in the website folder reads or names these variables, and only config.ts reads them on the server
const root = path.resolve('.');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const pub = walk(path.join(root, 'apps/saao-dashboard/public')).filter(f => /\.(js|html|css|json)$/.test(f));
for (const f of pub) {
  const text = fs.readFileSync(f, 'utf8');
  for (const n of NAMES.filter(n => n !== 'OFFLINE')) assert.ok(!text.includes(n), `${path.relative(root, f)} mentions ${n}`);
  assert.ok(!/process\.env/.test(text), `${path.relative(root, f)} reads process.env`);
}
const readers = walk(path.join(root, 'services/api/src')).filter(f => f.endsWith('.ts') && f.split(path.sep).pop() !== 'config.ts')
  .filter(f => /process\.env\.(EARTHDATA_|EDL_|FIRMS_MAP_KEY|NASA_API_KEY|ADS_API_TOKEN|OFFLINE\b)/.test(fs.readFileSync(f, 'utf8')));
assert.deepEqual(readers, [], 'only config.ts may read the NASA data-source variables');
console.log('✓ TEST 3 PASSED: public/ never names them; only config.ts reads them on the server.\n');

console.log('========================================================');
console.log('  ALL NASA CONFIGURATION TESTS PASSED                   ');
console.log('========================================================\n');
