import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { AdviceJSON, CandidateRotation } from '@project-eden/contracts';
import type { PlanOptionsRequest } from '../../../packages/rotation-engine/src/engine.ts';
import { RotationEngine, UnsupportedUnionError, SUPPORTED_UNIONS } from '../../../packages/rotation-engine/src/engine.ts';
import { FeatureRegistry } from '../../../packages/rotation-engine/src/registry.ts';
import { HAOR_FLASH_FLOOD, RELEASE, TANORE_ADVISORIES, TANORE_SOIL_CARBON } from '../../../packages/rotation-engine/src/data/tanore_replay_data.ts';
import { LOC, listPlaces, placeFor, withPlace } from '../../../packages/rotation-engine/src/data/location.ts';
import { AMAN_CATALOG, RABI_CATALOG } from '../../../packages/rotation-engine/src/data/crop_catalog.ts';
import { IPM_AMAN, IPM_BY_RABI, IPM_GENERAL } from '../../../packages/rotation-engine/src/data/ipm_catalog.ts';
import { LAND_TYPE_BANGLA, bnDate, bnDateOf, bnDigits, bnOf, enDate, patternBangla } from '../../../packages/rotation-engine/src/bn.ts';
import * as desk from './officer_desk.ts';
import { DualGateNarrationValidator } from '../../../packages/narration-core/src/dual_gate_validator.ts';
import { TemplateNarrator } from '../../../packages/narration-core/src/template_narrator.ts';
import { getNasaWeather, lastNasaSuccessAt } from './weather.ts';
import { getOpenMeteoForecast, lastOpenMeteoSuccessAt } from './open_meteo_weather.ts';
import { ApiError, errorBody, parseCoordinates } from './errors.ts';
import { getLocationsPayload } from './locations.ts';
import { createLlmClient, llmStatus } from './providers/llm.ts';
import { synthesizeSpeech, ttsStatus } from './providers/tts.ts';
import { getRiverErosion } from './erosion.ts';
import { liveHaor, liveStatus, liveUpazila, liveUpazilas } from './live.ts';
import { mapLayers } from './map_layers.ts';
import { askAiAssistant } from './ai_assistant.ts';
import { cropMenu } from '../../../packages/rotation-engine/src/data/crop_choice.ts';
import { cropsFromKeys, keypadMenu, landFromKey, replyFor, requestFromWords, understand } from './voice.ts';
import { awajConfig, bdMobile, sendKeypadSurvey, sendTemplateSurvey, sendTtsCall } from './awaj.ts';
import { createFarmAoi } from './cattle/aoi.ts';
import { cattleRepository } from './cattle/repository.ts';
import { backgroundJobManager } from './cattle/jobs.ts';
import { getEarthEngineReadiness, detectEarthEngineCredentialFiles } from './cattle/adapters/earth_engine.ts';
import { triggerModelTraining } from './cattle/ml_pipeline.ts';

const __filename = fileURLToPath(import.meta.url);
const gzipCache = new Map<string, { mtime: number; body: Buffer }>();
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../../../apps/saao-dashboard/public');

const featureRegistry = new FeatureRegistry();
const rotationEngine = new RotationEngine(featureRegistry);
const templateNarrator = new TemplateNarrator();
// Optional server-side LLM (OpenAI-compatible endpoint). Undefined when not configured: the deterministic template narrator is used.
const dualGateValidator = new DualGateNarrationValidator(createLlmClient() ?? undefined, { timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 15000 });

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

const DEFAULT_PRIORITIES = { water: 0.5, income: 0.3, soil: 0.2 };
const KEYPAD_PRIORITIES: Record<string, { label: string; labelEnglish: string; priorities: PlanOptionsRequest['farmerPriorities'] }> = {
  '1': { label: 'পানির নিরাপত্তা', labelEnglish: 'water security', priorities: { water: 1 } },
  '2': { label: 'সর্বোচ্চ আয়', labelEnglish: 'highest income', priorities: { income: 1 } },
  '3': { label: 'মাটির স্বাস্থ্য', labelEnglish: 'soil health', priorities: { soil: 1 } },
  '4': { label: 'কম কীটনাশক', labelEnglish: 'less pesticide', priorities: { pest: 1 } },
};
const PATTERN_BANGLA: Record<string, string> = {
  'Boro-Fallow-T. Aman': 'বোরো – পতিত – রোপা আমন',
};
const BMD_STATION_BANGLA: Record<string, string> = {
  '41895 ShahMokhdum': 'শাহ মখদুম, রাজশাহী (৪১৮৯৫)',
};
const RAIN_VERDICT_BANGLA: Record<string, string> = {
  'uncertain (estimates disagree)': 'অনিশ্চিত (তিনটি অনুমান মেলেনি)',
  dry: 'স্বাভাবিকের চেয়ে শুকনো',
  wet: 'স্বাভাবিকের চেয়ে বেশি',
  normal: 'স্বাভাবিক',
};

const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
const WRITE_TOKEN = process.env.API_WRITE_TOKEN?.trim() || '';

/** CORS is off unless CORS_ORIGINS is set ('*' or a comma-separated list), so the default is same-origin only. */
function applyCors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin;
  if (CORS_ORIGINS.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJSON(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, err: ApiError) {
  sendJSON(res, err.status, errorBody(err));
}

const MAX_BODY_BYTES = 1_000_000;
function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) { reject(new ApiError('invalid_input', 'Request body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        resolve(parsed);
      } catch {
        reject(new ApiError('invalid_input', 'Request body must be a valid JSON object'));
      }
    });
    req.on('error', reject);
  });
}

/** Crops a request names: an array of ids, or one comma-separated string ('sunflower,lentil'). */
function cropList(value: unknown): string[] | undefined {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const ids = list.map(v => String(v).trim().toLowerCase()).filter(Boolean);
  return ids.length ? ids : undefined;
}

/** Optional minimum protection for mutating cattle routes. When API_WRITE_TOKEN is set, a matching bearer token is required. */
function requireWriteToken(req: http.IncomingMessage) {
  if (!WRITE_TOKEN) return;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (given !== WRITE_TOKEN) throw new ApiError('unauthorized', 'A valid write token is required for this operation');
}

/** Today's NASA reading at a place from the daily live file, in the shape the engine takes; null without one. */
function currentConditionsFor(place: ReturnType<typeof placeFor>): PlanOptionsRequest['currentConditions'] {
  if (!place) return undefined;
  const live = liveUpazila({ id: place.kind === 'pilot' ? 'ADM3_Tanore' : place.id });
  if (!live?.power?.soilStatus) return undefined;
  return {
    date: live.power.date,
    soilStatus: live.power.soilStatus,
    soilRank: live.power.soilRank ?? null,
    soilYears: live.power.soilYears ?? null,
    rain30PctOfNormal: live.power.rain30PctOfNormal ?? null,
    source: 'NASA POWER daily, ranked against the same date in past years (research/live/daily_update.py)',
  };
}

