# Setup guide

Two repositories share one API:

| Repo | Path | Role |
|---|---|---|
| Website + API (this repo) | `Edith_Web_App_Connectivity` | the only backend |
| Android app | `project-eden-earth-data-environment-navigator` (`apps/farmer-mobile`) | consumes this API |

## 1. API + website (same server)

Needs Node.js ≥ 22.6 (tested on 24) and, optionally, Python 3 for Earth Engine.

```bash
cd Edith_Web_App_Connectivity
npm install            # workspace links and @supabase/supabase-js (officer sign-in)
cp .env.example .env   # edit placeholders (SUPABASE_URL, SUPABASE_ANON_KEY for officer sign-in); then export them:
set -a; source .env; set +a
npm start              # http://localhost:4000  (site at /, API at /api/v1/...)
npm test               # pipeline + cattle unit tests + live HTTP integration tests
```

Check what is actually configured: `curl localhost:4000/api/v1/config`.

Website API URL: same-origin by default. To host the page separately, set `apiBase` in
`apps/saao-dashboard/public/config.js` and put the page origin in `CORS_ORIGINS`.

## 2. Android app

Needs JDK 17+ and Android SDK 36 (`sdk.dir` in `apps/farmer-mobile/local.properties`).

```bash
cd project-eden-earth-data-environment-navigator/apps/farmer-mobile
./gradlew testDebugUnitTest assembleDebug   # debug APK: app/build/outputs/apk/debug/app-debug.apk
```

Set the API URL per build type in `apps/farmer-mobile/local.properties` (git-ignored), `~/.gradle/gradle.properties`, or with `-P`
(template: `gradle.properties.example`):

```properties
eden.baseUrl.debug=http://10.0.2.2:4000        # default if unset: emulator -> the computer running the API
eden.baseUrl.release=https://api.example.org   # REQUIRED for release; must be https:// (the release build fails otherwise)
```

- Emulator: nothing to set (`10.0.2.2` is the emulator's alias for your computer).
- Physical phone on the same Wi-Fi: `eden.baseUrl.debug=http://<your-computer-LAN-IP>:4000` (the API listens on all interfaces).
- Physical phone over USB: `adb reverse tcp:4000 tcp:4000`, then `eden.baseUrl.debug=http://127.0.0.1:4000`.
- Cleartext HTTP works in debug builds only (`src/debug/res/xml/network_security_config.xml`); release builds are HTTPS only.
- Release build: `./gradlew assembleRelease -Peden.baseUrl.release=https://your-api` (unsigned unless you add signing config).
- GPS: the Weather screen asks for location permission only when you tap "use my current location"; you can always choose a district/upazila by hand.

Refreshing the Android contract fixtures after an API change (`app/src/test/resources/contract/`):

```bash
S=http://localhost:4000; R=apps/farmer-mobile/app/src/test/resources/contract
curl -s "$S/api/v1/weather/forecast?lat=23.81&lon=90.41" > $R/forecast.json
curl -s "$S/api/v1/weather?lat=23.81&lon=90.41"          > $R/observations.json
curl -s "$S/api/v1/locations"                             > $R/locations.json
curl -s "$S/api/v1/cattle/aois"                           > $R/cattle_aois.json      # then use an id from it:
curl -s "$S/api/v1/cattle/aois/<id>/advisory"             > $R/cattle_advisory.json
curl -s "$S/api/v1/cattle/jobs?aoiId=<id>"                > $R/cattle_jobs.json
```

## 3. Real credentials and provider accounts still required

| Capability | What is needed | Without it |
|---|---|---|
| Weather forecast | nothing for fair-use Open-Meteo (commercial use needs `OPEN_METEO_API_KEY`) | works |
| NASA POWER observations | nothing | works |
| Satellite NDVI / SMAP soil moisture / IMERG rain | `pip install earthengine-api`, a Google Cloud project with Earth Engine enabled (`EE_PROJECT`), service-account key (`GOOGLE_APPLICATION_CREDENTIALS`) or `earthengine authenticate` | `satellite.status: "unavailable"`, jobs `partial`; satellite-only jobs `blocked` |
| Conversational LLM (e.g. Gemma 3 4B) | your own OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`) serving that model | template narration only; **no model is bundled, trained or fine-tuned here** |
| Server text-to-speech | an HTTP TTS endpoint returning audio (`TTS_BASE_URL`, `TTS_API_KEY`) | `/tts` returns 503; clients use on-device speech (needs a Bangla voice on the device) |
| Trained cattle-risk model | labelled farm outcomes (milk yield, clinical records, pasture clippings) + a training pipeline | `training_data_unavailable`; rule-based THI only |
| Durable jobs | a real database/queue replacing the local JSON store | jobs are in-process and lost/failed on restart |
| Production hosting | an HTTPS URL for the API; real authentication instead of demo accounts | local/demo only |
