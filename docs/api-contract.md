# Project EDEN API contract (v1)

This repository's API is the single source of truth. The website (`apps/saao-dashboard`) and the Android app
(`project-eden-earth-data-environment-navigator`, `apps/farmer-mobile`) both consume exactly these routes. Do not add
a second backend in either client.

Base URL: configurable per client (`window.EDEN_CONFIG.apiBase` in `apps/saao-dashboard/public/config.js`; `eden.baseUrl.*`
Gradle properties on Android). All paths below are relative to it. JSON in/out, UTF-8.

## Conventions

### Errors
Every `/api/*` error has the same envelope:

```json
{ "error": { "code": "invalid_input", "message": "Invalid latitude or longitude", "details": {} }, "status": 400 }
```

| code | HTTP | meaning (what clients show) |
|---|---|---|
| `invalid_input` | 400 (422 for an unmodelled union) | bad parameters/body: ask the user to correct them |
| `unauthorized` | 401 | missing/wrong token or login |
| `not_found` | 404 | unknown id or endpoint |
| `no_data` | 404 | request was valid but there is nothing to show yet (e.g. no advisory produced) |
| `provider_unavailable` | 502 | an upstream provider (Open-Meteo, NASA POWER, TTS, LLM) failed: offer retry |
| `configuration_required` | 503 | feature needs server configuration (Earth Engine, TTS): show "unavailable" |
| `forbidden` | 403 | signed in, but not allowed (e.g. `app_metadata.role` is not `manager`): clients sign the user out |
| `site_required` | 403 | a signed-in manager whose account has no usable `app_metadata.site`: refused, but the session is fine (clients show the message and stay signed in) |
| `internal` | 500 | unexpected |

Network failure (no response at all) is a client-side `offline`/`timeout` state.

### Source labelling
Weather and advisory payloads carry a `source` object (or `kind`) so clients can label data honestly:

```json
{ "provider": "Open-Meteo", "kind": "model_estimate", "live": true, "fetchedAt": "...", "validAt": "2026-10-03T14:00", "note": "..." }
```

`kind` is one of `observed`, `model_estimate` (numerical weather model; Open-Meteo), `satellite_delayed` (NASA POWER, Earth
Engine), `derived` (arithmetic on the above, e.g. THI), `heuristic` (generic guidance). **`live` is never true for NASA POWER
or satellite data.**

### Coordinates
`lat`/`lon` are decimal degrees (WGS84) and must lie inside Bangladesh (lat 20.4–26.8, lon 88.0–92.8) or the API answers
`invalid_input`. There are no default coordinates: a missing `lat`/`lon` is `invalid_input`.

## Routes

### GET `/api/v1/config`
Real capability report (nothing is hardcoded "operational"). Fields: `weatherForecast`, `nasaPower` (with `lastSuccessAt`),
`earthEngine` (`status`: `ready | configuration_required | error`, `reason`, `details`, `setupInstructions`), `llm`
(`status`: `configured | unavailable`), `tts` (same), `mlModels` (all `training_data_unavailable`), `jobs`
(`persistence: "local_file"`, `productionDurable: false`), `writeProtection`. Clients use it to decide which features to
offer (e.g. server TTS vs on-device speech).

### GET `/api/v1/locations`
All 64 districts and 500 upazilas (495 base + 5 recent additions) — the one location list for both clients.

```json
{ "version": "...", "source": "...", "license": "CC BY 4.0", "note": "approximate reference points",
  "districtCount": 64, "upazilaCount": 500,
  "districts": [ { "id": "BD4001", "nameEn": "Bagerhat", "nameBn": "বাগেরহাট",
                   "upazilas": [ { "id": "BD40010008", "nameEn": "Bagerhat Sadar", "nameBn": "বাগেরহাট সদর", "lat": 22.676, "lon": 89.763, "approximate": true } ] } ] }
```
Coordinates are approximate administrative reference points, not farm coordinates. Data file:
`apps/saao-dashboard/public/data/bangladesh-upazilas.json` (add upazilas there; nothing else to change).

### GET `/api/v1/weather/forecast?lat=&lon=`
Open-Meteo **numerical weather-model estimate** for exactly those coordinates (cache key = coordinates, 15 min).

