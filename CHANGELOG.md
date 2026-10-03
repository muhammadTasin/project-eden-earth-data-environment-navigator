# Changelog

What changed in Project EDEN, newest first, with who made each change and the branch it came from. Every branch below was merged into `main` on 1 October 2026.

## 4 October 2026 · The farmer's own crops, and calls through Awaj (Tasrif, `feature/crop-choice-and-calls`)

- `research/explore/crop_choice_replay.py` replays 12 more crops (potato, maize, sunflower in winter and summer, chickpea, grass pea, sweet potato, barley, soybean, mungbean, sesame, Aus rice) at the Talanda pilot and all 64 district points with the same FAO-56 and NASA POWER + GPM IMERG chain, for every 10th sowing day of each window; output `crop_choice_replay.json`.
- Engine: `preferredCrops` plans the year around the farmer's crops (Aman, a winter crop, and a Kharif-1 crop before the next Aman), checks the calendar for every Aman variety, ranks plans by how many named crops they hold and then by score, and explains what does not fit, crops that compete for the same season, and summer crops that fit the gap. The seven scores count the Kharif-1 crop. Without named crops the five fixed rotations are unchanged.
- `understand.ts` reads crops, exclusions, land type and priorities from Bangla, Banglish or English sentences.
- API: `/api/v1/crops`, `/api/v1/voice/understand`, `/api/v1/voice/answer`, `/api/v1/calls/*` and `/api/v1/officer/calls`; `services/api/src/awaj.ts` (Direct TTS calls, keypad surveys, results) runs dry until `AWAJ_LIVE=1`; `npm run call:test` prints the script and places one test call when live.
- Dashboard: crop choices in the planner, with the notes and a "farmer's choice" tag on each option; a voice card on the delivery screen (browser microphone, the answer, SMS, playback and an Awaj call).
- Tests: two engine tests (crop choice, request reader) and API checks for the menu, voice answer, call and keypad webhook.
- Merged Rayyanul's Android fixes (`f5a1b11`, PR #3) from `sync/all-latest` first.

## 1 October 2026 · Advice for every upazila (Tasrif, `feature/daily-nasa-update`)

- `research/explore/national_replay.py` runs the 25-season replay (FAO-56 water balance, BRRI/BARI calendars, heat windows) at all 64 districts' NASA POWER + GPM IMERG points, correcting temperatures against the nearest BMD station, and writes `national_replay.json` with the 544-upazila index. Rajshahi district matches the Tanore research (dhan71 7 of 25 rescue seasons; Boro 790 mm against 797).
- `data/location.ts` switches the engine between the Talanda pilot and any upazila; the engine, plugins and API read the current place instead of Tanore's fixed data.
- API: `GET /api/v1/places`, `GET /api/v1/overview?place=`, and advice for any upazila id; tests check 544 places, advice for Godagari and an overview for a Sylhet upazila.
- Dashboard: a district and upazila picker at the top of the overview; the header, title, rain (from the daily NASA update), alert, replay table, planner and comparison follow it, and datasets that exist only for the pilot are labelled as not added yet. The choice is remembered.

## 1 October 2026 · Live daily flash-flood check for the haor (Tasrif, `feature/daily-nasa-update`)

- Every daily run reads the last 3 days of GPM IMERG rain at Sohra, divides it by Sohra's Late/Final ratio (0.91, from `research/pilots/rain_vs_normal.csv`) so it matches the Final run the levels were tested on, and sets normal, watch (200 mm) or warning (250 mm); the season is 15 March to 15 May.
- The Jaintia Hills (Sylhet), Garo Hills (Netrokona, Mymensingh) and Barak valley (Sylhet, Moulvibazar, Habiganj) are read the same way and shown as not yet calibrated.
- NASA's MODIS NRT flood map (`MODIS_Combined_Flood_3-Day` on GIBS, no login) gives the share of the haor basin under unusual flood water, seasonal flood water and cloud.
- `/api/v1/haor/flash-flood` and the overview's early warnings carry it as `live`; the dashboard's flash-flood card shows today's reading and turns its badge to Watch or Warning in season; a test checks it.

## 1 October 2026 · Daily NASA update for every upazila (Tasrif, `feature/daily-nasa-update`)

- `research/live/daily_update.py` fetches NASA POWER for all of Bangladesh in one request per variable (104 grid points, no login) and gives each of the 544 upazilas its nearest point: rain, temperature, humidity and root-zone and surface soil wetness, with rain and soil compared against the same dates in 2016–2025. With an Earthdata Login it adds GPM IMERG rain at 10 km (1 to 2 days behind) and the 3-day rain at Sohra for the haor trigger.
- `research/sites/upazilas.csv`: the 544 upazila centroids with their districts.
- API `GET /api/v1/live/status`, `/api/v1/live/upazilas`, `/api/v1/live/upazila`; a dashboard card picks any district and upazila; a test checks all 544 upazilas.
- `.github/workflows/daily-nasa-update.yml` runs it every morning and commits the result.
- Dry and wet labels are provisional: POWER's newest weeks read drier than its archive, so they wait for the SMAP check.