function planRequest(body: any): PlanOptionsRequest {
  const place = placeFor(body.unionId || 'talanda_tanore');
  return {
    unionId: body.unionId || 'talanda_tanore',
    unionNameBangla: body.unionNameBangla || place?.nameBangla || 'তালন্দ ইউনিয়ন',
    upazila: body.upazila || place?.upazila || 'Tanore',
    district: body.district || place?.district || 'Rajshahi',
    // The farmer's land type when given; else the place's usual land (NASA NASADEM, Landsat and BRRI's survey)
    landType: body.landType || place?.defaultLandType || 'medium_high',
    landTypeAssumed: !body.landType,
    currentConditions: body.currentConditions ?? currentConditionsFor(place),
    season: body.season || '2026-aman',
    currentAmanCrop: body.currentAmanCrop,
    preferredCrops: cropList(body.preferredCrops),
    heroCrop: typeof body.heroCrop === 'string' && body.heroCrop.trim() ? body.heroCrop.trim().toLowerCase() : undefined,
    avoidCrops: cropList(body.avoidCrops),
    farmerPriorities: body.farmerPriorities || DEFAULT_PRIORITIES,
  };
}

/**
 * A farmer's sentence (typed, or from speech-to-text) -> the engine's plan for it -> the Bangla call script and SMS.
 * What the sentence names overrides the request's crops, land type and priorities.
 */
function voiceAnswer(body: any) {
  const heard = understand(String(body.text ?? ''));
  const words = requestFromWords(heard);
  const request = planRequest({
    ...body,
    ...words,
    ...(words.heroCrop ? { preferredCrops: words.preferredCrops ?? [] } : {}),
    avoidCrops: [...(words.avoidCrops ?? []), ...(cropList(body.avoidCrops) ?? [])],
  });
  const advice = adviseWithNarration(request, body.farmerId);
  return {
    understood: heard,
    request: { unionId: request.unionId, heroCrop: request.heroCrop ?? null, preferredCrops: request.preferredCrops ?? [], avoidCrops: request.avoidCrops ?? [], landType: request.landType, farmerPriorities: request.farmerPriorities },
    reply: replyFor(advice, heard),
    advice,
  };
}

/** Recent phone-channel events (Awaj survey answers and the call-backs they triggered), newest first. */
const CALL_LOG: Array<Record<string, unknown>> = [];
function logCall(event: Record<string, unknown>) {
  CALL_LOG.unshift({ at: new Date().toISOString(), ...event });
  CALL_LOG.length = Math.min(CALL_LOG.length, 50);
}
const maskPhone = (phone: string | null) => (phone ? `${phone.slice(0, 3)}XXXX${phone.slice(-4)}` : null);

/**
 * Engine advice plus the checked spoken script for the phone app's cached card. With a farmer ID, the Krishi
 * officer's latest field observation takes priority over the request's land type, Aman variety and priorities.
 */
function adviseWithNarration(request: PlanOptionsRequest, farmerId?: string): AdviceJSON {
  const advice = rotationEngine.generateAdvice(farmerId ? desk.planRequestForFarmer(farmerId, request) : request);
  if (farmerId) advice.verification = desk.verificationFor(farmerId);
  if (advice.farmer_card) {
    const narration = templateNarrator.render(advice, advice.options[0]);
    advice.farmer_card.audioScriptBangla = narration.banglaSpeechText;
    advice.farmer_card.audioDurationSeconds = narration.durationSecondsEstimate;
  }
  return advice;
}

function overview(placeId?: string | null) {
  const place = placeFor(placeId);
  if (!place) return null;
  return withPlace(place, () => overviewHere(place.id));
}

function overviewHere(placeId: string) {
  const advice = adviseWithNarration(planRequest({ unionId: placeId }));
  const best = advice.options[0];
  const bestAman = LOC.aman[best.cropSequence[0].variety];
  const dhan49 = LOC.aman['BRRI dhan49'];
  const local = advice.local_context;
  const rain = LOC.conditions.rainLast30Days;
  const smap = LOC.conditions.smap;

  return {
    scope: {
      district: LOC.kind === 'pilot' ? 'Rajshahi (রাজশাহী)' : LOC.district,
      upazila: LOC.kind === 'pilot' ? 'Tanore (তানোর)' : LOC.upazila,
      union: LOC.kind === 'pilot' ? 'Talanda (তালন্দ)' : null,
      union_id: LOC.id,
      place_kind: LOC.kind,
      data_note: LOC.dataNote,
      land_type: advice.scope.land_type,
      land_type_assumed: local?.landTypeAssumed ?? true,
      lat: LOC.conditions.lat,
      lon: LOC.conditions.lon,
    },
    data_release: {
      version: RELEASE.id,
      releaseDate: RELEASE.generatedOn,
      researchCommit: RELEASE.researchCommit,
      status: 'healthy',
      missingInputs: advice.stale_or_missing_inputs.map(m => m.dataset),
    },
    season_summary: {
      season: 'Aman 2026 (আমন ২০২৬)',
      dominantPattern: LOC.conditions.landUse?.topPattern ?? null,
      dominantPatternBangla: LOC.conditions.landUse ? (PATTERN_BANGLA[LOC.conditions.landUse.topPattern] ?? patternBangla(LOC.conditions.landUse.topPattern)) : null,
      dominantPatternPct: LOC.conditions.landUse?.topPatternPct ?? null,
      croppingIntensity: typeof LOC.conditions.landUse?.croppingIntensityPct === 'number' ? `${LOC.conditions.landUse.croppingIntensityPct}%` : null,
      landUseYear: LOC.conditions.landUse?.year ?? null,
      activeFarmersInUnion: null, // no farmer interviews yet
    },
    local_satellite_conditions: {
      smap: smap && {
        date: smap.date,
        rootZoneM3M3: smap.rootZoneM3M3,
        sameDatePastYears: smap.sameDatePastYears,
        nov10TypicalM3M3: smap.nov10TypicalM3M3,
        nov10Years: smap.nov10Years,
      },
      rain_last_30_days: rain && {
        from: rain.from,
        to: rain.to,
        imergLateMm: rain.imergLateMm,
        pctOfNormal: rain.pctOfNormal,
        lateFinalRatio: rain.lateFinalRatio,
        verdict: rain.verdict,
        verdictBangla: RAIN_VERDICT_BANGLA[rain.verdict] ?? rain.verdict,
      },
    },
    recommended: {
      rotationBangla: best.nameBangla,
      rotationEnglish: best.nameEnglish,
      amanVarietyBangla: best.cropSequence[0].varietyBangla,
      amanVariety: best.cropSequence[0].variety,
      fieldFreeDateBangla: best.fieldFreeDateBangla,
      fieldFreeDateEnglish: best.fieldFreeDateEnglish,
    },
    aman_replay: Object.values(LOC.aman).map(r => ({
      variety: r.variety,
      varietyBangla: AMAN_CATALOG[r.variety]?.varietyBangla ?? r.variety,
      noteBangla: AMAN_CATALOG[r.variety]?.noteBangla ?? '',
      noteEnglish: AMAN_CATALOG[r.variety]?.noteEnglish ?? '',
      rescueSeasons: r.rescueSeasons,
      totalSeasons: r.totalSeasons,
      floweringBangla: bnDate(r.flowering),
      floweringEnglish: enDate(r.flowering),
      fieldFreeBangla: bnDate(r.fieldFree),
      fieldFreeEnglish: enDate(r.fieldFree),
    })),
    local_context: local ?? null,
    active_alerts: [
      // The place's own hazards first (haor flash floods, deep water, a dry start, winter fallow on the coast)
      ...(local?.alerts ?? []).slice(0, 1).map(a => ({
        id: `alt_local_${a.hazard}`,
        type: 'warning',
        titleBangla: a.titleBangla,
        titleEnglish: a.titleEnglish,
        textBangla: a.textBangla,
        textEnglish: a.textEnglish,
        recommendationBangla: best.nameBangla,
        recommendationEnglish: best.nameEnglish,
      })),
      ...(bestAman ? [{
        id: 'alt_late_aman_drought',
        type: 'warning',
        titleBangla: 'দেরিতে ফুল আসা আমনে খরার ঝুঁকি',
        titleEnglish: 'Dry spells at flowering for late Aman',
        textBangla: `${bnDigits(dhan49.totalSeasons)} মৌসুমের ${bnDigits(dhan49.rescueSeasons)}টিতে (${bnDigits(Math.round((100 * dhan49.rescueSeasons) / dhan49.totalSeasons))}%) ${AMAN_CATALOG['BRRI dhan49'].varietyBangla}-এ ফুল আসার সময় (~${bnDate(dhan49.flowering)}) সম্পূরক সেচ লেগেছে।`,
        textEnglish: `In ${dhan49.rescueSeasons} of ${dhan49.totalSeasons} seasons (${Math.round((100 * dhan49.rescueSeasons) / dhan49.totalSeasons)}%) BRRI dhan49 needed rescue irrigation at flowering (~${enDate(dhan49.flowering)}).`,
        recommendationEnglish: `${best.cropSequence[0].variety} flowers ~${enDate(bestAman.flowering)} (irrigation in ${bestAman.rescueSeasons} seasons) and frees the field by ${enDate(bestAman.fieldFree)}, before dhan49's ${enDate(dhan49.fieldFree)}.`,
        recommendationBangla: `${best.cropSequence[0].varietyBangla} ফুল আনে ~${bnDate(bestAman.flowering)} (${bnDigits(bestAman.rescueSeasons)}টি মৌসুমে সেচ), আর জমি খালি করে ${bnDate(bestAman.fieldFree)}, ধান৪৯-এর ${bnDateOf(bnDate(dhan49.fieldFree))} আগে।`,
      }] : []),
    ],
    context: {
      soilTypeBangla: LOC.kind === 'pilot' ? LOC.srdi.soilTypeBangla : null,
      soilTypeEnglish: LOC.kind === 'pilot' ? 'Kharia soil (Barind)' : null,
      landTypeBangla: LOC.kind === 'pilot' ? LOC.srdi.landTypeBangla : `${LAND_TYPE_BANGLA[advice.scope.land_type] ?? ''} জমি`,
      landTypeEnglish: `${advice.scope.land_type.replace('_', '-')} land`,
      bmdStation: LOC.conditions.bmdStation,
      bmdStationBangla: BMD_STATION_BANGLA[LOC.conditions.bmdStation] ?? LOC.conditions.bmdStation,
      bmdStationKm: LOC.conditions.bmdStationKm,
      groundwater: LOC.conditions.groundwater,
      winterGreenness: LOC.conditions.winterGreenness,
      rootZoneGldasMm: LOC.conditions.rootZoneGldasMm,
      cattlePerKm2: LOC.conditions.cattlePerKm2,
    },
    early_warnings: earlyWarnings(),
    soil_carbon: TANORE_SOIL_CARBON,
    recent_farmer_contacts: farmerRows(),
    pest_reports: pestReports(),
  };
}