```json
{ "location": {"lat": 23.81, "lon": 90.41}, "source": {...model_estimate...},
  "forecast": { "provider": "Open-Meteo", "timezone": "Asia/Dhaka", "utcOffsetSeconds": 21600, "fetchedAt": "...",
    "current": { "time": "2026-10-03T22:00", "temperatureC": 30.1, "apparentTemperatureC": 35.2|null, "relativeHumidityPct": 63,
                 "precipitationMm": 0|null, "rainMm": 0|null, "windSpeedMs": 2.1|null, "windDirectionDeg": 180|null, "weatherCode": 1|null },
    "hourly": [ { "time": "2026-10-03T22:00", "temperatureC": 27.3|null, "relativeHumidityPct": 92|null, "precipitationProbabilityPct": 6|null,
                  "precipitationMm": 0|null, "rainMm": 0|null, "weatherCode": 0|null } ],
    "daily": [ { "date": "2026-10-03", "weatherCode": 0|null, "temperatureMaxC": 31|null, "temperatureMinC": 25|null, "precipitationMm": 0|null,
                 "rainMm": 0|null, "precipitationProbabilityMaxPct": 10|null, "windSpeedMaxMs": 5|null } ] } }
```
`time` strings are **zone-naive local times**; `utcOffsetSeconds` converts them. Missing provider values are `null` (never
0). Hourly humidity is included so clients can compute hourly THI; hours with a null input must be skipped, not filled.
Errors: `invalid_input` (bad/missing/non-Bangladesh coordinates), `provider_unavailable`.

### GET `/api/v1/weather?lat=&lon=`
NASA POWER **delayed** agroclimatology (≈2–3 day latency; 30-day window ending 2 days ago; 6 h cache per location). Not live,
not a forecast.

```json
{ "location": {"lat":..,"lon":..}, "source": {...satellite_delayed, "live": false...}, "isLive": false,
  "latestObservationDate": "2026-09-30", "windowStart": "...", "windowEnd": "...", "daysWithData": 29,
  "latest": { "date": "...", "t2m": 28.1|null, "t2mMax": ..|null, "t2mMin": ..|null, "rh2m": 80|null, "rainMm": 0|null, "windSpeedMs": 2|null },
  "meanT2mWindow": 28.4|null, "rainWindowMm": 147.5|null, "rainDaysWithData": 29,
  "soilMoisture": { "status": "unavailable", "reason": "..." }, "recentDays": [ ...same shape as latest... ] }
```
SMAP soil moisture is **not** part of this payload. Errors: `invalid_input`, `provider_unavailable`, `no_data`.

### POST `/api/v1/ai/ask`
Rule-based assistant (not an LLM). Body `{ "query": "...", "lat"?: number, "lon"?: number }`. Response
`{ answer, sources[], evidenceLevel: "provider_data" | "reference_card" | "insufficient_evidence", followUpSuggestions[], timestamp }`.
It answers weather questions only with `lat`/`lon` (NASA POWER, labelled delayed), reads the SRDI fertiliser card only within
15 km of Talanda, and otherwise refuses and refers to the local SAAO officer.

### POST `/api/v1/tts`
Body `{ "text": "...", "language": "bn" }` (≤ 2000 chars). Success: `200` with `Content-Type: audio/*` bytes. When no TTS
provider is configured: `503 configuration_required` (clients fall back to on-device speech and tell the user).
Text generation (LLM) and speech are separate capabilities; the LLM never produces audio.

### Cattle AOI pipeline (`/api/v1/cattle/...`)
Mutating routes (POST/DELETE) require `Authorization: Bearer <API_WRITE_TOKEN>` when that variable is set.

- `GET /cattle/readiness` – capability subset of `/config` (earthEngine, weather, mlModels, jobs).
- `GET /cattle/aois`, `GET /cattle/aois/:id` (`{aoi, latestAdvisory}`), `POST /cattle/aois` (GeoJSON Polygon/MultiPolygon, no
  holes, no self-intersection, inside Bangladesh, 50 m²–50 000 ha) → `201 {aoi, job}`, `DELETE /cattle/aois/:id` (also removes its jobs).
  `aoi.nearestUpazila` is the nearest reference point, with `nearestUpazilaDistanceKm`; it is an approximation. `demo: true` marks seeded demo farms.
- `GET /cattle/aois/:id/advisory` → `{advisory}` or `no_data` until a job has completed. See schema below.
- `GET /cattle/jobs[?aoiId=]`, `GET /cattle/jobs/:id`, `POST /cattle/jobs {aoiId, jobType}` → `202 {job}`; `jobType` ∈
  `pipeline_refresh | satellite_extract | weather_refresh | train_model`. `POST /cattle/jobs/:id/retry` re-runs a `failed` or `blocked` job (max 3 attempts).
- `POST /cattle/models/train {target}` → training status (`training_data_unavailable`; no model exists).

**Job** `{ jobId, aoiId, jobType, status, progressPct, stageMessage, stageMessageBangla, errors[], errorCode?, missing[{input,reason}], attempts, maxAttempts, queuedAt, startedAt?, finishedAt?, resultsSummary? }`