## 1 October 2026 · Everything merged into `sync/all-latest`, ready for `main` (Tasrif)

- Merged `research/data-access` (`0469020`) and `codex/android-app-latest` (`8e633aa`) on top of `main` in `sync/all-latest`. The app branch already carried `codex/android-apk`, `feature/eden-screen-recreation` and `demo/research-data`, so that branch holds the research, the engine, the API, the dashboard, the Android app and the designs together; it goes into `main` with a pull request.
- Rewrote the README for the whole project. It keeps the architecture section muhammadTasin added to `main` on 30 September, and this file now holds the change history.
- Research and app share one tree, so the data release is regenerated from the repository root: `python research/export/eden_release.py --out packages/rotation-engine/src/data/tanore_replay_data.ts`.
- `npm test` passes on the merged tree: 11 engine tests and every API check.

## 30 September – 1 October 2026 · Weather, river erosion, assistant and sign-in (muhammadTasin, `codex/android-app-latest`)

| Area | Change | Files |
|---|---|---|
| NASA POWER weather | `GET /api/v1/weather`: daily agroclimatology and SMAP root-zone moisture for the pilot, fetched live from the NASA POWER API and cached, with a fixed baseline marked not live when offline. Observations, not a forecast. | `services/api/src/weather.ts`, `WeatherScreen.kt`, `WeatherViewModel.kt` |
| River erosion | `GET /api/v1/erosion`: riverbank erosion risk for the Jamuna corridor from BWDB/FFWC station records and IMERG basin rain. | `services/api/src/erosion.ts`, `RiverErosionScreen.kt`, `RiverErosionViewModel.kt` |
| Assistant | `POST /api/v1/ai/ask`: a Bangla assistant that answers only from the project's evidence and refuses out-of-scope questions such as loans or pesticide brands. It is rules-based and calls no outside AI service. | `services/api/src/ai_assistant.ts`, `AiAssistantScreen.kt`, `AiAssistantViewModel.kt` |
| Sign-in | `POST /api/v1/auth/login`, `GET /api/v1/auth/session`, `POST /api/v1/auth/logout`: officers with the access code, farmers with their ID or phone and a demo PIN. | `services/api/src/officer_desk.ts`, `server.ts`, `LoginDialog.kt` |
| Farm profile | The app's My Farm screen edits the farm profile; `8e633aa` repairs the editing. | `MyFarmScreen.kt`, `MyFarmViewModel.kt` |
| Navigation and screens | Bottom and top bars, Today and history screens updated for the new features. | `BottomNavBar.kt`, `TopAppBar.kt`, `TodayAdviceScreen.kt`, `AdviceHistoryViewModel.kt` |
| Tests | `test_server.js` checks weather, erosion, the sign-in lifecycle and the assistant's grounded answers and refusals; new Android unit tests. | `test_server.js`, `FarmerMobileUnitTest.kt` |

## 30 September 2026 · Round 3 (Tasrif): more of the NASA data at work (early warnings, environment ledger)

The research release already held NASA results that the app did not use. Four of them now reach the dashboard, and all come from the same generated data file.