/** Is today inside the haor flash-flood season (15 Mar-15 May)? If not, when does the Sohra trigger re-arm? */
function haorStatus(today = new Date()) {
  const [m0, d0] = HAOR_FLASH_FLOOD.window[0].split('-').map(Number);
  const [m1, d1] = HAOR_FLASH_FLOOD.window[1].split('-').map(Number);
  const year = today.getUTCFullYear();
  const start = Date.UTC(year, m0 - 1, d0);
  const end = Date.UTC(year, m1 - 1, d1, 23, 59);
  if (today.getTime() >= start && today.getTime() <= end) return { state: 'in_season', nextStart: null };
  const next = today.getTime() < start ? start : Date.UTC(year + 1, m0 - 1, d0);
  return { state: 'off_season', nextStart: new Date(next).toISOString().slice(0, 10) };
}

/** Early warnings beyond the rotation: the haor flash flood (Dharmapasha), warming nights, cattle heat. */
function earlyWarnings() {
  const trend = (measure: string) => TANORE_ADVISORIES.heatTrends.find(t => t.measure === measure)!;
  const byVariety = (sowing: string) => HAOR_FLASH_FLOOD.escape.filter(e => e.sowing === sowing);
  const cattle = TANORE_ADVISORIES.cattleHeat;
  const peak = [...cattle].sort((a, b) => b.dangerShare - a.dangerShare)[0];
  return {
    haor: {
      pilotBangla: 'ধর্মপাশা, সুনামগঞ্জ হাওর',
      pilotEnglish: 'Dharmapasha, Sunamganj haor',
      status: haorStatus(),
      live: liveHaor(),
      window: HAOR_FLASH_FLOOD.window,
      watchMm: HAOR_FLASH_FLOOD.watchMm,
      warningMm: HAOR_FLASH_FLOOD.warningMm,
      skill: HAOR_FLASH_FLOOD.skill.filter(s => s.thresholdMm >= HAOR_FLASH_FLOOD.watchMm),
      escapeOnCalendar: byVariety('BRRI calendar'),
      escapeTwoWeeksEarly: byVariety('two weeks early'),
      seasons: HAOR_FLASH_FLOOD.seasons,
      source: HAOR_FLASH_FLOOD.source,
    },
    warmNights: {
      dhan71: trend('aman71_night_c'),
      dhan49: trend('aman49_night_c'),
      wheat20Nov: trend('wheat_20nov_days_gt30'),
      boroHotDays: trend('boro_days_ge35'),
    },
    cattleHeat: {
      months: cattle,
      noReliefMonths: cattle.filter(m => m.nightsWithoutReliefPct >= 99.5).map(m => m.month),
      peakMonth: peak.month,
      peakDangerShare: peak.dangerShare,
      coolestHours: peak.coolestHours,
      source: TANORE_ADVISORIES.cattleSource,
    },
  };
}

/** Union-level pest sightings from officers' latest field observations (farmer details stay officer-only). */
function pestReports() {
  const counts = new Map<string, { pest: string; bn: string; en: string; fields: number; highSeverity: number }>();
  for (const f of desk.farmers()) {
    const obs = desk.latestObservation(f.id);
    if (!obs || obs.pestSeen === 'none') continue;
    const entry = counts.get(obs.pestSeen) ?? { pest: obs.pestSeen, ...desk.PEST_NAMES[obs.pestSeen], fields: 0, highSeverity: 0 };
    entry.fields += 1;
    if (obs.pestSeverity === 'high') entry.highSeverity += 1;
    counts.set(obs.pestSeen, entry);
  }
  return [...counts.values()];
}