| status | meaning |
|---|---|
| `queued` / `running` | in progress |
| `succeeded` | every input was really obtained (`missing` is empty) |
| `partial` | advisory produced but some inputs are missing — `missing[]` lists exactly which (e.g. Earth Engine datasets, NASA POWER) |
| `failed` | a required step failed (`errorCode`: `provider_unavailable`, `timeout`, `interrupted_by_restart`, `internal`); retryable |
| `blocked` | cannot run until configuration or data exists (`configuration_required`, `training_data_unavailable`) |

Jobs run in-process and are stored in a local JSON file: **not production-durable**. A restart marks unfinished jobs
`failed / interrupted_by_restart`.

**Advisory** (evidence kinds are kept apart):

```
measured:  { forecast{source,temperatureC,relativeHumidityPct,apparentTemperatureC}, nasaPower{...}|{status:"unavailable",reason},
             satellite{status: ok|partial|unavailable, features[], unavailable[]} }
derived:   { thi{ current, category(normal|alert|danger|emergency), formula, hourly[{time,temperatureC,relativeHumidityPct,thi,category}],
             hoursMissingInputs, horizonHours, lowestThiHours[]|null, thresholdNote } }
heuristic: { basis, summary{En,Bn}, bullets{En,Bn}[], waterDemand{category,label...}, grazing{suitableNow,rationale...} }
forageStatus, modelStatus (supervisedModelAvailable:false), providerAttributions[]
```
Satellite `features[]` entries exist only for datasets that returned an unmasked real value, with computed
`validPixelCoveragePct`. There is no confidence score. THI categories are generic dairy-cattle cut-offs, not validated for
Bangladeshi cattle. There is no milk-loss, disease or water-volume prediction.

### Other routes (Talanda/Tanore pilot site only)
`GET /overview`, `POST /advice`, `POST /narrate`, `POST /channel-events` (simulated, `simulated: true`, no call is placed),
`GET /haor/flash-flood`, `GET /erosion?river=`, `GET /data-release`, demo auth `POST /auth/login`, `GET /auth/session`,
`POST /auth/logout`, officer desk `GET /officers`, `POST /officer/login`, `GET /officer/desk`, `POST /officer/observations`,
`POST /officer/callbacks/:id/resolve`, `GET /officer/knowledge`, `POST /officer/reset`. These describe one pilot union, not nationwide data.

### Places without an SRDI soil card
Only the Talanda pilot has an SRDI soil card. For every other place (`unionId` an upazila id) the crop calendar and rotation replay are unchanged, but no fertilizer amount is given, so these fields can be `null`:

- `options[].ledger.ureaKgHa` (`number | null`);
- `options[].dimensionDetails.soil.metrics.{srdiSoilType, rabiUreaKgHa, rabiTspKgHa, rabiMopKgHa, rotationUreaKgHa}` and `options[].dimensionDetails.pest.metrics.rotationUreaKgHa`.

Instead the text says "এই এলাকার মাটির কার্ড (SRDI) যোগ করা হয়নি, সার-পরামর্শ দেওয়া যাচ্ছে না" / "This area's soil card (SRDI) has not been added, so fertilizer advice cannot be given": in `farmer_card.season2.fertilizerBangla` (plus `farmer_card.season2.fertilizerEnglish`, present only in this case), in the soil dimension summary and in the fertilizer `stewardship` tip. The pest score has no nitrogen term there, so it is **partial**: `dimensionDetails.pest.metrics.partial === true`, its summary says "আংশিক হিসাব, মাটির কার্ড ছাড়া", and `stale_or_missing_inputs` lists it. A partial score is only ever compared with the other options of the same place, never with the pilot's full score. Tips that cite the SRDI card are left out where there is no card (they carry an internal `needsSoilCard` flag in the catalog; it is not part of the response). The overview of such a place has `context.landTypeBangla`/`landTypeEnglish` and `soilTypeBangla`/`soilTypeEnglish` set to `null`, and `early_warnings`, `soil_carbon`, `recent_farmer_contacts` and `pest_reports` are `null` or empty (they describe the Tanore pilot). Clients must treat these numbers as nullable.

`GET /officer/knowledge` is the pilot's reference (SRDI card, Talanda-point replay, IPM, caveats, haor and cattle tables) and is returned only to a manager whose site is the pilot site; any other manager gets `{ "srdi": null, "noSoilCard": { "bn": "...", "en": "..." } }`.

## Authentication status and planned SMS sign-in contract

