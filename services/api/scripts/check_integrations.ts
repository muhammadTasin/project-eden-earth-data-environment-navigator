/**
 * npm run check:integrations
 *
 * For every outside service: whether its settings are SET, and a safe probe (one harmless read or an auth check) as PASS, FAIL or
 * SKIPPED. It never makes a call, sends an SMS, starts a billed speech or text generation, or contacts a phone number. The report
 * never contains a value from .env, a token, a URL with a key in it or a provider's error message (see integrations.ts).
 * Exit code 1 when any probe FAILs.
 */
import { renderReport, runChecks } from '../src/integrations.ts';

const rows = await runChecks();
console.log(renderReport(rows));
process.exitCode = rows.some(row => row.result === 'FAIL') ? 1 : 0;