/** Sample farmer rows for the overview, each with its own officer-aware top rotation. */
function farmerRows() {
  const openCallbacks = new Set(desk.callbacks().filter(c => c.status === 'open').map(c => c.farmerId));
  const short = (o: CandidateRotation) => ({
    bn: `${(o.cropSequence[0].varietyBangla ?? o.cropSequence[0].variety).replace('ব্রি ', '')} → ${o.cropSequence[1].cropBangla ?? o.cropSequence[1].crop}`,
    en: `${o.cropSequence[0].variety.replace('BRRI ', '')} → ${o.cropSequence[1].crop}`,
  });
  return desk.farmers().map(f => {
    const advice = adviseWithNarration(planRequest({}), f.id);
    const next = short(advice.options[0]);
    const nowOption = advice.options.find(o => o.id === advice.this_season_option_id);
    const now = nowOption ? short(nowOption) : null;
    const verified = Boolean(desk.latestObservation(f.id));
    return {
      farmerId: f.id,
      name: f.nameBangla,
      nameEnglish: f.nameEnglish,
      village: f.villageBangla,
      villageEnglish: f.villageEnglish,
      landType: f.landType,
      rotation: now?.bn ?? next.bn,
      rotationEnglish: now?.en ?? next.en,
      nextSeasonRotation: now && now.bn !== next.bn ? next.bn : null,
      nextSeasonRotationEnglish: now && now.en !== next.en ? next.en : null,
      status: openCallbacks.has(f.id) ? 'callback' : verified ? 'verified' : 'pending',
      sample: f.sample,
    };
  });
}

/** Officer-only reference: the full SRDI card, replay details, IPM steps and data caveats. */
function knowledgePack() {
  const advice = adviseWithNarration(planRequest({}));
  const rabiKeys = Object.keys(LOC.rabi).filter(k => k !== 'BARI Gom 33 (Late)');
  return {
    srdi: {
      soilTypeBangla: LOC.srdi.soilTypeBangla,
      landTypeBangla: LOC.srdi.landTypeBangla,
      source: LOC.srdi.source,
      rows: [
        { cropBangla: 'আমন ধান', cropEnglish: 'Aman rice', dose: LOC.srdi.aman },
        ...rabiKeys.map(k => ({ cropBangla: RABI_CATALOG[k].cropBangla, cropEnglish: RABI_CATALOG[k].crop, dose: LOC.rabi[k].fertilizer })),
      ],
    },
    amanReplay: Object.values(LOC.aman).map(r => ({
      variety: r.variety,
      varietyBangla: AMAN_CATALOG[r.variety]?.varietyBangla ?? r.variety,
      rescueSeasons: r.rescueSeasons,
      totalSeasons: r.totalSeasons,
      rescueYears: r.rescueYears,
      floweringEnglish: enDate(r.flowering),
      floweringBangla: bnDate(r.flowering),
      fieldFreeEnglish: enDate(r.fieldFree),
      fieldFreeBangla: bnDate(r.fieldFree),
      cropWaterUseMm: r.cropWaterUseMm,
    })),
    rabiReplay: Object.entries(LOC.rabi).map(([key, r]) => ({
      key,
      cropBangla: RABI_CATALOG[key].cropBangla,
      cropEnglish: RABI_CATALOG[key].crop,
      sowingEnglish: enDate(r.sowing),
      sowingBangla: bnDate(r.sowing),
      windowEnglish: r.sowingWindow ? `${enDate(r.sowingWindow[0])}-${enDate(r.sowingWindow[1])}` : null,
      windowSource: r.sowingWindowSource,
      netIrrigationMm: r.netIrrigationMm,
      netIrrigationRangeMm: r.netIrrigationRangeMm,
      heat: r.heat,
    })),
    ipm: {
      general: IPM_GENERAL,
      aman: IPM_AMAN,
      byRabi: Object.entries(IPM_BY_RABI).map(([key, tips]) => ({ key, cropBangla: RABI_CATALOG[key].cropBangla, cropEnglish: RABI_CATALOG[key].crop, tips })),
    },
    caveats: [
      { bn: `IMERG Late ২০২৩ থেকে Final-এর চেয়ে কম বৃষ্টি দেখায় (তানোরে অনুপাত ${bnDigits(LOC.conditions.rainLast30Days.lateFinalRatio)}); সাম্প্রতিক বৃষ্টির রায় তিনটি অনুমান মিলিয়ে দেওয়া হয়।`, en: `IMERG Late reads dry against Final since 2023 (ratio ${LOC.conditions.rainLast30Days.lateFinalRatio} at Tanore); recent rain is judged from three estimates.` },
      { bn: 'বৃষ্টি ও মাটির রস ~১০ কিমি ও ৯ কিমি গ্রিডের গড়, একক জমির নয়।', en: 'Rain and soil moisture are ~10 km and 9 km grid averages, not single fields.' },
      { bn: 'আয়ের স্কোর দলের অনুমান; DAM দর ও কৃষকের খরচ বাকি।', en: 'Income scores are team estimates until DAM prices and farmer costs are in.' },
      { bn: 'বালাই স্কোর নিয়মভিত্তিক; মাঠে পোকা গোনার তথ্য কর্মকর্তার পর্যবেক্ষণ থেকে আসবে।', en: 'The pest score is rule-based; field pest counts will come from officer observations.' },
      { bn: 'বরেন্দ্রে বন্যা মডেল করা হয়নি; জমির শ্রেণি থেকে ধরা।', en: 'Floods are not modelled for Barind land; the score follows the land-type class.' },
    ],
    saaoNotes: advice.saao_technical_notes,
    cattleHeat: TANORE_ADVISORIES.cattleHeat,
    haorSkill: HAOR_FLASH_FLOOD.skill,
    haorEscape: HAOR_FLASH_FLOOD.escape,
  };
}

/** Everything the officer desk screen shows in one call. */
function deskView(officer: (typeof desk.OFFICERS)[number]) {
  const queue = desk.queue();
  return {
    officer,
    pestNames: desk.PEST_NAMES,
    queue,
    callbacks: desk.callbacks(),
    farmers: desk.farmers().map(f => {
      const advice = adviseWithNarration(planRequest({}), f.id);
      const top = advice.options[0];
      return {
        farmer: f,
        observation: desk.latestObservation(f.id) ?? null,
        queue: queue.find(q => q.farmerId === f.id) ?? null,
        advice: {
          topOptionBangla: top.nameBangla,
          topOptionEnglish: top.nameEnglish,
          fieldFreeBangla: top.fieldFreeDateBangla,
          fieldFreeEnglish: top.fieldFreeDateEnglish,
          thisSeason: advice.this_season,
          thisSeasonOptionBangla: advice.options.find(o => o.id === advice.this_season_option_id)?.nameBangla ?? null,
          thisSeasonOptionEnglish: advice.options.find(o => o.id === advice.this_season_option_id)?.nameEnglish ?? null,
          pestScore: top.scores.pest,
          verification: advice.verification,
        },
      };
    }),
  };
}