**Managers (real):** Supabase Auth. The website signs in with `signInWithPassword` (`<userId>@<AUTH_EMAIL_DOMAIN>` and the password; `GET /auth/config`
returns the public project URL, anon key and email domain) and sends the access token as `Authorization: Bearer ...`. Every `/officer/*` route (and the
real-call routes `/calls/advice`, `/calls/keypad` when `AWAJ_LIVE=1`) verifies it with `supabase.auth.getUser(token)`: **401** for no or an
invalid token, **403** when `app_metadata.role` is not `manager`. Role and `site` come from `app_metadata` only. With `DEMO_MODE=true` the
old demo officer login (`POST /officer/login`, `POST /auth/login` with an access code from `EDEN_OFFICER_CODE`) also works; otherwise it is refused.

`GET /manager/data-sources` (manager token) returns only configuration flags (`earthdataLogin`, `earthdataToken`, `firmsMapKey`, `nasaApiKey`, `adsApiToken`: `set` / `unset`; `offline`: boolean). It never contains a key, token, username or password.

`GET /manager/climate` requires a verified Supabase manager JWT and returns climate indicators only for the site's `app_metadata.site`; `?area=<ADM3 id>` asks for another place's public NASA weather as a comparison (only ids on the server's upazila list, or `talanda_tanore`; anything else is **422**; coordinates always come from the server's data, never the request) and `?refresh=1` downloads again instead of using today's saved copy (at most once a minute per area). The response carries `area { id, nameBangla, nameEnglish, district, isHome }`, `fetchedAt`, `offline` and `liveFetchFailed`. `GET /manager/area` returns the verified `app_metadata.site` as `{ siteId, placeId, nameBangla, nameEnglish, district }`. A site is compared after trimming, lower-casing and resolving its aliases (`Talanda`, ` tanore `, `RAJ_TANORE` are the same site); an unknown site is refused. Configured site ids and aliases map to the five pilot coordinates in `research/sites/pilot_sites.csv`; `talanda` maps to the Tanore point also present in `TANORE_CONDITIONS`. It requests NASA POWER daily `community=AG`, `format=JSON` data for `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN` and `GWETROOT`. `-999` is treated as missing. The response carries each indicator's unit, observation dates, coverage and source (`NASA POWER`), the available data range, and `dataSource` (`live`, `cache` or `fixture`). Rainfall totals require complete 30-day coverage, and the ten-year normal requires all ten complete comparison windows.

The climate endpoint caches provider responses on disk under the ignored `services/api/.data/power-climate-cache/` directory. `OFFLINE=1` makes this endpoint use only a compatible cache or the optional `services/api/fixtures/power-climate-fixture.json`; with neither available it returns `no_data` and explains that an online request is needed to populate the cache. Provider failure without fallback returns `provider_unavailable`. No NASA credentials are required, and no credentials or provider request URLs are returned.

**Farmers (demo only):** `POST /auth/login` accepts demo farmer IDs with PIN `1234`/`0000` (an unknown phone falls back to farmer F01).
Demo tokens are random UUIDs in server memory, never expire and vanish on restart.
**No SMS is sent anywhere and no phone number is verified.** The website's "OTP" step is labelled as a demo sign-in; the Android dialog
pre-fills demo credentials in debug builds only. This is not production authentication; do not host it publicly as is.

**Planned contract (not implemented; needs a provider decision first).** The backend stays the authority for sessions and roles; the
clients never generate or check OTPs.

| Route | Body | Result |
|---|---|---|
| `POST /auth/otp/request` | `{ "phone": "+8801XXXXXXXXX" }` | `202 { requestId, resendAfterSec, expiresInSec }` always the same shape whether or not the number is registered; `429` when rate-limited; `503 configuration_required` with no SMS provider |
| `POST /auth/otp/verify` | `{ requestId, code }` | `200 { accessToken, expiresInSec, refreshToken, user{id, role} }`; `401` on wrong/expired/used code |
| `POST /auth/refresh` | `{ refreshToken }` | new short-lived access token (refresh token rotated) |
| `POST /auth/logout` | refresh token | revokes the session server-side |

Rules: normalise to E.164 on the server (accept `01XXXXXXXXX`, `8801…`, `+8801…`; Bangladesh mobile only); codes expire in about 5 minutes, are
single use, allow ~5 attempts, then lock the request; limit requests per phone and per IP and add bot protection; hash codes and refresh
tokens at rest; never log codes; role comes from the server's user record, never from the request body; protected routes check the bearer
token and role (officer routes are officer-only). Android keeps tokens in Keystore-backed encrypted storage and excludes them from backup;
the website keeps the access token in memory (refresh token in an HttpOnly cookie if both are same-site).

Required decisions and secrets before enabling: the SMS/verification provider, an account with Bangladesh (+880) delivery, sender ID
registration (BTRC rules, to be confirmed with the provider), credentials in server environment variables only, a user store, and a
durable session store. Provider terms, pricing and Bangladesh coverage were **not verified** for this document.

## Required environment variables
See `.env.example` (all server-side; none belong in the website or the Android app).
