/**
 * A manager sees and changes only the officer-desk records of their own site (app_metadata.site).
 * The desk store is a temporary file with two sites; officer_desk.ts reads EDEN_OFFICER_STORE when it is first imported.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-scope-test-'));
const storeFile = path.join(dir, 'officer_store.json');
const farmer = (id: string, site?: string) => ({
  id, nameBangla: id, nameEnglish: `Farmer ${id}`, villageBangla: 'গ্রাম', villageEnglish: `Village ${id}`, phoneMasked: '017XX-XXX00',
  landType: 'medium_high', currentAmanCrop: 'BRRI dhan71', irrigation: 'rainfed', sample: true, ...(site ? { site } : {}),
});
fs.writeFileSync(storeFile, JSON.stringify({
  farmers: [farmer('F01', 'talanda'), farmer('F02' /* written before sites existed */), farmer('H01', 'sun_dharmapasha')],
  observations: [{ id: 'obs_h', farmerId: 'H01', officerId: 'x', date: '2026-09-25T10:00:00.000Z', landType: 'medium_high', currentAmanCrop: 'BRRI dhan71', irrigation: 'rainfed', pestSeen: 'none', pestSeverity: null, priorities: { water: 0.5, income: 0.2, soil: 0.2, pest: 0.1 }, noteBangla: '' }],
  callbacks: [
    { id: 'cb_t', farmerId: 'F01', channel: 'ivr_keypad_9', createdAt: '2026-09-29T08:30:00.000Z', status: 'open' },
    { id: 'cb_h', farmerId: 'H01', channel: 'ivr_keypad_9', createdAt: '2026-09-29T08:31:00.000Z', status: 'open' },
  ],
}));
process.env.EDEN_OFFICER_STORE = storeFile;
const desk = await import('./services/api/src/officer_desk.ts');

console.log('========================================================');
console.log('  MANAGER SITE SCOPE TEST SUITE                         ');
console.log('========================================================\n');

const ids = (list: Array<{ id: string }>) => list.map(item => item.id).sort();
assert.deepEqual(ids(desk.farmers('talanda')), ['F01', 'F02'], 'a record without a site belongs to talanda');
assert.deepEqual(ids(desk.farmers('sun_dharmapasha')), ['H01']);
assert.deepEqual(desk.farmers('khu_batiaghata'), []);
assert.deepEqual(desk.farmers(null), [], 'a manager without a site sees nothing');
assert.equal(desk.farmers().length, 3, 'farmer-facing code without an officer is unchanged');
assert.deepEqual(ids(desk.callbacks('talanda')), ['cb_t']);
assert.deepEqual(ids(desk.callbacks('sun_dharmapasha')), ['cb_h']);
assert.deepEqual(desk.callbacks(null), []);
assert.deepEqual(desk.queue('talanda').map(q => q.farmerId).sort(), ['F01', 'F02']);
assert.deepEqual(desk.queue('sun_dharmapasha').map(q => q.farmerId), ['H01']);
assert.deepEqual(desk.queue(null), []);
console.log('✓ Desk lists: farmers, call-backs and the queue are filtered by the manager\'s own site.');

assert.equal(desk.resolveCallback('cb_h', 'talanda'), null, 'another site\'s call-back is "not found"');
assert.equal(desk.resolveCallback('cb_h', null), null);
assert.equal(desk.callbacks('sun_dharmapasha')[0].status, 'open', 'it was not changed');
const body = { farmerId: 'H01', landType: 'medium_high', currentAmanCrop: 'BRRI dhan71', irrigation: 'rainfed' };
assert.equal(desk.addObservation('officer-t', body, 'talanda').error, 'Unknown farmer', 'cannot write to another site\'s farmer');
assert.equal(desk.addObservation('officer-t', body, null).error, 'Unknown farmer');
assert.equal(desk.addObservation('officer-h', body, 'sun_dharmapasha').error, undefined, 'the owning site can');
assert.equal(desk.resolveCallback('cb_h', 'sun_dharmapasha')?.status, 'done');
console.log('✓ Writes: another site\'s call-back and farmers cannot be resolved or observed.');

desk.resetDesk('talanda');
assert.deepEqual(ids(desk.farmers('talanda')), ['F01', 'F02', 'F03', 'F04'], 'talanda is back to its four seed farmers');
assert.ok(desk.farmers('talanda').every(f => f.site === 'talanda'));
assert.deepEqual(ids(desk.farmers('sun_dharmapasha')), ['H01'], 'resetting one site leaves the others alone');
assert.equal(desk.callbacks('sun_dharmapasha').length, 1);
assert.ok(desk.addObservation('officer-h', body, 'sun_dharmapasha').observation, 'the other site\'s data still works');
console.log('✓ Reset: only the manager\'s own site is reset.');

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n========================================================');
console.log('  ALL MANAGER SITE SCOPE TESTS PASSED                   ');
console.log('========================================================\n');
