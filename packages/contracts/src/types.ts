/**
 * Project EDEN — Shared Contracts & Data Types
 * Deterministic crop rotation engine, multi-objective ranking, and anti-hallucination narration.
 */

export type LandType = 'high' | 'medium_high' | 'medium_low' | 'low' | 'very_low';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';

export interface DataProvenance {
  source: string;
  timePeriod: string;
  spatialResolution: string;
  measuredOrModeled: 'measured' | 'modeled' | 'assumed';
  notesBangla?: string;
}

export interface DimensionScoreResult {
  dimensionId: string;
  score: number; // 0.0 to 1.0 (higher = better outcome)
  confidence: ConfidenceLevel;
  summaryBangla: string;
  summaryEnglish: string;
  metrics: Record<string, number | string | boolean>;
  provenance: DataProvenance;
  staleOrMissing?: boolean;
}

export interface EvaluationContext {
  unionId: string;
  upazilaId: string;
  districtId: string;
  landType: LandType;
  seasonYear: number;
  rotationId: string;
  crops: Array<{
    season: 'Aman' | 'Kharif-2' | 'Rabi' | 'Kharif-1'; // explicit, so plugins never guess the crop from its name
    cropName: string;
    variety: string;
    sowingDate: string; // ISO format or relative
    harvestDate: string;
    durationDays: number;
  }>;
  farmerPriorities: Record<string, number>;
}

export interface IEvidenceDimensionPlugin {
  readonly id: string; // 'water' | 'heat' | 'flood' | 'soil' | 'fodder' | 'income'
  readonly displayNameBangla: string;
  readonly displayNameEnglish: string;
  readonly version: string;
  readonly isEnabled: boolean;

  evaluate(context: EvaluationContext): Promise<DimensionScoreResult> | DimensionScoreResult;
  explain(result: DimensionScoreResult): {
    banglaBullets: string[];
    englishBullets: string[];
  };
}

export interface CropPhase {
  crop: string;
  cropBangla?: string;
  variety: string;
  varietyBangla?: string;
  seasonType: 'Aman' | 'Kharif-2' | 'Rabi' | 'Aus' | 'Pre-Kharif';
  fallow?: boolean; // the monsoon slot left empty (no rice and no other crop)
  sowingWindow: string;
  harvestWindow: string;
  durationDays: number;
  daysToFieldFree: number;
  sowingBangla?: string; // the date this crop goes in the field in this option ('১০ নভেম্বর')
  harvestBangla?: string;
}

export interface MonthTimelineSlot {
  monthNameBangla: string;
  monthNameEnglish: string;
  status: 'occupied' | 'transplanting' | 'harvesting' | 'fallow_available';
  cropName?: string;
  cropNameEnglish?: string;
}

export interface CandidateRotation {
  id: string;
  nameBangla: string;
  nameEnglish: string;
  isBaseline: boolean;
  cropSequence: CropPhase[];
  scores: Record<string, number>; // Dimension ID -> normalized score (0.0 - 1.0)
  dimensionDetails: Record<string, DimensionScoreResult>;
  totalWeightedScore: number;
  rank: number;
  timeline: MonthTimelineSlot[];
  approvedActionIds: string[];
  approvedActionBangla: string[];
  approvedActionEnglish?: string[];
  fieldFreeDateBangla: string; // e.g. "১০ নভেম্বর"
  fieldFreeDateEnglish?: string; // e.g. "10 Nov"
  ipmActions?: IpmTip[];
  ledger?: EnvironmentLedger;
  stewardship?: StewardshipTip[]; // soil-and-water tips: what the rotation saves and what to watch for
}

/** One soil-and-water tip beside a rotation, with its numbers from the plan's own records and its source. */
export interface StewardshipTip {
  kind: 'water' | 'fertilizer' | 'pesticide' | 'soil' | 'metals';
  bn: string;
  en: string;
  source: string;
}

/** What a rotation takes from the land in one year (the research's environment ledger method). */
export interface EnvironmentLedger {
  groundwaterPumpedM3PerHa: number;
  floodedRiceDays: number; // transplanting to two weeks before harvest: a methane proxy, not a measurement
  /** Urea for the whole rotation; null where the place has no SRDI soil card (no fertilizer amount is given there). */
  ureaKgHa: number | null;
  legume: boolean;
  bareDays: number; // days in the year with no crop in the field
}

/** One integrated pest management step: non-chemical first, sprays only on the officer's advice. */
export interface IpmTip {
  bn: string;
  en: string;
  source: string;
  /** The tip cites or depends on the SRDI soil card, so it is not given at a place that has none. */
  needsSoilCard?: boolean;
}

export interface AdviceJSON {
  schema_version: '1.0';
  advice_id: string;
  created_at: string;
  scope: {
    union_id: string;
    union_name_bangla: string;
    upazila: string;
    district: string;
    land_type: LandType;
    season: string;
  };
  data_release: string;
  farmer_priorities: Record<string, number>;
  active_plugins: string[];
  options: CandidateRotation[];
  stale_or_missing_inputs: Array<{
    dataset: string;
    issue: string;
    affectedDimension: string;
  }>;
  farmer_summary_bangla: string;
  farmer_summary_english?: string;
  saao_technical_notes: string;
  verification?: OfficerVerification | null;
  release?: { id: string; generatedOn: string; researchCommit: string };
  this_season?: ThisSeasonFit | null;
  this_season_option_id?: string | null; // best option that starts from the Aman already in the field
  farmer_card?: FarmerCard;
  crop_choice?: CropChoiceResult | null; // set when the farmer named the crops they want
}

