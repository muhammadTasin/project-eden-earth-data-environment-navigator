# Project EDEN — Earth Data & Environment Navigator

**NASA Space Apps Challenge 2026 · Team WinR · Challenge 07: Field Shift**

EDEN is a Bangla-first crop-rotation decision-support system for Bangladesh. Its farmer-facing service is **মাঠের কথা · Mather Kotha** ("the field's words"): before the Rabi season the farmer's phone rings, and a Bangla call names the two best rotations for their land, water, cattle and priorities, with 25 seasons of NASA Earth observations behind them. Agricultural officers (SAAOs) work from a desktop dashboard, and farmers with smartphones can use the Android app. Every number traces back to the research data in this repository.

## Project status (4 October 2026)

Branch `sync/all-latest` holds all of the team's work up to 2 October, including Rayyanul's Android fixes (PR #3), ready to merge into `main`. Branch `feature/crop-choice-and-calls` adds the farmer's own crop choice and the phone channel on top of it (see [Branches](#branches)):

| Part | Folder | What works |
|---|---|---|
| Research and data | `research/` | NASA and local datasets with their checks, the 25-season replay for the Tanore pilot, signals for five pilots, and the generator for the app's data release |
| Rotation engine | `packages/rotation-engine/` | 5 rotations replayed through 25 seasons, 7 scores. The Talanda pilot uses data release `tanore-2026.09.30` (research commit `0469020`); every other upazila uses its district's replay (`national_replay.json`). With the farmer's crops named, it plans the whole year around them from 16 crops (`crop_choice_replay.json`) |
| API | `services/api/` | Advice, checked Bangla narration, keypad events, Krishi officer desk, early warnings, NASA POWER weather, river erosion, the evidence-only assistant, sign-in, the farmer's crop choice, a Bangla request reader, and phone calls through Awaj Digital (dry runs until switched on) |
| SAAO dashboard | `apps/saao-dashboard/` | Any of the 544 upazilas, Bangla and English, officer desk, less-pesticide (IPM) tab, early warnings with today's haor reading, environment ledger, daily NASA conditions |
| Android app | `apps/farmer-mobile/` | Farmer card synced from the API with an offline cache, weather, river erosion, assistant, sign-in, farm profile editing |
| Screen designs | `design/` | Six SAAO desktop screens and the portrait mobile companion |
| Daily NASA update | `research/live/` | NASA POWER every day for all 544 upazilas (64 districts), GPM IMERG rain at 10 km with an Earthdata Login, and the live haor flash-flood check with the MODIS flood map |

The dashboard advises any of the 544 upazilas (pick the district and upazila at the top of the overview); Talanda union (Tanore) remains the most detailed pilot. Sample farmers, the farm profile and the income scores are sample values and are labelled as such on screen. The story site that presents the project lives in its own repository, [Mati-Kohon](https://github.com/Tasrif-Ahmed-Mohsin/Mati-Kohon). Changes are listed, newest first, in [`CHANGELOG.md`](CHANGELOG.md).

## Run it

```bash
npm install
npm test          # 13 engine tests and every API check
npm start         # API and SAAO dashboard on http://localhost:4000
npm run call:test -- --to 01XXXXXXXXX --crops sunflower,lentil   # the Bangla call script; a dry run until Awaj is set up
```

- **Place:** pick a district and upazila at the top of the overview; the advice, replay, alerts and rain follow it, and the browser remembers it. Rajshahi → Tanore is the detailed Talanda pilot.

- **Language:** the বাংলা / EN buttons in the dashboard header switch every text; the browser remembers the choice.
- **Krishi officer desk:** tab ৬ / 6, demo access code `talanda-demo` (set `EDEN_OFFICER_CODE` to change it). **Restore sample data** resets the sample farmers before a recording.
- **Farmer sign-in (app):** a farmer ID or phone number with the demo PIN `1234`. Both sign-ins are demo gates, not real authentication.
- **Weather:** `/api/v1/weather` fetches NASA POWER over the internet and caches it; offline, it serves a fixed baseline marked as not live.
- **Android app:** build steps and screens are in [`apps/farmer-mobile/README.md`](apps/farmer-mobile/README.md). The emulator reaches the API at `http://10.0.2.2:4000`; run its unit tests with `./gradlew test` in `apps/farmer-mobile`.

### Every upazila

`python research/explore/national_replay.py` runs the Tanore replay's method (FAO-56 water balance, BRRI and BARI calendars, heat at flowering and grain filling) at each of the 64 districts' NASA POWER and GPM IMERG point for 2001–2025, with temperatures corrected against the nearest BMD station within 100 km, and writes `packages/rotation-engine/src/data/national_replay.json`. `packages/rotation-engine/src/data/location.ts` points the engine at the chosen place: the Talanda pilot, or an upazila using its district's replay. At Rajshahi district it reproduces Tanore's research figures closely (BRRI dhan71: 7 of 25 rescue seasons; Boro 790 mm against 797 mm).

Where a place has no data yet, the dashboard says so instead of borrowing Tanore's: SMAP soil moisture, MODIS greenness and land use are pilot-only so far; fertilizer doses use the SRDI Talanda card until each upazila's card is added; upazila names are in English. `GET /api/v1/places` lists the places, `GET /api/v1/overview?place=<id>` and `POST /api/v1/advice` with `unionId: <id>` follow the choice.

### The farmer's own crops

The five fixed rotations always end with lentil on top, because lentil needs the least water. Now the farmer (or the officer for them) names the crops they want, and the engine plans the year around them: Aman, a winter (Rabi) crop, and optionally a pre-monsoon (Kharif-1) crop before the next Aman.

- **16 crops.** Winter: lentil, mustard, wheat, Boro (their research-release records), potato, maize, sunflower, chickpea, grass pea, sweet potato, barley and soybean. Before Aman: mungbean, sesame, Aus rice and summer sunflower. Groups work too ("ডাল" means the best pulse). Jute, onion, garlic, groundnut and vegetables are recognised and reported as not modelled yet.
- **From NASA data, per place.** `python research/explore/crop_choice_replay.py` replays each crop at the Talanda pilot and all 64 district points (NASA POWER ET0 with BMD-corrected temperatures, GPM IMERG rain, FAO-56 crop coefficients, BARI/BRRI/BBS calendars, 2001–2025), sowing on every 10th day of its window, and writes `packages/rotation-engine/src/data/crop_choice_replay.json`: net irrigation (median and p10–p90), crop water use and hot days at the sensitive stage. Fertilizer comes from the SRDI Talanda card (barley and soybean from the BARI handbook).
- **The calendar decides what fits.** A winter crop starts on the first replayed date after its Aman frees the field and before the handbook deadline (grass pea goes in 15 days before the Aman harvest, as a relay crop). A Kharif-1 crop starts a week after the winter harvest and must leave the field a week before the next Aman is transplanted. Every Aman variety is tried.
- **Ranking.** Plans holding more of the named crops come first, then the farmer's weighted score; the response says when growing both crops in one year costs score (for example, summer sunflower meets June heat). If two named crops are both winter crops, the advice says so and suggests splitting the field or alternating years. It also lists the summer crops that fit the gap after the winter harvest.
- **Where.** `POST /api/v1/advice` with `preferredCrops: ["sunflower", "lentil"]`; `GET /api/v1/crops?place=<id>` lists every crop with the Aman varieties it fits after and its irrigation need there. In the dashboard planner, tick the crops under "কৃষক কোন ফসল করতে চান?". Without named crops the five fixed rotations are unchanged.

Scores stay honest about gaps: crops without price and cost data keep a neutral income score (potato, maize and Aus use the research net returns in `research/crops/crop_parameters.csv`), and heat limits not in that table (potato 30 °C, maize and chickpea 35 °C, mungbean and sesame 40 °C, sunflower and soybean 35 °C, barley 30 °C) are literature values marked as assumed.

### Phone calls and the farmer's voice (Awaj Digital)

`services/api/src/awaj.ts` speaks to Awaj Digital's API (https://awajdigital.com/api-docs). Awaj reads Bangla text aloud (`POST /broadcasts/direct-tts`, `language_code: bn-BD`), runs keypad surveys (keys 1–9, the pressed keys come back by webhook) and records calls that officers place from its call-centre widget. It does not turn a farmer's speech into text, so listening works in three ways:

1. **Keypad, now (Awaj survey).** The farmer presses a key per crop (`GET /api/v1/crops` returns the menu: 1 lentil, 2 mustard, 3 wheat, 4 potato, 5 maize, 6 sunflower, 7 mungbean, 8 Boro, 9 officer). Awaj posts the keys to `POST /api/v1/calls/survey-webhook`, which plans for those crops and calls the farmer back with the Bangla answer. Surveys play recorded prompts, so record `keypad.promptBangla` and upload it as an Awaj voice.
2. **Speech to text, then the same engine.** Any speech-to-text that handles Bangla gives a sentence; `POST /api/v1/voice/answer` reads the crops, exclusions ("বোরো করব না"), land type and priorities from it (`packages/rotation-engine/src/understand.ts`, rule-based so an officer can see why) and returns the call script and SMS. The dashboard's delivery screen does this with the browser's microphone (Chrome's Bangla speech recognition). For phone calls, the speech must be recorded first: officer calls through Awaj's call-centre widget come with a recording URL, or a provider whose IVR records a spoken answer, and the recording goes to a speech-to-text service.
3. **A conversational AI voice line, later.** Real-time speech needs a telephony provider that streams call audio (a SIP line with Asterisk or FreeSWITCH, or a cloud provider with media streams), streaming Bangla speech-to-text and text-to-speech; the engine still decides, and any model wording passes the narration gates.

Calls stay dry runs (they return the exact request) until `.env` has `AWAJ_API_TOKEN`, `AWAJ_SENDER` and `AWAJ_LIVE=1` (see `.env.example`); with live calls on, `POST /api/v1/calls/advice` needs an officer sign-in. `npm run call:test -- --to 01XXXXXXXXX --place ADM3_Godagari --text "আমি সূর্যমুখী আর মসুর করতে চাই"` prints the script and, with `--live`, places one call and prints Awaj's per-number result.

### Daily NASA update (all 544 upazilas)

```bash
python research/acquire/imerg_nrt.py --days 10   # optional: GPM IMERG rain, needs an Earthdata Login in .env
python research/live/daily_update.py            # NASA POWER for every upazila, no login
```

The script writes `services/api/data/live/upazila_conditions.json`: for each upazila, rain (1, 7 and 30 days, and 30-day rain against the same dates in 2016–2025), maximum and minimum temperature, days at 35 °C or more, root-zone and surface soil wetness, and IMERG rain over 1, 3 and 7 days, each with its date. NASA POWER is about 3 days behind and IMERG 1 to 2 days. The dashboard overview shows it for any district and upazila, and `/api/v1/live/*` serves it.

The same run reads the **live haor flash-flood check**: the last 3 days of IMERG rain at Sohra, scaled up because IMERG's quick runs read about 9% below the final run there, against the levels tested on 25 springs (200 mm watch, 250 mm warning, 15 March to 15 May); the Jaintia Hills, Garo Hills and Barak valley, which feed the other haor districts, shown without tested levels yet; and NASA's MODIS flood map (3-day composite on GIBS, no login) for the haor basin: unusual flood water, seasonal flood water and cloud. `/api/v1/haor/flash-flood` and the overview's early warnings carry it as `live`, and the dashboard's flash-flood card shows it. River gauges must still confirm before any call goes out.

The dry and wet labels are provisional: POWER's newest weeks come from near-real-time inputs that read drier than the reprocessed archive, so they wait for the SMAP check (next step).

`.github/workflows/daily-nasa-update.yml` runs this every morning at 09:30 Bangladesh time and commits the file when it changes. GitHub runs scheduled workflows only from `main`. For IMERG, add the repository secrets `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD` (Settings → Secrets and variables → Actions); without them only POWER updates.

A two-minute dashboard walkthrough for a demo video:

1. **Overview (১):** dated NASA values (SMAP root zone, 30-day IMERG rain checked against MERRA-2, GRACE-based groundwater, MODIS winter greenness), the early warnings (haor flash floods, warm nights, cattle heat) and field pest reports.
2. **Planner (২):** set "Aman in the field this season" to BRRI dhan49 and run. Lentil and mustard miss their 14–15 November deadlines, and dhan49 → wheat is tagged as possible this season. Then tick সূর্যমুখী and মসুর under the farmer's crops and run again: lentil in winter with summer sunflower before Aman, or each alone, with notes on what fits.
3. **Comparison (৩):** seven scored dimensions, each with its reason and a `sample` or `assumed` tag where the data is weak.
4. **Environment and less pesticide (৫):** the recommended rotation against the usual Boro rotation, the environment ledger, and sourced IPM steps.
5. **Officer desk (৬):** sign in, open the most urgent farmer, record a field observation, and watch that farmer's advice and queue position update.
6. **Call delivery (৮):** press keypad 1 (water) and mustard moves to the top; press 9 and the call-back request lands on the officer desk. Below it, type or speak "আমি সূর্যমুখী আর মসুর করতে চাই": the crops are read, the year is planned, and the Bangla call script and SMS appear.
7. Switch to **EN** at any point; the Bangla voice script gets an English translation underneath.

## Architecture

The Android farmer app and the SAAO desktop dashboard use one API. Crop scoring stays deterministic and testable; language tools can help explain a recommendation, but they never decide the score.

```mermaid
flowchart LR
  Farmer["Farmer Android app<br/>Kotlin + Jetpack Compose"] <--> API[Shared API]
  Officer[SAAO desktop dashboard] <--> API
  API <--> Engine[Deterministic rotation engine]
  API <--> Narration[Validated narration service]
  Narration <--> Providers["Provider interface<br/>Rules · local model · remote model"]
  API <--> Sources[Curated data + source adapters]
  Farmer <--> Room["Room cache<br/>offline access"]
```

### Repository layout

```text
apps/
  saao-dashboard/       SAAO officers' desktop web app
  farmer-mobile/        Native Android app; Kotlin + Jetpack Compose
services/
  api/                  Shared API used by both apps
packages/
  contracts/            Shared API and domain types
  rotation-engine/      Deterministic crop scoring and historical replay
  narration-core/       Advice narration and output validation
research/               Data sources, acquisition and analysis scripts, curated tables, the data-release generator
design/                 Screen designs, previews and design notes
raw, collected datas/   Links to raw source material
test_pipeline.ts        Engine tests
test_server.js          API tests
```

The TypeScript API and shared packages use npm workspaces; the Android app has its own Gradle/Kotlin build under `apps/farmer-mobile/` and is not an npm package.

### Boundaries and design rules

- **Android:** Kotlin, Jetpack Compose, ViewModels for screen state, Room for cached farm data and advice. The app stays useful offline and shows when cached information was last updated.
- **Dashboard:** calls the shared API instead of duplicating recommendation logic.
- **API:** validates requests, coordinates data and domain services, and returns versioned responses described by `packages/contracts/`.
- **Recommendations:** `packages/rotation-engine/` owns deterministic scoring and replay. Keep scoring rules out of app code and model prompts.
- **Narration and models:** `packages/narration-core/` validates advice. Rules-based, local-model and remote-model providers sit behind one replaceable interface; a model may explain validated results but must not change scores or invent evidence.
- **Research and provenance:** acquisition scripts, source notes and curated data stay in `research/`, with source and update metadata, so every recommendation can be traced to its evidence.
- **Feature growth:** screens and feature-specific behaviour go in the relevant app, reusable domain logic in packages, backend capabilities behind the API.

### Where new code and data go

- SAAO dashboard UI and browser behaviour: `apps/saao-dashboard/`.
- Farmer-facing Android UI, navigation and device behaviour: `apps/farmer-mobile/`, with screen state in ViewModels and immutable UI state for Compose. Read cached advice and farm data from Room, show when it was last updated, and sync when connectivity allows.
- HTTP endpoints and server-side orchestration: `services/api/`. Shared request and response types: `packages/contracts/`.
- Generated advice wording and its validation: `packages/narration-core/`.
- Data acquisition and analysis scripts, source notes, provenance and small curated tables: `research/`. The downloaded cache under `research/data/` is ignored by Git; rebuild it with the scripts in `research/acquire/`.
- Stitch exports, screen previews and design notes: `design/`. Production UI code belongs in the relevant app.

Do not commit secrets, local environment files, dependency folders, generated APK/AAB files or real farmer personal information.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/overview` | Dated research conditions, alerts, sample farmer rows, union pest reports, `early_warnings` (haor, warm nights, cattle heat) and `soil_carbon` |
| POST | `/api/v1/advice` | Ranked rotations; `farmerId` applies that farmer's officer observation; `currentAmanCrop` adds the this-season check; `preferredCrops` plans the year around the farmer's crops (`crop_choice` in the response); 422 for unions without research data |
| POST | `/api/v1/narrate` | Checked Bangla script, with `englishGloss`, for one option |
| POST | `/api/v1/channel-events` | Simulated IVR keypad: 1–4 re-rank by priority, 9 creates an officer call-back |
| GET | `/api/v1/data-release` | Datasets, periods, calibration and status |
| GET | `/api/v1/haor/flash-flood` | Haor flash-flood trigger: Sohra thresholds, 25-season hindcast, Boro variety escape, the season status and `live` (today's upstream IMERG rain and the MODIS flood map) |
| GET | `/api/v1/weather` | NASA POWER daily agroclimatology and SMAP root-zone moisture for the pilot, fetched live and cached; observations, not a forecast |
| GET | `/api/v1/erosion` | Riverbank erosion risk for the Jamuna corridor from BWDB/FFWC station records and IMERG basin rain |
| POST | `/api/v1/ai/ask` | Bangla assistant that answers only from the project's evidence and refuses out-of-scope questions such as loans or pesticide brands; rules-based, with no outside AI service |
| POST | `/api/v1/auth/login` | Officer (access code) or farmer (ID or phone and PIN) sign-in, returns a session token |
| GET | `/api/v1/auth/session` | The signed-in user for a Bearer token |
| POST | `/api/v1/auth/logout` | Ends the session |
| GET | `/api/v1/live/status` | The daily NASA update: when it ran, each source's latest date and age, and the method |
| GET | `/api/v1/live/upazilas?district=` | Compact daily conditions for every upazila, or one district's |
| GET | `/api/v1/live/upazila?id=` / `?name=` / `?lat=&lon=` | Full daily conditions for one upazila, or the nearest to a point |
| GET | `/api/v1/places` | The pilot and all 544 upazilas the engine can advise |
| GET | `/api/v1/crops?place=` | The crops a farmer can name, where each fits after Aman and its irrigation need there, and the keypad menu |
| POST | `/api/v1/voice/understand` | `{ text }`: the crops, exclusions, land type and priorities in a Bangla, Banglish or English sentence |
| POST | `/api/v1/voice/answer` | `{ text, unionId }`: the plan for that sentence, with the Bangla call script and SMS |
| GET | `/api/v1/calls/status` | Whether Awaj calls are live or dry runs, and the keypad menu |
| POST | `/api/v1/calls/advice` | `{ phone, unionId, text or preferredCrops }`: reads the advice to a phone through Awaj (officer sign-in when live) |
| POST | `/api/v1/calls/survey-webhook` | Awaj keypad-survey results: keys to crops, then a call-back with the plan; optional `?key=` secret |
| GET | `/api/v1/officer/calls` | Recent phone-channel events, numbers masked (Bearer token) |
| GET | `/api/v1/officers` | Officers who can sign in to the desk (no secrets) |
| POST | `/api/v1/officer/login` | `{ officerId, accessCode }`, returns a desk session token |
| GET | `/api/v1/officer/desk` | Queue, farmer register, observations and call-backs (Bearer token) |
| POST | `/api/v1/officer/observations` | Saves a field observation and returns the farmer's updated advice |
| POST | `/api/v1/officer/callbacks/:id/resolve` | Marks a call-back done |
| GET | `/api/v1/officer/knowledge` | Officer reference pack |
| POST | `/api/v1/officer/reset` | Restores the sample farmers (demo) |

## Tests

`npm test` runs `test_pipeline.ts` (engine) and `test_server.js` (API). They check:

- the ranking, feature flags and narration gates (a fake model that invents "১২ টন" and a loan offer falls back to the template);
- that Boro is scored with Boro data, that unions without data are refused and that a stated priority leads the ranking;
- that the Android offline seed matches the engine, and that the environment ledger matches the research ledger;
- the pest score and the English fields;
- the early warnings and the 25-season haor hindcast;
- officer sign-in, queue order, observation priority, the note filter, keypad-9 call-backs and the reference pack;
- that every dashboard text has an English translation;
- NASA POWER weather, river erosion, the farmer sign-in lifecycle and the assistant's grounded answers and refusals;
- plans built around named crops (every option holds them, the calendar fits, a summer crop alone follows the best winter crop, the default five rotations are unchanged), the Bangla request reader, the crop menu, a spoken request answered, and Awaj calls and keypad answers as dry runs (the test server forces `AWAJ_LIVE=0`).

Online, the weather check reads NASA POWER live; offline, the API serves a fixed baseline marked `isLive: false`, so the tests also pass without internet.

### How to…

- **Add or change a dashboard text:** write the Bangla in `index.html` with a new `data-i18n="section.key"`, then add the English under the same key in `i18n.js`. The test lists anything missing.
- **Update the numbers:** re-run the generator (next section), then `npm test`. If TEST 9 fails, refresh the Android seed (`AdviceModels.kt`) from the engine's `farmer_card`.
- **Add a scoring dimension:** write a plugin in `packages/rotation-engine/src/plugins/`, register it in `registry.ts`, add its name to `DIMENSIONS` in `app.js`, and add a bar colour in `styles.css`.
- **Change the officer access code:** set `EDEN_OFFICER_CODE` before `npm start`.

## Research

The research behind every score lives in [`research/`](research/README.md): every dataset, how it was checked, and what is still missing.

What it shows so far:

- **One seed choice changes the year (Tanore).** BRRI dhan71 frees the field by 10 November, in time for lentil or mustard; BRRI dhan49 by 19 November, too late. Winter irrigation in a median season: Boro 797 mm, wheat 198, lentil 199, mustard 114 (FAO-56 water balance on 25 winters of NASA POWER and GPM IMERG).
- **The water is going.** GRACE/GRACE-FO: Bangladesh's stored water falls 0.40 cm a year. GLDAS-2.2: groundwater under Tanore fell 147 mm between 2003–07 and 2021–25; it fell in all 64 districts, significantly in 50, fastest in the north-west.
- **Early Boro escapes the haor's flash floods.** IMERG rain of 200 mm or more in 3 days at Sohra, upstream in Meghalaya, flags the big flood springs (2004, 2010, 2017). BRRI dhan28 was still in the field for 4 of the 5 bursts of 250 mm or more; the other five Boro varieties for at most one, and none when sown two weeks early.
- **Heat is shifting.** Nights at early Aman (BRRI dhan71) flowering warm by 0.24 to 0.43 °C a decade at the five pilots. In 2011–2025, wheat sown on 10 December met about 2 to 5 times the hot days at grain filling of wheat sown on 20 November.
- **Checked, not assumed.** SMAP productivity does not confirm the replay's dry-spell seasons at Tanore, where farmers likely irrigate, so rescue water counts as a cost; IMERG's fast run has read too dry since 2023, so no alert rests on one rain source.

Rebuild the research tables:

```bash
python -m pip install -r research/requirements.txt
python research/run_analyses.py all
```

Copy `.env.example` to `.env` with a free Earthdata Login, authorise **NASA GESDISC DATA ARCHIVE** in the Earthdata profile, and run the `research/acquire/` scripts listed in `research/README.md` first.

**Data:** NASA POWER, GPM IMERG, SMAP (L3, L4, L4 carbon), MODIS and VIIRS NDVI, MODIS ET, GRACE/GRACE-FO, GLDAS-2.2, NASADEM and GIBS; SRDI, BRRI, BARI, BWMRI, BBS, BMD (through NOAA GSOD), FFWC/BWDB, DLS, DAM prices (through WFP), FAO, ISRIC SoilGrids, JRC Global Surface Water, geoBoundaries and ECMWF forecasts (through Open-Meteo). Sources, licences and checks are in `research/README.md`.

### The app's data release

`packages/rotation-engine/src/data/tanore_replay_data.ts` is generated from the research tables: the 25-season NASA POWER + IMERG replay, BMD-corrected heat windows, the SRDI Talanda card, BRRI/BARI/BWMRI sowing windows, SMAP L4, GLDAS-2.2, MODIS, BBS, GLW4, the haor hindcast, cattle heat and the environment ledger. Do not edit it by hand; regenerate it from the repository root:

```bash
python research/export/eden_release.py --out packages/rotation-engine/src/data/tanore_replay_data.ts
npm test
```

The latest SMAP soil-moisture values come from the downloaded cache (`research/data/appeears/l4/smap_l4_daily.parquet`, built by `research/acquire/`), which Git ignores. Without the cache the generator writes `smap: null`, so regenerate from a checkout that has it; every other number comes from the committed tables. Labels and the illustrative income figures live in `packages/rotation-engine/src/data/crop_catalog.ts`.

## Known limits

- Upazilas outside the Talanda pilot use their district's NASA point (about 50 km grid), the SRDI Talanda fertilizer card as a stand-in, and no SMAP, MODIS greenness or land-use context yet. Unknown places get HTTP 422.
- Income is a team estimate until DAM farm-gate prices and farmer cost interviews are in; crops without either keep a neutral income score.
- Kharif-1 irrigation assumes no soil water left by the winter crop, so it is an upper estimate; heat limits for crops outside `crop_parameters.csv` are literature values marked as assumed. Onion, garlic, jute, groundnut and vegetables are not replayed yet.
- Speech-to-text runs in the browser (Chrome) for now; phone speech needs a recording first (see the phone section).
- The pest score is rule-based until officers log pest counts.
- Floods are not modelled for Barind land. The haor warning shows the 25-season hindcast and the season status; a live trigger needs a daily IMERG Early feed and river-gauge confirmation. Rotation advice is not modelled for the haor.
- Flooded-rice days stand in for methane; they are not a methane measurement.
- NASA POWER weather arrives 2–3 days late and is not a forecast. River-erosion risk comes from station records and needs checking on the ground.
- Sign-in uses a shared officer code, a demo farmer PIN, in-memory sessions and a JSON file store; a real deployment needs proper accounts and a database.
- The Android app's API address works in the emulator only.

## Branches

| Branch | What it holds |
|---|---|
| `feature/crop-choice-and-calls` | `sync/all-latest` plus the farmer's own crop choice, the Bangla request reader, the voice answer and Awaj calls |
| `sync/all-latest` | Everything: `research/data-access` (`0469020`) and `codex/android-app-latest` (`8e633aa`, which already carried `codex/android-apk`, `feature/eden-screen-recreation` and `demo/research-data`), plus the daily NASA update, the live haor check, advice for every upazila and Rayyanul's Android fixes (`f5a1b11`, PR #3). Merge it into `main` with a pull request ("Create a merge commit"). |
| `feature/daily-nasa-update` | The daily NASA update, the live haor check and every-upazila advice; the same commits as `sync/all-latest` |
| `main` | Research up to 27 September and the README; it catches up when `sync/all-latest` is merged |

Once `main` is merged, start new work from `main`. GitHub runs the daily NASA workflow only from `main`.

## Team

- muhammadTasin
- Anindya Shiddhartha
- Jarin Subah
- Mohammed Rayyanul Haque
- Safin Rahman
- Tasrif Ahmed