function dataRelease() {
  return {
    releaseVersion: RELEASE.id,
    releaseDate: RELEASE.generatedOn,
    researchCommit: RELEASE.researchCommit,
    generator: RELEASE.generator,
    pilotSitesCovered: 1,
    modelledUnions: SUPPORTED_UNIONS,
    datasets: [
      { name: 'NASA POWER (daily)', parameter: 'Tmax, Tmin, dew point, wind, radiation -> FAO-56 ET0', timePeriod: '2001-2025', spatialResolution: '0.5° x 0.625°', latency: '~2-3 days', freshness: 'research release', groundCorrection: `Tmax/Tmin bias-corrected by month against BMD ${LOC.conditions.bmdStation} (NOAA GSOD, ${LOC.conditions.bmdStationKm} km)`, status: 'operational' },
      { name: 'NASA GPM IMERG Final (daily, via POWER)', parameter: 'Rain for the 25-season water-balance replay', timePeriod: '2001-2025', spatialResolution: '0.1° (~10 km)', latency: '~3.5 months', freshness: 'research release', groundCorrection: 'Checked against the BMD Rajshahi gauge (Jun-Oct)', status: 'operational' },
      { name: 'NASA GPM IMERG Late (daily, via Giovanni)', parameter: 'Rain in the last 30 days', timePeriod: `${LOC.conditions.rainLast30Days.from} to ${LOC.conditions.rainLast30Days.to}`, spatialResolution: '0.1° (~10 km)', latency: '~14 hours', freshness: 'recent', groundCorrection: `Late reads dry against Final since 2023 (ratio ${LOC.conditions.rainLast30Days.lateFinalRatio}); cross-checked with Final-scaled Late and MERRA-2`, status: 'cross-checked' },
      { name: 'NASA SMAP L4 (SPL4SMGP v008)', parameter: 'Root-zone soil moisture (0-100 cm)', timePeriod: `2023-09-27 to ${LOC.conditions.smap?.date ?? 'n/a'}`, spatialResolution: '9 km', latency: '~2-3 days', freshness: 'recent', groundCorrection: `Agrees with GLDAS-2.2 root zone (Spearman ${LOC.conditions.rootZoneGldasMm.smapSpearman})`, status: 'operational' },
      { name: 'NASA GLDAS-2.2 CLSM (GRACE-assimilated)', parameter: 'Groundwater storage and root-zone water', timePeriod: '2003-2025', spatialResolution: '0.25°', latency: 'monthly updates', freshness: 'research release', groundCorrection: 'GRACE/GRACE-FO terrestrial water storage assimilated', status: 'operational' },
      { name: 'NASA MODIS MOD13Q1', parameter: 'NDVI: crop cycles and winter crop cover', timePeriod: '2001-2026', spatialResolution: '250 m (median of 9 x 9 pixels)', latency: '16 days', freshness: 'research release', groundCorrection: 'Landscape around the pilot point, not single fields', status: 'operational' },
      { name: 'SRDI Fertilizer Recommendation System', parameter: 'Talanda union card: soil type, land type, fertilizer doses', timePeriod: 'current card', spatialResolution: 'Union (Talanda)', latency: 'static', freshness: 'current', groundCorrection: 'SRDI soil-test based recommendations', status: 'operational' },
      { name: 'BRRI / BARI / BWMRI handbooks', parameter: 'Durations, seedbed and sowing windows', timePeriod: 'current editions', spatialResolution: 'National', latency: 'static', freshness: 'current', groundCorrection: 'Research station trials', status: 'operational' },
      { name: 'FAO GLW4 cattle (2015)', parameter: 'Cattle per km² for the fodder score', timePeriod: '2015', spatialResolution: 'District', latency: 'static', freshness: 'dated', groundCorrection: 'Gridded census model', status: 'operational' },
      { name: 'Farm-gate prices (DAM) and farmer costs', parameter: 'Income score', timePeriod: 'pending', spatialResolution: '-', latency: '-', freshness: 'missing', groundCorrection: 'Income uses illustrative team estimates until collected', status: 'missing' },
    ],
    missingValuePolicy: 'Missing days stay missing and are reported, never filled with zero. POWER temperatures are bias-corrected by month against the nearest BMD station. Recent IMERG Late rain is never judged alone: it is compared with Final-scaled Late and MERRA-2.',
  };
}