| Feature | What the officer sees | NASA data and method | Files |
|---|---|---|---|
| Haor flash-flood warning (Dharmapasha pilot) | New **early warnings** row on the overview. From 15 Mar to 15 May, 200 mm of rain in 3 days at Sohra (Cherrapunji, Meghalaya) raises a watch and 250 mm a warning; river gauges must confirm before any call goes out. A chart shows the largest 3-day spring rain for 2001–2025, coloured by FFWC flood years. Off season, the card shows when the trigger re-arms. | GPM IMERG daily rain at Sohra, checked against 25 springs of FFWC flood reports: the 200 mm rule caught 3 of 5 flood years (2004, 2010, 2017) with no false alarm in 3 no-flood years, and missed the small late floods of 2018–19. Eight labelled years test the thresholds; they do not calibrate a warning. A 250 mm burst caught BRRI dhan28 before harvest in 4 of 5 cases; BRRI dhan88, 81, 29, 89 and 92 in at most 1 of 5, and none when sown two weeks early. | `server.ts` (`earlyWarnings`, `haorStatus`), `app.js` (`renderWarnings`) |
| Warmer nights at Aman flowering | Card for officers: early Aman saves water but flowers into warmer nights, so watch for empty grains. | NASA POWER, corrected against BMD stations; Theil-Sen trend with a Kendall test. BRRI dhan71 flowering nights: +0.29 °C a decade (p 0.015); dhan49: +0.15 °C (not significant). Good news: hot days at grain filling for wheat sown on 20 Nov fell by 4.3 a decade. The heat plugin adds a caution when the trend is significant; the score does not change. | `plugins/heat.ts`, `server.ts`, `app.js` |
| Cattle heat stress (Tanore) | Card with a monthly chart: June to September have no night relief (THI stays above 72); in July 96% of hours are in the danger bands; the coolest hours are 02:00–05:00. | NASA POWER hourly temperature and humidity (2023–2025), temperature-humidity index (NRC 1971). | `server.ts`, `app.js` |
| Environment ledger | Table in the renamed **পরিবেশ ও কম কীটনাশক (Environment & less pesticide)** tab: groundwater pumped, flooded-rice days (a methane proxy, not a measurement), urea, legume or not, bare-soil days and the pest score for every rotation. Boro pumps 7,975 m³/ha; dhan71 → lentil 1,995. | Water from the 25-season POWER + IMERG replay; urea from the SRDI Talanda card. The engine rebuilds the research ledger exactly (TEST 11). | `engine.ts` (`ledger` on each option), `app.js` (`renderLedger`) |
| Soil carbon and a productivity check | Evidence tab: SMAP L4 soil organic carbon about 4,684 g/m² (2016–2025, +76 a year). The Aman productivity (GPP) did not drop in dry seasons (rho 0.26, 11 seasons), because farmers irrigate; so rescue water is counted as a cost, not a lost crop. | SMAP L4 carbon (SPL4CMDL). | `server.ts` (`soil_carbon`), `app.js` |

The generator (`research/export/eden_release.py`) now also writes `TANORE_ADVISORIES`, `HAOR_FLASH_FLOOD`, `TANORE_SOIL_CARBON` and `TANORE_LEDGER_RESEARCH`, plus `fieldDays` and `pumpedM3PerHa` on the replay records. The officer reference pack adds the cattle-heat months and the haor hindcast.

## 30 September 2026 · Round 2 (Tasrif): English, the Krishi officer desk, less pesticide

**Bangla / English toggle (dashboard).**

- Every static text has a `data-i18n` key. The Bangla stays in `index.html` and the English is in `apps/saao-dashboard/public/i18n.js`.
- Dynamic text is built in `app.js` with `tr(bangla, english)`. The engine and API now return English versions of actions, timelines, the "this season" note, alerts and the farmer summary.
- The farmer always hears Bangla. In EN mode the delivery screen adds an English translation of the script (`englishGloss`).
- `npm test` fails if any `data-i18n` key lacks an English string.

**Krishi officer desk (dashboard + API).** This is a separate channel between farmers and their SAAO:

- **Priority for the officer's knowledge:** an officer's field observation describes the farmer's land (land type, the Aman in the field, irrigation, pests seen, the farmer's priorities, a note). It takes priority over defaults whenever that farmer's advice is built, and the advice is marked `verification` (officer-verified).
- **Priority queue:** farmers are ranked by need, with the reasons in both languages. The rules are: a keypad-9 call-back request (+3); lentil and mustard both miss their deadline this season (+2); no Rabi crop fits on time (+1); a pest seen (+1, or +2 if severe); not yet checked in the field (+1).
- **Extra access:** after sign-in, officers get the call-back queue, the farmer register, the observation form and a reference pack farmers don't see. The pack holds the full SRDI card (gypsum, zinc, boric acid), the 25-season replay with rescue years, Rabi windows and heat exposure, data caveats and technical notes.
- **Farmer side:** pressing 9 in the IVR (or "call-back" in the companion mock-up) creates a call-back request on the desk.
- **Safety:** officer notes pass the same banned-word filter as farmer messages (no loans, no pesticide brands).
- **Storage:** sample farmers, observations and call-backs are kept in `services/api/.data/officer_store.json` (git-ignored). Tests use a throwaway file (`EDEN_OFFICER_STORE`).

**Less pesticide through rotation (IPM).** A seventh scoring plugin and a dashboard tab:

- `plugins/pest.ts` scores pest pressure from four transparent rules:
  - Host break: a non-rice Rabi crop breaks the rice-pest cycle; Boro after Aman keeps it going.
  - Nitrogen load: the SRDI urea total for the rotation.
  - Resistant varieties from the research tables: BWMRI lists BARI Gom 33 as blast and rust resistant.
  - Late sowing: sowing past the handbook deadline counts against the rotation.
