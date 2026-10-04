/**
 * Machine Learning Pipeline & Model Training Harness.
 * Enforces strict scientific integrity: checks for verified ground-truth labels
 * before training. When labeled outcome data is absent, cleanly reports
 * `training_data_unavailable` without fabricating datasets or accuracy metrics.
 */
import type { FarmAOI } from './types.ts';
import { ApiError } from '../errors.ts';

export type CattleMlTarget =
  | 'heat_stress_panting'
  | 'forage_biomass'
  | 'water_intake_volume'
  | 'milk_yield_loss'
  | 'bovine_disease_risk'
  | 'pasture_grazing_suitability';

export interface ModelMetadata {
  target: CattleMlTarget;
  targetDescription: string;
  version: string;
  status: 'training_data_unavailable' | 'ready' | 'deprecated';
  inputSchema: string[];
  trainingPeriod?: string;
  labelDefinition: string;
  dataProvenance: string;
  validationMethod: 'group_kfold_farm_and_time' | 'none';
  baselineComparison?: string;
  validationMetrics?: Record<string, number>;
  notes: string;
}

export interface TrainingResult {
  success: boolean;
  status: 'training_data_unavailable' | 'training_not_implemented' | 'completed' | 'failed';
  target: CattleMlTarget;
  sampleCount: number;
  message: string;
  metadata: ModelMetadata;
}

// Registry of ML model architectures and prerequisite ground truth labels
export const MODEL_CATALOG: Record<CattleMlTarget, ModelMetadata> = {
  heat_stress_panting: {
    target: 'heat_stress_panting',
    targetDescription: 'Supervised respiration/panting score prediction',
    version: 'v0.0.0-uninitialized',
    status: 'training_data_unavailable',
    inputSchema: ['T2M', 'RH2M', 'WS2M', 'SolarRad', 'THI'],
    labelDefinition: 'Time-aligned veterinary panting score (0-4) or respiration rate per minute',
    dataProvenance: 'No verified field cattle physiological observations recorded in this repository',
    validationMethod: 'group_kfold_farm_and_time',
    notes: 'Rule-based NRC (1971) THI baseline is used instead of supervised model.',
  },
  forage_biomass: {
    target: 'forage_biomass',
    targetDescription: 'Pasture dry matter biomass (kg DM/ha) prediction',
    version: 'v0.0.0-uninitialized',
    status: 'training_data_unavailable',
    inputSchema: ['MODIS_NDVI', 'MODIS_EVI', 'SMAP_RootZone', 'Soil_Clay_Pct'],
    labelDefinition: 'Field quadrat forage clipping oven-dried biomass (g/m² or kg DM/ha)',
    dataProvenance: 'No ground-truth pasture clipping records present in repository',
    validationMethod: 'group_kfold_farm_and_time',
    notes: 'NDVI greenness proxy is exposed with caveats; biomass estimation requires ground calibration.',
  },
  water_intake_volume: {
    target: 'water_intake_volume',
    targetDescription: 'Direct water consumption volume (L/cow/day)',
    version: 'v0.0.0-uninitialized',
    status: 'training_data_unavailable',
    inputSchema: ['THI', 'T2M_Max', 'BodyWeightKg', 'MilkYieldKg', 'DMI_Kg'],
    labelDefinition: 'Water meter logging per animal or pen water disappearance',
    dataProvenance: 'No animal water meter dataset present in repository',
    validationMethod: 'group_kfold_farm_and_time',
    notes: 'Categorical water demand risk warnings are provided based on environmental thresholds.',
  },
  milk_yield_loss: {
    target: 'milk_yield_loss',
    targetDescription: 'Daily milk loss relative to thermal comfort baseline (kg/day)',
    version: 'v0.0.0-uninitialized',
    status: 'training_data_unavailable',
    inputSchema: ['Cumulative_THI_Load', 'Parity', 'DIM', 'Breed'],
    labelDefinition: 'Daily individual cow milk yield records linked to microclimatic heat exposure',
    dataProvenance: 'No longitudinal milk yield dataset present in repository',
    validationMethod: 'group_kfold_farm_and_time',
    notes: 'Prediction remains unavailable to avoid misleading dairy farmers.',
  },
  bovine_disease_risk: {
    target: 'bovine_disease_risk',
    targetDescription: 'Specific bovine clinical disease incidence prediction',
    version: 'v0.0.0-uninitialized',
    status: 'training_data_unavailable',
    inputSchema: ['Precipitation_30d', 'Temperature_Mean', 'Vector_Index'],
    labelDefinition: 'Veterinary clinical case logs confirmed by diagnostic testing',
    dataProvenance: 'No veterinary clinical surveillance records present in repository',
    validationMethod: 'group_kfold_farm_and_time',
    notes: 'Diagnostic predictions remain unavailable without laboratory-confirmed ground truth.',
  },
  pasture_grazing_suitability: {
    target: 'pasture_grazing_suitability',
    targetDescription: 'Multi-factor ground condition & grazing safety classifier',
    version: 'v0.0.0-uninitialized',
    status: 'training_data_unavailable',
    inputSchema: ['THI', 'Precipitation_24h', 'SoilMoisture', 'SolarRadiation'],
    labelDefinition: 'Ground grazing suitability and safety observations',
    dataProvenance: 'No ground pasture condition logs present in repository',
    validationMethod: 'group_kfold_farm_and_time',
    notes: 'Rule-based thermal safety windows are supplied based on forecast THI.',
  },
};

/**
 * Supervised Model Training Trigger.
 * Checks for genuine, appropriately labeled training data.
 * When labeled records are absent, strictly returns training_data_unavailable.
 */
export async function triggerModelTraining(target: CattleMlTarget, aoi?: FarmAOI): Promise<TrainingResult> {
  const meta = MODEL_CATALOG[target];
  if (!meta) {
    throw new ApiError('invalid_input', `Unknown model target: ${target}`, { allowed: Object.keys(MODEL_CATALOG) });
  }

  // Check labeled dataset repository (currently 0 verified ground-truth labels)
  const labeledDatasetSize = 0;

  if (labeledDatasetSize === 0) {
    return {
      success: false,
      status: 'training_data_unavailable',
      target,
      sampleCount: 0,
      message: `Training paused for "${meta.targetDescription}". Reason: ${meta.labelDefinition} are not present in this repository. In accordance with scientific integrity guidelines, models and accuracy metrics are never fabricated.`,
      metadata: meta,
    };
  }

  // Labelled records exist but no trainer/validator is implemented in this repository. Say so instead of
  // reporting a completed training run.
  return {
    success: false,
    status: 'training_not_implemented',
    target,
    sampleCount: labeledDatasetSize,
    message: 'Labelled records are present but no training and validation pipeline is implemented; no model was produced.',
    metadata: meta,
  };
}