/** Real capability/status report. Nothing here is hardcoded "operational": each entry reflects configuration or the last real call. */
async function capabilities() {
  const ee = await getEarthEngineReadiness();
  return {
    api: { version: 'v1', time: new Date().toISOString() },
    weatherForecast: {
      provider: 'Open-Meteo',
      kind: 'model_estimate',
      apiKeyConfigured: Boolean(process.env.OPEN_METEO_API_KEY?.trim()),
      lastSuccessAt: lastOpenMeteoSuccessAt,
      status: lastOpenMeteoSuccessAt ? 'last_request_succeeded' : 'not_yet_requested',
    },
    nasaPower: {
      provider: 'NASA POWER (community AG)',
      kind: 'satellite_delayed',
      live: false,
      latency: '2-3 days',
      lastSuccessAt: lastNasaSuccessAt,
      status: lastNasaSuccessAt ? 'last_request_succeeded' : 'not_yet_requested',
    },
    earthEngine: {
      status: ee.status,
      reason: ee.reason,
      details: ee.details,
      setupInstructions: ee.status === 'ready' ? undefined : ee.setupInstructions,
      credentialFilesDetected: detectEarthEngineCredentialFiles(),
      checkedAt: ee.checkedAt,
    },
    llm: llmStatus(),
    tts: ttsStatus(),
    mlModels: {
      supervisedHeatStress: 'training_data_unavailable',
      supervisedForageBiomass: 'training_data_unavailable',
      milkLossPredictor: 'training_data_unavailable',
      diseaseRiskPredictor: 'training_data_unavailable',
      ruleBasedBaseline: 'rule_based_thi (not a trained model)',
    },
    jobs: {
      persistence: 'local_file',
      productionDurable: false,
      note: 'Jobs run in-process and are stored in a local JSON file. A restart interrupts running jobs; they are marked failed and can be retried.',
      storeLoadError: cattleRepository.loadError,
      lastWriteError: cattleRepository.lastPersistError,
    },
    writeProtection: { cattleWriteTokenRequired: Boolean(WRITE_TOKEN) },
  };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ---- Capability / status ------------------------------------------------------------------
    if (pathname === '/api/v1/config' && req.method === 'GET') {
      return sendJSON(res, 200, await capabilities());
    }

    // ---- Bangladesh districts and upazilas (shared by website and Android) -----------------------
    if (pathname === '/api/v1/locations' && req.method === 'GET') {
      return sendJSON(res, 200, getLocationsPayload());
    }

    // ---- Pilot-site (Talanda, Tanore) rotation planning ----------------------------------------
    if (pathname === '/api/v1/overview' && req.method === 'GET') {
      const ov = overview(url.searchParams.get('place'));
      return ov ? sendJSON(res, 200, ov) : sendJSON(res, 422, { error: 'No research data for this place yet' });
    }

    // API: the crops a farmer can ask for at a place, and after which Aman varieties each one fits
    if (pathname === '/api/v1/crops' && req.method === 'GET') {
      const place = placeFor(url.searchParams.get('place'));
      if (!place) return sendJSON(res, 422, { error: 'No research data for this place yet' });
      return sendJSON(res, 200, { place: place.id, crops: withPlace(place, () => cropMenu()), keypad: keypadMenu() });
    }

    // API: what a farmer asked for, from a sentence in Bangla, Banglish or English
    if (pathname === '/api/v1/voice/understand' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJSON(res, 200, understand(String(body.text ?? '')));
    }

    // API: sentence -> plan -> spoken Bangla reply and SMS (the phone channel without the phone)
    if (pathname === '/api/v1/voice/answer' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJSON(res, 200, voiceAnswer(body));
    }

    // API: phone calls through Awaj Digital (dry runs until AWAJ_API_TOKEN, AWAJ_SENDER and AWAJ_LIVE=1 are set)
    if (pathname === '/api/v1/calls/status' && req.method === 'GET') {
      const cfg = awajConfig();
      return sendJSON(res, 200, {
        provider: 'Awaj Digital', live: cfg.live, tokenSet: cfg.tokenSet, senderSet: Boolean(cfg.sender), voice: cfg.voice,
        keypadReady: Boolean(cfg.menuVoice || cfg.surveyTemplate), webhookSet: Boolean(cfg.webhookUrl), keypad: keypadMenu(),
      });
    }
    if (pathname === '/api/v1/calls/advice' && req.method === 'POST') {
      const body = await parseBody(req);
      // A real, billed call needs a signed-in officer; a dry run shows what would be sent
      if (awajConfig().live && !desk.officerForToken(req.headers.authorization)) {
        return sendJSON(res, 401, { error: 'Officer sign-in required to place a real call' });
      }
      const phone = bdMobile(String(body.phone ?? ''));
      if (!phone) return sendJSON(res, 400, { error: 'phone must be a Bangladeshi mobile number (01XXXXXXXXX)' });
      const answer = body.text ? voiceAnswer(body) : { reply: replyFor(adviseWithNarration(planRequest(body), body.farmerId)) };
      const sent = await sendTtsCall({ phoneNumbers: [phone], texts: [answer.reply.speechBangla], metadata: { channel: 'mather-kotha', unionId: body.unionId ?? 'talanda_tanore', option: answer.reply.topOptionId } });
      logCall({ kind: 'advice_call', phone: maskPhone(phone), crops: answer.reply.understoodCrops, dryRun: sent.dryRun });
      return sendJSON(res, 200, { reply: answer.reply, call: sent });
    }
    // The keypad call: the farmer hears the recorded crop menu and presses keys; Awaj posts them to the webhook
    if (pathname === '/api/v1/calls/keypad' && req.method === 'POST') {
      const body = await parseBody(req);
      if (awajConfig().live && !desk.officerForToken(req.headers.authorization)) {
        return sendJSON(res, 401, { error: 'Officer sign-in required to place a real call' });
      }
      const phones = (Array.isArray(body.phones) ? body.phones : [body.phone]).map((p: unknown) => bdMobile(String(p ?? ''))).filter(Boolean) as string[];
      if (!phones.length) return sendJSON(res, 400, { error: 'phone must be a Bangladeshi mobile number (01XXXXXXXXX)' });
      const cfg = awajConfig();
      // A template that also asks how deep the field floods (AWAJ_LAND_QUESTION=1) answers it last
      const landQuestion = Boolean(cfg.surveyTemplate) && process.env.AWAJ_LAND_QUESTION === '1';
      const metadata = { channel: 'mather-kotha-keypad', unionId: body.unionId ?? 'talanda_tanore', farmerId: body.farmerId ?? null, landQuestion };
      const menu = keypadMenu();
      const sent = cfg.surveyTemplate
        ? await sendTemplateSurvey({ phoneNumbers: phones, templateName: cfg.surveyTemplate, webhookUrl: cfg.webhookUrl ?? undefined, metadata })
        : await sendKeypadSurvey({
            phoneNumbers: phones,
            questionVoice: cfg.menuVoice ?? '<AWAJ_MENU_VOICE: the recorded crop menu>',
            options: menu.options,
            officerKey: menu.officerKey,
            officerNumber: cfg.officerNumber ?? undefined,
            webhookUrl: cfg.webhookUrl ?? undefined,
            metadata,
          });
      logCall({ kind: 'keypad_call', phones: phones.map(maskPhone), dryRun: sent.dryRun });
      return sendJSON(res, 200, { call: sent, menu: menu.promptBangla, needs: [
        cfg.menuVoice || cfg.surveyTemplate ? null : 'AWAJ_MENU_VOICE (an approved recording of the menu) or AWAJ_SURVEY_TEMPLATE',
        cfg.webhookUrl ? null : 'PUBLIC_BASE_URL (where Awaj can reach this server) for the pressed keys',
      ].filter(Boolean) });
    }

    if (pathname === '/api/v1/calls/survey-webhook' && req.method === 'POST') {
      // Awaj posts once when a keypad survey completes. Optional shared secret in the webhook URL (?key=...).
      if (process.env.AWAJ_WEBHOOK_KEY && url.searchParams.get('key') !== process.env.AWAJ_WEBHOOK_KEY) {
        return sendJSON(res, 401, { error: 'Unknown webhook key' });
      }
      const body = await parseBody(req);
      const unionId = String(body.metadata?.unionId ?? 'talanda_tanore');
      const handled = [];
      for (const r of Array.isArray(body.results) ? body.results : []) {
        const phone = bdMobile(String(r.phone_number ?? ''));
        if (!phone || r.status !== 'answered') continue;
        const keys: string[] = Array.isArray(r.responses) ? r.responses.map(String) : [String(r.response ?? '')];
        // With the land question the last key is the land (1 high ... 4 low); the others name crops
        const landType = body.metadata?.landQuestion ? landFromKey(keys[keys.length - 1]) : undefined;
        const { crops, officer } = cropsFromKeys(body.metadata?.landQuestion ? keys.slice(0, -1) : keys);
        const callback = officer ? desk.requestCallback(String(body.metadata?.farmerId ?? 'F01'), 'ivr_keypad_9') : null;
        const reply = crops.length ? replyFor(adviseWithNarration(planRequest({ unionId, preferredCrops: crops, landType }))) : null;
        const sent = reply ? await sendTtsCall({ phoneNumbers: [phone], texts: [reply.speechBangla], metadata: { channel: 'mather-kotha', surveyId: body.survey_id, unionId } }) : null;
        logCall({ kind: 'survey_answer', surveyId: body.survey_id, phone: maskPhone(phone), keys: r.responses ?? [r.response], crops, landType: landType ?? null, officer, callbackId: callback?.id ?? null, dryRun: sent?.dryRun ?? null });
        handled.push({ phone: maskPhone(phone), crops, landType: landType ?? null, officer, callBack: sent ? { dryRun: sent.dryRun } : null });
      }
      return sendJSON(res, 200, { ok: true, handled });
    }

    // API: every place the engine can advise (the pilot and all upazilas)
    if (pathname === '/api/v1/places' && req.method === 'GET') {
      return sendJSON(res, 200, { pilot: { id: 'talanda_tanore', name: 'Talanda union', upazila: 'Tanore', district: 'Rajshahi' }, upazilas: listPlaces() });
    }

    if (pathname === '/api/v1/advice' && req.method === 'POST') {
      const body = await parseBody(req);
      return sendJSON(res, 200, adviseWithNarration(planRequest(body), body.farmerId));
    }

    // Narration: numeric advice is computed by the rotation engine; an LLM (if configured) only words approved facts,
    // and the dual-gate validator falls back to the deterministic template if the wording fails the audit.
    if (pathname === '/api/v1/narrate' && req.method === 'POST') {
      const body = await parseBody(req);
      const advice = body.advice;
      const option = advice?.options?.find((o: any) => o.id === body.selectedOptionId) || advice?.options?.[0];
      if (!advice || !option) throw new ApiError('invalid_input', 'Advice object and option are required');
      const result = await dualGateValidator.narrate(advice, option);
      return sendJSON(res, 200, { ...result, llm: llmStatus() });
    }

    // Simulated IVR keypad: no call is placed. Clearly labelled so clients never show it as a delivered call.
    if (pathname === '/api/v1/channel-events' && req.method === 'POST') {
      const body = await parseBody(req);
      const keypad = String(body.keypad || '1');
      const choice = KEYPAD_PRIORITIES[keypad];
      const landType = landFromKey(body.landKey);
      const top = choice ? rotationEngine.generateAdvice(planRequest({ unionId: body.unionId, farmerPriorities: choice.priorities, landType })).options[0] : null;
      const callback = keypad === '9' ? desk.requestCallback(String(body.farmerId || 'F01'), 'ivr_keypad_9') : null;

      return sendJSON(res, 200, {
        simulated: true,
        callId: `sim_${Date.now()}`,
        status: 'simulated',
        keypadInput: keypad,
        acknowledgementBangla: top
          ? `আপনার পছন্দ "${choice.label}" নথিভুক্ত হয়েছে। এই অগ্রাধিকারে শীর্ষে: ${top.nameBangla}।`
          : 'আপনার অনুরোধ কৃষি কর্মকর্তার কাছে পাঠানো হয়েছে; তিনি আপনাকে ফোন করবেন।',
        acknowledgementEnglish: top
          ? `Your choice "${choice.labelEnglish}" is recorded. Top option for it: ${top.nameEnglish}.`
          : 'Your request went to your Krishi officer, who will call you back.',
        topOptionId: top?.id ?? null,
        callbackId: callback?.id ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    // API: haor flash-flood early warning (IMERG at Sohra, 25-season hindcast and today's status)
    // API: daily NASA conditions for every upazila (research/live/daily_update.py)
    if (pathname === '/api/v1/live/status' && req.method === 'GET') {
      const st = liveStatus();
      return st ? sendJSON(res, 200, st) : sendJSON(res, 404, { error: 'No daily NASA update yet; run research/live/daily_update.py' });
    }
    if (pathname === '/api/v1/live/upazilas' && req.method === 'GET') {
      const rows = liveUpazilas(url.searchParams.get('district') || undefined);
      return rows ? sendJSON(res, 200, { upazilas: rows }) : sendJSON(res, 404, { error: 'No daily NASA update yet' });
    }
    if (pathname === '/api/v1/live/upazila' && req.method === 'GET') {
      const lat = url.searchParams.get('lat'), lon = url.searchParams.get('lon');
      const one = liveUpazila({ id: url.searchParams.get('id'), name: url.searchParams.get('name'),
        lat: lat === null ? undefined : Number(lat), lon: lon === null ? undefined : Number(lon) });
      return one ? sendJSON(res, 200, one) : sendJSON(res, 404, { error: 'Upazila not found; pass id, name, or lat and lon' });
    }

    // API: one row per upazila for the dashboard's map (MODIS, NASA replay, GLDAS, PEST-CHEMGRIDS, SRDI, today's NASA update)
    if (pathname === '/api/v1/map/upazilas' && req.method === 'GET') {
      return sendJSON(res, 200, mapLayers());
    }

    if (pathname === '/api/v1/haor/flash-flood' && req.method === 'GET') {
      return sendJSON(res, 200, { ...HAOR_FLASH_FLOOD, status: haorStatus(), live: liveHaor() });
    }

    // ---- Weather ---------------------------------------------------------------------------------
    // Open-Meteo numerical model estimate (current + hourly incl. humidity + daily) for the requested coordinates.
    if (pathname === '/api/v1/weather/forecast' && req.method === 'GET') {
      const { lat, lon } = parseCoordinates(url.searchParams.get('lat'), url.searchParams.get('lon'));
      const forecast = await getOpenMeteoForecast(lat, lon);
      return sendJSON(res, 200, { location: { lat, lon }, source: forecast.source, forecast });
    }

    // NASA POWER delayed observations for the requested coordinates. Never live, never a forecast.
    if (pathname === '/api/v1/weather' && req.method === 'GET') {
      const { lat, lon } = parseCoordinates(url.searchParams.get('lat'), url.searchParams.get('lon'));
      return sendJSON(res, 200, await getNasaWeather(lat, lon));
    }

    if (pathname === '/api/v1/erosion' && req.method === 'GET') {
      return sendJSON(res, 200, getRiverErosion(url.searchParams.get('river') || 'jamuna'));
    }

    // Rule-based assistant (not an LLM): answers only from provider data and reference cards.
    if (pathname === '/api/v1/ai/ask' && req.method === 'POST') {
      const body = await parseBody(req);
      if (typeof body.query !== 'string' || !body.query.trim()) throw new ApiError('invalid_input', 'query is required');
      return sendJSON(res, 200, await askAiAssistant(body));
    }

    // ---- Text to speech (separate from text generation) -----------------------------------------
    if (pathname === '/api/v1/tts' && req.method === 'POST') {
      const body = await parseBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > 2000) throw new ApiError('invalid_input', 'text is required (max 2000 characters)');
      const audio = await synthesizeSpeech(text, typeof body.language === 'string' ? body.language : 'bn');
      res.writeHead(200, { 'Content-Type': audio.contentType, 'Content-Length': audio.audio.length });
      return res.end(audio.audio);
    }

    // ---- Cattle AOI data and advisory pipeline ---------------------------------------------------
    if (pathname === '/api/v1/cattle/readiness' && req.method === 'GET') {
      const c = await capabilities();
      return sendJSON(res, 200, {
        earthEngine: c.earthEngine,
        weatherForecast: c.weatherForecast,
        nasaPower: c.nasaPower,
        mlModels: c.mlModels,
        jobs: c.jobs,
      });
    }

    if (pathname === '/api/v1/cattle/aois' && req.method === 'GET') {
      return sendJSON(res, 200, { aois: await cattleRepository.listAois() });
    }

    if (pathname === '/api/v1/cattle/aois' && req.method === 'POST') {
      requireWriteToken(req);
      const body = await parseBody(req);
      const aoi = createFarmAoi(body); // throws invalid_input
      await cattleRepository.saveAoi(aoi);
      const initialJob = await backgroundJobManager.enqueueJob(aoi.aoiId, 'pipeline_refresh');
      return sendJSON(res, 201, { aoi, job: initialJob });
    }

    const cattleAdvMatch = /^\/api\/v1\/cattle\/aois\/([^/]+)\/advisory$/.exec(pathname);
    if (cattleAdvMatch && req.method === 'GET') {
      const aoiId = decodeURIComponent(cattleAdvMatch[1]);
      if (!(await cattleRepository.getAoi(aoiId))) throw new ApiError('not_found', `AOI "${aoiId}" not found`);
      // Advisories are produced only by completed jobs. Reading never computes one from partial inputs.
      const advisory = await cattleRepository.getLatestAdvisory(aoiId);
      if (!advisory) throw new ApiError('no_data', 'No advisory has been produced for this AOI yet. Check its jobs.', { jobsUrl: `/api/v1/cattle/jobs?aoiId=${encodeURIComponent(aoiId)}` });
      return sendJSON(res, 200, { advisory });
    }

    const cattleAoiMatch = /^\/api\/v1\/cattle\/aois\/([^/]+)$/.exec(pathname);
    if (cattleAoiMatch && req.method === 'GET') {
      const aoiId = decodeURIComponent(cattleAoiMatch[1]);
      const aoi = await cattleRepository.getAoi(aoiId);
      if (!aoi) throw new ApiError('not_found', `AOI "${aoiId}" not found`);
      return sendJSON(res, 200, { aoi, latestAdvisory: await cattleRepository.getLatestAdvisory(aoiId) });
    }

    if (cattleAoiMatch && req.method === 'DELETE') {
      requireWriteToken(req);
      const aoiId = decodeURIComponent(cattleAoiMatch[1]);
      if (!(await cattleRepository.deleteAoi(aoiId))) throw new ApiError('not_found', `AOI "${aoiId}" not found`);
      return sendJSON(res, 200, { deleted: true, aoiId });
    }

    if (pathname === '/api/v1/cattle/jobs' && req.method === 'GET') {
      return sendJSON(res, 200, { jobs: await cattleRepository.listJobs(url.searchParams.get('aoiId') || undefined) });
    }

    if (pathname === '/api/v1/cattle/jobs' && req.method === 'POST') {
      requireWriteToken(req);
      const body = await parseBody(req);
      if (typeof body.aoiId !== 'string' || !body.aoiId) throw new ApiError('invalid_input', 'aoiId is required');
      const job = await backgroundJobManager.enqueueJob(body.aoiId, body.jobType || 'pipeline_refresh');
      return sendJSON(res, 202, { job });
    }

    const cattleJobRetry = /^\/api\/v1\/cattle\/jobs\/([^/]+)\/retry$/.exec(pathname);
    if (cattleJobRetry && req.method === 'POST') {
      requireWriteToken(req);
      return sendJSON(res, 202, { job: await backgroundJobManager.retryJob(decodeURIComponent(cattleJobRetry[1])) });
    }

    const cattleJobMatch = /^\/api\/v1\/cattle\/jobs\/([^/]+)$/.exec(pathname);
    if (cattleJobMatch && req.method === 'GET') {
      const job = await cattleRepository.getJob(decodeURIComponent(cattleJobMatch[1]));
      if (!job) throw new ApiError('not_found', `Job "${decodeURIComponent(cattleJobMatch[1])}" not found`);
      return sendJSON(res, 200, { job });
    }

    if (pathname === '/api/v1/cattle/models/train' && req.method === 'POST') {
      requireWriteToken(req);
      const body = await parseBody(req);
      const aoi = body.aoiId ? await cattleRepository.getAoi(body.aoiId) : undefined;
      const result = await triggerModelTraining(body.target || 'heat_stress_panting', aoi || undefined);
      return sendJSON(res, 200, result);
    }

    // ---- Authentication (demo accounts) ----------------------------------------------------------
    if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const session = desk.loginUser(body);
      if (!session) throw new ApiError('unauthorized', 'Invalid login credentials');
      return sendJSON(res, 200, session);
    }
    if (pathname === '/api/v1/auth/session' && req.method === 'GET') {
      const user = desk.userForToken(req.headers.authorization);
      if (!user) throw new ApiError('unauthorized', 'No active session');
      return sendJSON(res, 200, { user });
    }
    if (pathname === '/api/v1/auth/logout' && req.method === 'POST') {
      return sendJSON(res, 200, { ok: desk.logout(req.headers.authorization) });
    }

    // ---- Krishi officer desk -----------------------------------------------------------------------
    if (pathname === '/api/v1/officers' && req.method === 'GET') {
      return sendJSON(res, 200, desk.OFFICERS);
    }
    if (pathname === '/api/v1/officer/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const session = desk.login(String(body.officerId ?? ''), String(body.accessCode ?? ''));
      if (!session) throw new ApiError('unauthorized', 'Wrong officer ID or access code');
      return sendJSON(res, 200, session);
    }
    if (pathname.startsWith('/api/v1/officer/')) {
      const officer = desk.officerForToken(req.headers.authorization);
      if (!officer) throw new ApiError('unauthorized', 'Officer sign-in required');
      if (pathname === '/api/v1/officer/desk' && req.method === 'GET') {
        return sendJSON(res, 200, deskView(officer));
      }
      if (pathname === '/api/v1/officer/observations' && req.method === 'POST') {
        const body = await parseBody(req);
        const result = desk.addObservation(officer.id, body);
        if (result.error) throw new ApiError('invalid_input', result.error);
        return sendJSON(res, 200, { observation: result.observation, advice: adviseWithNarration(planRequest({}), body.farmerId) });
      }
      const resolve = /^\/api\/v1\/officer\/callbacks\/([^/]+)\/resolve$/.exec(pathname);
      if (resolve && req.method === 'POST') {
        const request = desk.resolveCallback(decodeURIComponent(resolve[1]));
        if (!request) throw new ApiError('not_found', 'Unknown call-back request');
        return sendJSON(res, 200, request);
      }
      if (pathname === '/api/v1/officer/calls' && req.method === 'GET') {
        return sendJSON(res, 200, { calls: CALL_LOG, provider: awajConfig() });
      }
      if (pathname === '/api/v1/officer/knowledge' && req.method === 'GET') {
        return sendJSON(res, 200, knowledgePack());
      }
      if (pathname === '/api/v1/officer/reset' && req.method === 'POST') {
        desk.resetDesk();
        return sendJSON(res, 200, { ok: true });
      }
      throw new ApiError('not_found', 'Unknown officer endpoint');
    }

    if (pathname === '/api/v1/data-release' && req.method === 'GET') {
      return sendJSON(res, 200, dataRelease());
    }

    // Unknown API paths are JSON 404s, never the HTML page.
    if (pathname.startsWith('/api/')) {
      throw new ApiError('not_found', `No such endpoint: ${req.method} ${pathname}`);
    }

    // ---- Static website ---------------------------------------------------------------------------
    const requested = path.resolve(PUBLIC_DIR, '.' + (pathname === '/' ? '/index.html' : pathname));
    const inside = requested === PUBLIC_DIR || requested.startsWith(PUBLIC_DIR + path.sep);
    let filePath = inside ? requested : path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'text/plain';
    const content = fs.readFileSync(filePath);
    // text files go out gzipped when the browser accepts it (the map's outlines are ~0.9 MB, ~0.25 MB gzipped)
    if (content.length > 2048 && !contentType.startsWith('image/png') && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      const mtime = fs.statSync(filePath).mtimeMs;
      let hit = gzipCache.get(filePath);
      if (!hit || hit.mtime !== mtime) gzipCache.set(filePath, hit = { mtime, body: zlib.gzipSync(content) });
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      return res.end(hit.body);
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err: any) {
    if (err instanceof ApiError) return sendError(res, err);
    if (err instanceof UnsupportedUnionError) {
      return sendError(res, new ApiError('invalid_input', err.message, { supportedUnions: SUPPORTED_UNIONS }, 422));
    }
    console.error('Server error:', err);
    sendError(res, new ApiError('internal', 'Internal server error'));
  }
});

backgroundJobManager.recoverInterruptedJobs()
  .then(n => { if (n) console.warn(`Marked ${n} job(s) interrupted by a previous restart as failed (retry them via POST /api/v1/cattle/jobs/:id/retry)`); })
  .catch(err => console.error('Job recovery failed:', err));

server.listen(PORT, () => {
  console.log(`✓ EDEN API & SAAO Dashboard server listening on http://localhost:${PORT} (data release ${RELEASE.id})`);
});