- Confidence is `low` and the data is `assumed`, because there are no field pest counts yet. Officers' pest observations are the start of that data.
- `data/ipm_catalog.ts` holds IPM steps in Bangla and English, each with its source. They are non-chemical first, and no pesticide product is ever named.
- The **কম কীটনাশক (IPM)** tab compares the recommended rotation with the Boro baseline (lentil 90/100 vs Boro 31/100, 52% less urea), lists the IPM steps, ranks all rotations, shows officers' pest reports and gives spray-safety advice.
- Farmers can ask for this with keypad 4 ("কম কীটনাশক"); the dashboard has a matching priority slider.
- The app side of the officer desk and IPM is planned for later; the API already serves both.

## 30 September 2026 · Round 1 (Tasrif): numbers from the research, bugs fixed, app connected

| Area | Change | Files |
|---|---|---|
| One source of numbers | The engine's data file is **generated** from the WinR research tables by `research/export/eden_release.py` (research repo). Every screen reads it, and nothing is retyped by hand. | `packages/rotation-engine/src/data/tanore_replay_data.ts` (generated), `release_types.ts` |
| Corrected values | dhan71 needed rescue irrigation in 7 of 25 seasons (was 6), dhan87 in 6 (was 7); dhan87 frees the field on 6 Nov (was 15 Nov); Boro irrigation is 797 mm (was 745); late wheat 234 mm with 27 of 30 hot days (was 275 mm, 28); fertilizer comes from the SRDI Talanda card (lentil urea 54.3, not 45 kg/ha); SMAP on 10 Nov is 0.33 m³/m³ (not 0.24). | same |
| Boro scored as lentil (bug) | The plugins looked up `'BRRI dhan28'`, but the data key was `'BRRI dhan28 (Boro)'`, so every lookup fell back to lentil and the dashboard said Boro needs "198 mm". Crops now carry an explicit `season`, and the lookups throw instead of falling back. | `packages/contracts`, `data/lookup.ts`, all plugins |
| Weighting | Scores the farmer did not prioritise now weigh 0.05, so keypad 1 (water) really puts the lowest-water rotation first. | `engine.ts` |
| Unmodelled unions | A union without research data gets HTTP 422 instead of Talanda's advice under another name. | `engine.ts`, `server.ts` |
| Candidates | Five rotations: dhan71 → lentil, dhan71 → mustard, dhan49 → Boro (current practice), dhan49 → wheat on 20 Nov, dhan75 → wheat on 10 Dec. Their dates, timelines and actions come from the replay. | `engine.ts` |
| This season | Given the Aman already in the field, the engine reports which Rabi crops still meet their BARI/BWMRI deadlines (`this_season`) and the best rotation that starts from it (`this_season_option_id`). | `engine.ts` |
| Spoken script | Correct Bangla ("তালন্দ ইউনিয়নের", "১০ নভেম্বরের মধ্যে", Bangla digits, Bangla crop names); every number is read from the advice and checked by the dual gate. | `narration-core` |
| Honest labels | Removed the "LIVE FEED" badge, the 342 "active farmers", a named sample farmer, an invented SRDI card ID and NASADEM claims; soil is খিয়ার মাটি (SRDI card) everywhere; income is marked as a sample estimate; flood is marked "not modelled". | dashboard, plugins |
| Android app | It syncs the server's `farmer_card` on opening, keeps its cached advice when offline, and its seed shows dhan71 → lentil; the fake status bar is removed and screen texts come from the advice. | `apps/farmer-mobile` |

## 29 September 2026 · Android farmer prototype and shared services (muhammadTasin, `codex/android-apk`)

- `4e6ad15`: the native Kotlin + Jetpack Compose farmer app, the SAAO dashboard, the shared API and the TypeScript packages (contracts, rotation engine, narration core).

## 28 September 2026 · Screen designs and product architecture (muhammadTasin, `feature/eden-screen-recreation`)

- `7ae436d`: six SAAO desktop screens and the portrait Android companion recreated in `design/`.
- `fc42200`: the EDEN product architecture.

## 26–30 September 2026 · Research and data (Tasrif, `research/data-access`)

- 30 September, `0469020`: the data release also carries the early warnings (haor flash-flood hindcast, heat trends, cattle heat), SMAP soil carbon and the research ledger check.
- 30 September, `6c9e343`: `research/export/eden_release.py` exports the Tanore research numbers as the app's data release.
- 28 September, `2a3c406`: eight more NASA signals behind the rotation scores (GLDAS-2.2 groundwater and root zone, heat windows, the flash-flood hindcast, cattle heat, field cycles, the SMAP productivity check, the environment ledger) and `research/run_analyses.py`.
- 26–27 September, `e6af362` to `433dc03`: data access, checks and curated tables (NASA POWER, GPM IMERG, SMAP, GRACE/GRACE-FO, MODIS, BMD stations, BRRI/BARI/BWMRI varieties, SRDI cards, BBS, FFWC flood records), merged into `main` through pull request #1.
