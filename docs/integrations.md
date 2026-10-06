# Integrations: what is real, what is saved, what is a demo

Checked on 6 October 2026 on the development machine, with a `.env` that held only the Supabase settings. Run it yourself at any time:

```bash
npm run check:integrations      # per service: SET / UNSET and PASS / FAIL / SKIPPED; never prints a value, token or key-bearing URL
```

The same list drives the **Data sources and connections** card on the manager's Data screen (`GET /api/v1/manager/data-sources`). Every
row there carries one of four labels, always an icon and words, in Bangla and English:

| Label | Meaning |
|---|---|
| **Live** (সরাসরি) | real data or a real service, fetched when it is asked for |
| **Saved copy** (সংরক্ষিত কপি) | real data, but saved or built in earlier: a cache, a committed file, a dated snapshot, a reference table |
| **Demo, simulated** (ডেমো, সিমুলেটেড) | nothing real happens: a dry run, a sample record, an imitation |
| **Not set up** (সেট করা নেই) | not turned on on this server |

The probe is one harmless read or an auth check. It never places a call, sends an SMS, starts a billed speech or text generation, or
contacts a phone number. A service that cannot be checked without cost, or without a documented check, is **SKIPPED** and says why.

## The table

| Service (`id`) | Used by | Status found | Variables (names only) | Where to get it | Free or paid, limits | Works without a key | UI claimed vs real |
|---|---|---|---|---|---|---|---|
| `nasa-power` NASA POWER | manager climate card, weather tab (observations), cattle | **Live**, PASS (answered); with `OFFLINE=1`: saved copy or committed sample | none (`OFFLINE` switches it to saved data) | https://power.larc.nasa.gov | free; limits not stated in this repo (we send one point per request, 12 s timeout) | **yes** | The card says "live download / saved copy / sample file" and now shows the download time. Real, 2–3 days behind. |
| `open-meteo` Open-Meteo | weather tab 7-day forecast, cattle | **Live**, PASS | `OPEN_METEO_API_KEY` (optional, paid) | https://open-meteo.com/ | free for non-commercial use without a key; commercial use needs a paid key; limits: see their terms (not verified here) | **yes** | Labelled "model forecast", correct. `OFFLINE=1` does **not** stop it (only POWER climate obeys it); now said on the card. |
| `nasa-gibs` NASA GIBS | overview map layers (the browser fetches tiles) | **Live**, PASS (one tile) | none | https://nasa-gibs.github.io/gibs-api-docs/ | free | **yes** | Tiles are pictures, not the numbers shown elsewhere. |
| `browser-cdn` cdnjs, Google Fonts, OpenStreetMap tiles | map library, fonts, base map (the browser fetches them) | **Live**, SKIPPED (OpenStreetMap's policy discourages automated checks) | none | n/a | free | **yes** | Without internet the map and fonts do not load; server data still does. |
| `supabase` Supabase Auth | manager sign-in, role and site check | **Live**, SET, PASS (project settings answered with its own anon key) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AUTH_EMAIL_DOMAIN` | https://supabase.com/dashboard | free plan exists, paid above it (limits: https://supabase.com/pricing, not verified here) | **no** | Real. Without it nobody can sign in as a manager. |
| `awaj` Awaj Digital | phone calls, keypad menu, keypad-9 call-back | **Not set up** (no token, no sender) → every call screen is a **demo** | `AWAJ_API_TOKEN`, `AWAJ_SENDER`, `AWAJ_LIVE`, `AWAJ_VOICE`, `AWAJ_MENU_VOICE`, `AWAJ_SURVEY_TEMPLATE`, `AWAJ_OFFICER_NUMBER`, `AWAJ_WEBHOOK_KEY`, `PUBLIC_BASE_URL`, `AWAJ_BASE_URL` | https://awajdigital.com/ (token: dashboard → Profile → API Tokens) | **paid**, every call is billed; rate limit 1 request/second (from the code comment); Direct TTS needs the "direct broadcast" and "AI TTS" permissions (ask their support) | **no** | The buttons said "Call with Awaj" and "Dispatch now". With no token or without `AWAJ_LIVE=1` nothing is dialled; they now say **demo, simulated**. |
| `tts` server text-to-speech | audio previews, call scripts | **Not set up**; SKIPPED (any request may be billed) | `TTS_BASE_URL`, `TTS_API_KEY`, `TTS_VOICE` | any provider behind a thin proxy you run | usually paid; unknown | **no** | The preview used the browser's own voice or only a moving bar. Now labelled. |
| `llm` language model | wording of the advice | **Not set up** → the fixed template wording is used | `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS` | any OpenAI-compatible endpoint (Ollama on your own machine is free; hosted is paid) | depends | **no** (template) | "Verified template" is shown, which is true. No model is assumed. |
| `earth-engine` Google Earth Engine | cattle satellite data (NDVI, SMAP, IMERG) | **Not set up**: the Python module `earthengine-api` is not installed and there are no credentials | `EE_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, `EE_PYTHON`, `EE_WORKER_PATH`, `EE_IMERG_COLLECTION` | https://earthengine.google.com/ | free for non-commercial research after registration (confirm the current terms; I could not verify them) | **no** | The cattle screens say "unavailable"; true. |
| `earthdata` NASA Earthdata Login | the nightly update job and research scripts only | **Not set up**; SKIPPED (no documented harmless check confirmed) | `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD`, `EARTHDATA_TOKEN`, `EDL_USER`, `EDL_PASS` | https://urs.earthdata.nasa.gov/users/new | free account | **no** | The old card listed it as if the website used it. **The running server never calls it**; the website's IMERG numbers come from a file the nightly job saves. |
| `firms` NASA FIRMS | nothing | **Not set up**; SKIPPED (the documentation page I read does not describe a status endpoint) | `FIRMS_MAP_KEY` | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | free; 5,000 transactions per 10 minutes (from their page) | **no** | The old card showed a FIRMS row; **no code calls it**. |
| `nasa-api` NASA Open APIs | nothing | **Not set up**; (an APOD request with `DEMO_KEY` answered, but no feature uses it) | `NASA_API_KEY` | https://api.nasa.gov/ | free; DEMO_KEY 30 requests/hour and 50/day, a registered key more (figures from the field guide quoted in `config.ts`; not independently verified) | with `DEMO_KEY` | The old card showed it; **no code calls it**. |
| `ads` NASA ADS | nothing | **Not set up**; SKIPPED | `ADS_API_TOKEN` | https://ui.adsabs.harvard.edu/user/settings/token | free with an ADS account; their docs give 5,000 queries a day as the example limit | **no** | The old card showed it; **no code calls it**. |
| `daily-update-file` daily NASA update file | "Daily NASA conditions" card, map colours, haor warning | **Saved copy**, PASS (file generated 6 Oct 2026, POWER to 3 Oct) | none on the server; the GitHub job uses the repository secrets `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` for IMERG | built by `.github/workflows/daily-nasa-update.yml` | free | **yes** (POWER); IMERG only with the secrets | Called "daily NASA conditions"; it is a file a GitHub job commits each morning. IMERG is absent on `main` (no secrets), so the card shows "IMERG —" and uses POWER rain. Now labelled. |
| `release-snapshot` research release `tanore-2026.09.30` | Aman/Rabi replay, SMAP and rain snapshot, advice, scores | **Saved copy** (built in, dated) | none | generated from `research/` | free | **yes** | The overview already says "snapshot, not live". The Data quality table used to label these datasets **"Live"**: now "Saved copy". |
| `reference-tables` SRDI card, BMD stations, BWDB river stations, boundaries | fertilizer card (Talanda only), temperature correction, river-erosion tab, map outlines | **Saved copy** (built in) | none | published reports and open data | free | **yes** | The erosion tab's code comment claims "NASA GPM IMERG basin precipitation" but **no code fetches it**, and there is **no live BWDB connection**: the stations are 2010–2021 numbers. The tab now says so. |
| `demo-features` farmer demo sign-in and SMS, sample farmers, keypad test, demo farm, phone mock-up | farmer portal, officer desk, delivery screen, cattle | **Demo, simulated** | `DEMO_MODE`, `EDEN_OFFICER_CODE`, `SEED_DEMO_DATA` (not integrations) | n/a | n/a | **yes** | Now labelled "demo, simulated" next to each output (details below). |

## Where the UI said "live", "connected" or "real" but it was not (all now labelled; nothing was removed)

1. **Data quality table**: datasets built into the release were badged **"Live"** / "Live, cross-checked". Now **"Saved copy"**.
2. **Data sources card**: showed rows for Earthdata, NASA key, ADS and FIRMS as if the website used them (none of them is called by the running server), and called NASA POWER "always available". Now lists every integration with its real label and what uses it.
3. **"Live keypad test"** (delivery screen): it only calls the simulated `POST /channel-events`. Now "Keypad response test (demo, simulated)".
4. **"Dispatch now"**: shows a scripted log and sends nothing. Now says so on the button.
5. **"Call with Awaj" and the keypad-menu call**: a dry run unless the token, a sender and `AWAJ_LIVE=1` are all set. Output now starts "Demo, simulated (dry run)" and a note sits above it.
6. **Audio preview**: uses the browser's own Bangla voice if it has one; otherwise only a progress bar moves, with no sound. Now labelled (the bar-only state says "demo, simulated").
7. **Farmer demo sign-in**: no SMS is sent and no phone is checked. Now starts "Demo, simulated".
8. **Farmer smartphone companion**: a phone mock-up; badge added.
9. **"Daily NASA conditions"**: a saved file (see the table). Note added.
10. **River-erosion tab**: hard-coded numbers; note added.
11. **Offline badge**: `OFFLINE=1` only affects NASA POWER climate. The forecast, the cattle weather and the map still need internet. Now said on the badge.

## Fixed while auditing: secrets in call output

`POST /api/v1/calls/keypad` (no sign-in needed while `AWAJ_LIVE` is not 1) returned the dry-run request, which contained the **webhook key**
inside the webhook address, the configured **sender number** and the **officer's number**. `GET /officer/calls` returned the same address to
every manager. Both are fixed: dry runs show `<AWAJ_SENDER>`, `<AWAJ_WEBHOOK_KEY>` and a masked officer number, and managers get flags only.
`test_integrations.ts` fails if a fake value ever reappears.

## What to set up, in order

Nothing except Supabase is needed to run the dashboard and the planner. In order of importance for a demo:

1. **Supabase (done on this machine).** For each manager: create the user with the email `<userId>@<AUTH_EMAIL_DOMAIN>`, set `app_metadata` to `{"role":"manager","site":"talanda"}` (never `user_metadata`), and turn off public sign-ups. See `docs/SETUP.md`. Check: `npm run check:integrations` → `supabase SET PASS`.
2. **Nothing else for the core demo.** NASA POWER, Open-Meteo and NASA GIBS are free and keyless and answered. For a demo without wifi set `OFFLINE=1`: the climate card then shows the committed sample data, labelled "Sample data from NASA POWER" (the forecast and map will not load).
3. **Real phone calls (Awaj, paid).** Only if you must show a real call. Order: create the account and get the "direct broadcast" and "AI TTS" permissions → `AWAJ_API_TOKEN` → `AWAJ_SENDER` (an active number on the account) → run `npm run check:integrations` (the `awaj` row should PASS: it reads the balance) → record and approve the keypad menu (`npm run call:test -- --upload-menu menu.m4a`) → `AWAJ_MENU_VOICE`, `PUBLIC_BASE_URL`, `AWAJ_WEBHOOK_KEY`, `AWAJ_OFFICER_NUMBER` → only then `AWAJ_LIVE=1`. **Free alternative:** leave it unset; every call screen stays a demo that shows the exact request and script. **Lost:** no real call or call-back reaches a phone.
4. **Server voice (TTS).** Paid or self-hosted. **Alternative:** the browser's own Bangla voice (Chrome on Android and desktop usually has one). **Lost:** one consistent voice on every device, and any audio file for calls.
5. **Language model (LLM).** **Alternative:** the fixed checked template (the default). **Lost:** more natural wording only; no numbers change, because the numbers are always checked.
6. **Earth Engine (free account).** `pip install earthengine-api`, register a Google Cloud project with the Earth Engine API, then `EE_PROJECT` and either `earthengine authenticate` on the server or `GOOGLE_APPLICATION_CREDENTIALS`. The documentation I could reach does not settle the current non-commercial terms: confirm them first. **Lost if skipped:** the cattle screens' satellite part (greenness, soil moisture, rain); the weather part keeps working.
7. **Earthdata (free account).** Needed only so the nightly GitHub job can add IMERG to the daily file: add the repository secrets `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD` in GitHub (not `.env`). **Lost if skipped:** IMERG numbers in the "Daily NASA conditions" card (it falls back to POWER rain).
8. **FIRMS, NASA API key, ADS.** Nothing uses them. Skip.

## What I could not verify

- **Awaj, TTS, LLM, Earth Engine:** no token, endpoint or credentials exist here, so each was only checked as "not set up". Awaj's `/balance` read, the LLM `/models` read and the Earth Engine readiness check are implemented but have **never run against a real account**.
- **Earthdata and FIRMS:** no documented harmless check was confirmed (the pages I could read do not describe one), so they are SKIPPED rather than guessed.
- **Free-tier limits** for Open-Meteo, Supabase and NASA POWER, the current Earth Engine terms, and NASA API key limits (quoted from the field guide in `config.ts`) were not independently verified.
- **ADS:** the token page and the `search/query?q=star` example were read in ADS's own repository; the probe has not run with a token.
- **The browser-loaded CDNs and OpenStreetMap tiles** are not probed.
- **Variables are read through `config.ts` only by the new code** (the integrations list, the check and the status card). Older modules (`awaj.ts`, `llm.ts`, `tts.ts`, the weather and cattle code) still read their own variables directly; moving them is a refactor I did not do.