/** How the crops a farmer asked for fit the year at their place, and what else fits the gap before Aman. */
export interface CropChoiceResult {
  requested: Array<{ id: string; cropBangla: string; cropEnglish: string; season: 'Kharif-2' | 'Rabi' | 'Kharif-1' }>;
  notModelled: Array<{ id: string; bn: string; en: string }>;
  fits: Array<{
    id: string;
    cropBangla: string;
    cropEnglish: string;
    season: 'Kharif-2' | 'Rabi' | 'Kharif-1';
    fits: boolean;
    bestOptionId: string | null;
    sowingBangla: string | null;
    sowingEnglish: string | null;
    harvestBangla: string | null;
    harvestEnglish: string | null;
    netIrrigationMm: number | null;
    reasonBangla: string | null;
    reasonEnglish: string | null;
  }>;
  coverage: Array<{ optionId: string; cropIds: string[] }>; // which asked crops each option holds
  gapFillers: Array<{ id: string; cropBangla: string; cropEnglish: string; sowingBangla: string; sowingEnglish: string; harvestBangla: string; harvestEnglish: string; netIrrigationMm: number }>;
  notesBangla: string[];
  notesEnglish: string[];
  heroCrop: string | null; // the farmer's main crop, held by every option
  avoided: string[]; // crop ids left out at the farmer's word ('aman', 'boro', 'aus' for rice)
}

/** What still fits this season if a given Aman variety is already in the field. */
export interface ThisSeasonFit {
  currentAmanVariety: string;
  fieldFreeDateBangla: string;
  fieldFreeDateEnglish: string;
  crops: Array<{ cropBangla: string; cropEnglish: string; sowingDeadlineBangla: string; sowingDeadlineEnglish: string; fits: boolean }>;
  noteBangla: string;
  noteEnglish: string;
}

/** Set when a Krishi officer's field observation shaped this advice. */
export interface OfficerVerification {
  officerId: string;
  officerNameBangla: string;
  officerNameEnglish: string;
  date: string;
  noteBangla: string;
}

/** Ready-to-show Bangla text for the farmer app's cached advice card (one per advice, top option first). */
export interface FarmerCard {
  rotationTitleBangla: string;
  rotationSubtitleBangla: string;
  season1: { name: string; variety: string; windowBangla: string; stageBangla: string; irrigationBangla: string };
  season2: { name: string; variety: string; windowBangla: string; notesBangla: string; fertilizerBangla: string; fertilizerEnglish?: string };
  alternative: { name: string; categoryBangla: string; sowingBangla: string; yieldBangla: string; noteBangla: string; marketPriceBangla: string };
  narrativeBangla: string;
  provenanceBangla: string;
  audioScriptBangla: string;
  audioDurationSeconds: number;
}

export interface FarmerProfile {
  id: string;
  name: string;
  phone: string;
  unionId: string;
  landType: LandType;
  primaryWaterSource: 'rainfed' | 'shallow_tube_well' | 'deep_tube_well' | 'canal';
  hasLivestock: boolean;
  priorities: {
    water: number;
    income: number;
    soil: number;
    fodder: number;
  };
  keypadSelection?: string; // "1" for water, "2" for income, "3" for soil
  consentGiven: boolean;
}

export interface NarrationAuditLog {
  gate1Passed: boolean;
  gate2Passed: boolean;
  tokenDiffOk: boolean;
  unapprovedNumbersFound: string[];
  unapprovedActionsFound: string[];
  latencyMs: number;
  engineUsed: 'verified_template' | 'local_model_checked' | 'fallback_template';
}

export interface NarrationResult {
  status: 'verified_template' | 'local_model_checked' | 'fallback_template';
  banglaSpeechText: string;
  englishGloss?: string; // translation for reviewers; farmers hear the Bangla
  banglaKeypadPrompt: string;
  durationSecondsEstimate: number;
  auditLog: NarrationAuditLog;
}

// ---------------------------------------------------------------------------
// Krishi officer (SAAO) desk: officers describe farmers' fields, and their observations take priority.
// ---------------------------------------------------------------------------

export type PestSeen = 'none' | 'stem_borer' | 'bph' | 'aphid' | 'blast' | 'other';

export interface FieldObservation {
  id: string;
  farmerId: string;
  officerId: string;
  date: string; // ISO timestamp
  landType: LandType;
  currentAmanCrop: string; // e.g. 'BRRI dhan49'
  irrigation: 'rainfed' | 'shallow_tube_well' | 'deep_tube_well';
  pestSeen: PestSeen;
  pestSeverity: 'low' | 'medium' | 'high' | null;
  priorities: { water: number; income: number; soil: number; pest: number };
  noteBangla: string;
}

export interface FarmerRecord {
  id: string;
  nameBangla: string;
  nameEnglish: string;
  villageBangla: string;
  villageEnglish: string;
  phoneMasked: string;
  landType: LandType;
  currentAmanCrop: string;
  irrigation: FieldObservation['irrigation'];
  sample: boolean;
  /** The manager site (app_metadata.site) this farmer belongs to; records written before sites existed count as 'talanda'. */
  site?: string;
}

export interface CallbackRequest {
  id: string;
  farmerId: string;
  channel: 'ivr_keypad_9' | 'app';
  createdAt: string;
  status: 'open' | 'done';
}

export interface OfficerQueueItem {
  farmerId: string;
  score: number;
  level: 'urgent' | 'high' | 'normal';
  reasons: Array<{ bn: string; en: string }>;
  openCallbackId: string | null;
}
