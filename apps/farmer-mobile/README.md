# EDEN Farmer Android App

Native Android prototype for farmers, built with Kotlin, Jetpack Compose, Material 3, and Room. The latest Android work is on `codex/android-app-latest`; it has not been merged into `main`.

## Current scope

The prototype has five bottom-navigation tabs (Today, Weather, River erosion, AI assistant, My farm) and nested detail screens. The tabs most relevant to the shared API are described first:

| Screen | What it shows |
|---|---|
| **আবহাওয়া — Weather** | Pick any of Bangladesh's 64 districts / 500 upazilas (list served by the API), or use GPS. Shows the Open-Meteo **model estimate** (current, hourly with humidity, 7-day), an hourly **THI** derived from it, the NASA POWER **delayed** observations (never labelled live), and read-only farm advisories created on the website — each labelled measured / derived / heuristic, with job status and what is missing. Loading, offline, permission-denied, provider-unavailable and no-data states are shown, with retry. |
| **AI সহকারী** | Sends your selected location with each question; the server (rule-based, not an LLM) answers only from provider data and reference cards, or refuses. |

Older prototype screens:

| Screen | What it demonstrates |
|---|---|
| **আজ — Today's advice** | Current rotation card, plot context, freshness/offline banner, and Bangla text-to-speech control |
| **পরিকল্পনা — Crop plan** | Crop-season timeline, alternative crop, and navigation to rotation details |
| **আগের পরামর্শ — Advice history** | Locally stored advice cards and replay controls |
| **আমার খামার — My farm** | Pilot farm profile, land/soil details, priorities, and consent presentation |
| **ফসল চক্রের বিস্তারিত — Rotation detail** | Sowing/harvest guidance, evidence notes, missing-value labels, and a demo confirmation action |

The source for screens and their ViewModels is under `app/src/main/java/org/projecteden/farmermobile/ui/`. Navigation is in `Navigation.kt`; shared screen data models are in `data/model/`.

## App architecture

```text
Compose screens
    ↓ events / StateFlow
Screen ViewModels
    ↓
FarmerRepository ───── EdenApiClient ───── the shared API (Edith_Web_App_Connectivity repository)
    ↓                       one configured URL  GET /api/v1/locations, /weather/forecast, /weather,
Room database                                   /cattle/*, /overview, /erosion; POST /advice, /ai/ask
    ↑
Seeded prototype profile, advice, and history

WeatherController (plain Kotlin, unit-tested) ← LocationProvider (GPS) / LocationStore (device only)

BanglaTtsManager → Android system TextToSpeech
```

- **Presentation:** Compose screens collect screen state from ViewModels. Navigation keeps the four tabs in one scaffold and opens rotation detail as a separate destination.
- **Local data:** `EdenDatabase` and `FarmDao` store the farm profile, current advice, and advice history. The UI observes Room flows, so the cached advice is available without a network connection. The first-run seed in `AdviceModels.kt` mirrors the engine's farmer card; `npm test` (TEST 9) fails if they drift.
- **Remote data:** `EdenApiClient` uses Android's `HttpURLConnection` to call the shared Node API. The client defines overview and advice requests; farmer profile and advice history have no server endpoints yet.
- **Voice:** `BanglaTtsManager` uses the device's Bengali system TTS when available. If Bengali voice data is missing, it reports that state instead of playing fabricated audio. The progress display is an estimate based on a timer.
- **Recommendation ownership:** crop scoring remains in `packages/rotation-engine/` on the server side; the Android client does not implement scoring.

## Data and integration status

This branch is a reviewable demo, not a field-ready advice service. Treat the displayed farm, crop, dates, metrics, counts, provenance, and dashboard contacts as sample/pilot demonstration values until each is checked against its cited source and a real data release. Do not use the prototype as agricultural guidance.

Known gaps in this version:

- Room starts with seeded sample profile/advice/history. Farm profile edits and confirmed plans are saved on-device; the profile and confirmation do not sync to a server.
- The Today screen syncs when it opens and has a manual refresh action. `FarmerRepository.refreshAdvice()` maps the server's `farmer_card` into Room, and on failure keeps the cached advice and its last sync time. There is no background sync worker yet.
- Profile and history are local only; there are no `/api/v1/farmer-profile` or `/api/v1/advice-history` endpoints.
- The API already serves officer-verified advice (`POST /api/v1/advice` with `farmerId`), the IPM steps (`options[].ipmActions`) and English text, but the app does not show them yet; that is the next app step.
- There is no durable background sync worker, account/authentication flow, or production API configuration yet.
- The API URL is configured per build (see "API configuration" below); there is no host guessing and no production URL in source. Cleartext HTTP is allowed in debug builds only; release builds require an `https://` URL or the build fails.
- The auth token is kept in plain `SharedPreferences` (`AuthManager`); move it to encrypted storage before production. Demo credentials are pre-filled in debug builds only.
- Farms (AOI polygons) are drawn on the website; this app only reads their advisories. Earth Engine satellite values appear only if the server has Earth Engine configured.
- The debug APK is a build output and is ignored by Git. Share the APK separately if a tester needs to install it.
- Screen navigation, advice refresh, audio, profile saves, plan confirmations, and history playback emit privacy-safe event tags under `EDEN_APP` in Logcat. They do not log farm field values.

## Run locally

## API configuration

This app is a client of the **Edith_Web_App_Connectivity** repository's API, which is the only backend (the `services/api` folder in *this* repository is an older duplicate and is deprecated: do not extend it; point the app at the Edith API). Start that API (see its `docs/SETUP.md`), then set the URL per build type in `apps/farmer-mobile/local.properties` (git-ignored), `~/.gradle/gradle.properties`, or with `-P` (template: `gradle.properties.example`):

```properties
eden.baseUrl.debug=http://10.0.2.2:4000        # emulator (default if unset); real phone: http://<computer-LAN-IP>:4000, or `adb reverse tcp:4000 tcp:4000` + http://127.0.0.1:4000
eden.baseUrl.release=https://api.example.org   # required for release; must be https:// or `assembleRelease` fails
```

## Run locally

Start the shared API from the Edith repository (`npm install && npm start`), then build this app:

```bash
cd apps/farmer-mobile
./gradlew testDebugUnitTest assembleDebug
```

The debug APK is written to `apps/farmer-mobile/app/build/outputs/apk/debug/app-debug.apk`. To install it on a connected Android device or emulator with ADB:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Run the unit tests (parsers against real API responses, HTTP client against a local fake server, weather/location logic, THI) with:

```bash
./gradlew test
```

The app uses Gradle independently from the repository's npm workspaces. `local.properties`, Gradle caches, build outputs, APKs, and AABs should stay out of commits.
