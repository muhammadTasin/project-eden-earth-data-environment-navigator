/**
 * Cattle advisory engine.
 * measured  = provider data passed through unchanged
 * derived   = THI arithmetic on measured temperature/humidity (NRC 1971 formula)
 * heuristic = generic guidance keyed on the THI category. It carries no numeric effect sizes (no milk-loss or
 *             water-intake percentages) because none are validated for local cattle here.
 * Supervised predictions are reported unavailable: there are no labelled records to train or validate on.
 */
import type {
  FarmAOI,
  CattleAdvisoryResult,
  HourlyThiForecast,
  ThiStressCategory,
  ExtractedFeature,
} from './types.ts';
import { HOURLY_HORIZON } from './features.ts';
import type { ProcessedAoiFeatures } from './features.ts';

/**
 * Calculates Temperature-Humidity Index (THI) for cattle using NRC (1971) / Thom (1959).
 * Formula: THI = (1.8 * Tdb + 32) - (0.55 - 0.0055 * RH) * (1.8 * Tdb - 26)
 * where Tdb is dry-bulb temperature in °C and RH is relative humidity in %.
 */
export function calculateCattleThi(temperatureC: number, relativeHumidityPct: number): number {
  const t = temperatureC;
  const rh = Math.max(0, Math.min(100, relativeHumidityPct));
  const thi = (1.8 * t + 32) - (0.55 - 0.0055 * rh) * (1.8 * t - 26);
  return Number(thi.toFixed(1));
}

/**
 * Maps THI to the commonly used generic dairy-cattle categories (<72, 72-78, 79-83, >=84).
 * These cut-offs are not validated for Bangladeshi zebu or crossbred cattle; treat as indicative.
 */
export function classifyThiStress(thi: number): ThiStressCategory {
  if (thi < 72) return 'normal';
  if (thi < 79) return 'alert';
  if (thi < 84) return 'danger';
  return 'emergency';
}

export function getThiCategoryLabels(category: ThiStressCategory): { bn: string; en: string } {
  switch (category) {
    case 'normal':
      return { bn: 'স্বাভাবিক (Normal)', en: 'Normal (Comfortable)' };
    case 'alert':
      return { bn: 'সতর্কতা / মৃদু তাপ চাপ (Alert / Mild)', en: 'Alert (Mild Stress)' };
    case 'danger':
      return { bn: 'বিপজ্জনক তাপ চাপ (Danger / Moderate)', en: 'Danger (Moderate Stress)' };
    case 'emergency':
      return { bn: 'জরুরি অবস্থা / তীব্র তাপ চাপ (Emergency / Severe)', en: 'Emergency (Severe Stress)' };
  }
}

export function generateCattleAdvisory(
  aoi: FarmAOI,
  features: ProcessedAoiFeatures,
  satelliteFeatures: ExtractedFeature[] = [],
  satelliteReport: { unavailable: Array<{ dataset: string; reason: string }>; reason?: string } = { unavailable: [] },
): CattleAdvisoryResult {
  const now = new Date().toISOString();
  const w = features.latestWeather;
  const currentThi = calculateCattleThi(w.temperatureC, w.relativeHumidityPct);
  const category = classifyThiStress(currentThi);
  const labels = getThiCategoryLabels(category);

  // Hourly THI uses each hour's own forecast temperature AND relative humidity.
  const hourly: HourlyThiForecast[] = features.forecastHourly.map(h => {
    const thi = calculateCattleThi(h.temperatureC, h.relativeHumidityPct);
    return { time: h.time, temperatureC: h.temperatureC, relativeHumidityPct: h.relativeHumidityPct, thi, category: classifyThiStress(thi) };
  });
  // Provider times are zone-naive local strings: read HH:MM straight from the string, no timezone conversion.
  const lowestThiHours = hourly.length
    ? [...hourly].sort((a, b) => a.thi - b.thi).slice(0, 5).map(h => h.time.slice(11, 16)).sort()
    : null;

  const bulletsBangla: string[] = [];
  const bulletsEnglish: string[] = [];
  const hoursTextEn = lowestThiHours ? ` (forecast lowest-THI hours: ${lowestThiHours.join(', ')})` : '';
  const hoursTextBn = lowestThiHours ? ` (পূর্বাভাসে সবচেয়ে কম THI-র সময়: ${lowestThiHours.join(', ')})` : '';
  if (category === 'normal') {
    bulletsBangla.push('THI আরামদায়ক সীমায়; স্বাভাবিক খাদ্য ও পরিষ্কার পানি সরবরাহ বজায় রাখুন।');
    bulletsEnglish.push('THI is in the comfortable range; keep the normal ration and clean drinking water available.');
  } else if (category === 'alert') {
    bulletsBangla.push('মৃদু তাপ চাপের সম্ভাবনা। শেডে বায়ু চলাচল নিশ্চিত করুন এবং ঠান্ডা পানি সহজলভ্য রাখুন।');
    bulletsBangla.push(`দিনের গরম সময়ে রোদে রাখা এড়ান${hoursTextBn}।`);
    bulletsEnglish.push('Mild heat stress is possible. Ensure shed ventilation and keep cool water easily available.');
    bulletsEnglish.push(`Avoid keeping animals in direct sun in the hottest hours${hoursTextEn}.`);
  } else if (category === 'danger') {
    bulletsBangla.push('তাপ চাপ মাঝারি থেকে বেশি হতে পারে। খাদ্য দিনের ঠান্ডা সময়ে দেওয়ার চেষ্টা করুন' + hoursTextBn + '।');
    bulletsBangla.push('সম্ভব হলে ফ্যান বা ছায়া/পানি ছিটানোর মাধ্যমে শীতল রাখুন।');
    bulletsEnglish.push(`Heat stress may be moderate to high. Try to feed in the cooler hours${hoursTextEn}.`);
    bulletsEnglish.push('Where possible, cool animals with shade, fans or water sprinkling.');
  } else {
    bulletsBangla.push('তীব্র তাপ চাপের সম্ভাবনা। প্রাণীকে ছায়াযুক্ত, বাতাস চলাচলকারী স্থানে রাখুন এবং পর্যাপ্ত ঠান্ডা পানি দিন।');
    bulletsBangla.push('অসুস্থতার লক্ষণ (হাঁপানো, খাওয়া কমে যাওয়া, নেতিয়ে পড়া) দেখলে দ্রুত প্রাণী চিকিৎসকের পরামর্শ নিন।');
    bulletsEnglish.push('Severe heat stress is likely. Keep animals in shaded, ventilated space and provide plenty of cool water.');
    bulletsEnglish.push('If you see signs of distress (open-mouth panting, reduced feeding, collapse), contact a veterinarian promptly.');
  }

  // Categorical only, and driven by THI alone (no temperature cut-offs, no percentage claims).
  const waterCategory = category === 'emergency' ? 'critical' : category === 'danger' ? 'elevated' : 'normal';
  const waterLabels = {
    normal: { bn: 'স্বাভাবিক', en: 'Normal' },
    elevated: { bn: 'পানির চাহিদা বাড়ার সম্ভাবনা', en: 'Water demand likely higher' },
    critical: { bn: 'পানির চাহিদা উল্লেখযোগ্য বাড়ার সম্ভাবনা', en: 'Water demand likely much higher' },
  } as const;

  const suitableNow = category === 'normal' || category === 'alert';

  const ndvi = satelliteFeatures.find(f => f.band === 'NDVI');
  const sat = satelliteFeatures.length === 0 ? 'unavailable' : satelliteReport.unavailable.length ? 'partial' : 'ok';

  const nasa = features.nasa;
  return {
    aoiId: aoi.aoiId,
    farmLabel: aoi.farmLabel,
    generatedAt: now,
    measured: {
      kind: 'measured',
      forecast: {
        source: features.forecastSource,
        temperatureC: w.temperatureC,
        relativeHumidityPct: w.relativeHumidityPct,
        apparentTemperatureC: w.apparentTemperatureC,
      },
      nasaPower: nasa,
      satellite: {
        status: sat,
        ...(sat === 'unavailable' ? { reason: satelliteReport.reason || 'No satellite values were extracted' } : {}),
        features: satelliteFeatures,
        unavailable: satelliteReport.unavailable,
      },
    },
    derived: {
      kind: 'derived',
      thi: {
        current: currentThi,
        category,
        formula: 'NRC (1971): THI = (1.8T+32) - (0.55-0.0055*RH)*(1.8T-26)',
        categoryLabelBangla: labels.bn,
        categoryLabelEnglish: labels.en,
        hourly,
        hoursMissingInputs: features.hoursMissingInputs,
        horizonHours: HOURLY_HORIZON,
        lowestThiHours,
        thresholdNote: 'Generic dairy-cattle THI categories (<72 normal, 72-78 alert, 79-83 danger, >=84 emergency). Not validated for Bangladeshi zebu or crossbred cattle.',
      },
    },
    heuristic: {
      kind: 'heuristic',
      basis: 'Generic guidance keyed on the current THI category. It is not a prediction of milk loss, disease or water volume.',
      summaryBangla: `বর্তমান তাপমাত্রা ${w.temperatureC}°C ও আপেক্ষিক আর্দ্রতা ${w.relativeHumidityPct}% (আবহাওয়া মডেলের অনুমান) অনুযায়ী THI ${currentThi} (${labels.bn})।`,
      summaryEnglish: `At ${w.temperatureC}°C and ${w.relativeHumidityPct}% relative humidity (weather-model estimate) the THI is ${currentThi} (${labels.en}).`,
      bulletsBangla,
      bulletsEnglish,
      waterDemand: {
        category: waterCategory,
        labelBangla: waterLabels[waterCategory].bn,
        labelEnglish: waterLabels[waterCategory].en,
        note: 'Categorical only. Litres per animal need weight, breed and milk-yield inputs that are not collected.',
      },
      grazing: {
        suitableNow,
        rationaleBangla: suitableNow ? 'বর্তমান THI অনুযায়ী চারণ তুলনামূলক কম ঝুঁকিপূর্ণ।' : 'বর্তমান THI অনুযায়ী দিনের গরম সময়ে চারণ ঝুঁকিপূর্ণ হতে পারে।',
        rationaleEnglish: suitableNow ? 'Grazing is lower-risk at the current THI.' : 'Daytime grazing may be risky at the current THI.',
        lowestThiHours,
      },
    },
    forageStatus: {
      ndviProxy: ndvi?.value ?? null,
      resolutionMeters: ndvi?.pixelSizeMeters ?? null,
      quality: ndvi?.qualityState ?? 'MISSING',
      observationDate: ndvi?.observationInterval || null,
      forageAvailable: ndvi ? 'proxy_only' : 'unavailable',
      disclaimerBangla: 'NDVI কেবল উদ্ভিদের সবুজতা। ভূমি কভার মাস্ক ও মাঠ ক্যালিব্রেশন ছাড়া এটি খাওয়ার উপযোগী ঘাস বা বায়োমাস নয়।',
      disclaimerEnglish: 'NDVI is canopy greenness only. Without land-cover masking and field calibration it is not edible forage or biomass.',
    },
    modelStatus: {
      heatStressMethod: 'rule_based_thi',
      supervisedModelAvailable: false,
      modelRegistryStatus: 'training_data_unavailable',
      unavailablePredictions: [
        {
          target: 'milk_loss',
          targetLabelBangla: 'দুধ উৎপাদন হ্রাসের পূর্বাভাস',
          targetLabelEnglish: 'Milk loss prediction',
          reasonBangla: 'খামারভিত্তিক দুধ উৎপাদনের যাচাইকৃত রেকর্ড নেই, তাই মডেল প্রশিক্ষণ বা যাচাই করা যায়নি।',
          reasonEnglish: 'No verified farm-level milk yield records exist, so no model has been trained or validated.',
        },
        {
          target: 'disease_risk',
          targetLabelBangla: 'রোগ ঝুঁকির পূর্বাভাস',
          targetLabelEnglish: 'Disease risk prediction',
          reasonBangla: 'ল্যাব-নিশ্চিত ভেটেরিনারি রেকর্ড নেই। আবহাওয়া থেকে রোগ নির্ণয় করা যায় না।',
          reasonEnglish: 'No laboratory-confirmed veterinary records exist. Weather data cannot diagnose disease.',
        },
      ],
    },
    providerAttributions: [
      {
        name: 'Open-Meteo',
        parameter: '2 m temperature, relative humidity (current and hourly), precipitation, wind',
        kind: 'model_estimate',
        spatialResolution: 'Point at AOI centroid (model grid)',
        latency: 'Model runs; refreshed at most every 15 minutes here',
        caveat: 'Numerical weather-model estimate, not a local station observation.',
      },
      {
        name: 'NASA POWER (community AG)',
        parameter: 'T2M, T2M_MAX, T2M_MIN, RH2M, PRECTOTCORR, WS2M',
        kind: 'satellite_delayed',
        spatialResolution: '0.5° x 0.625° grid cell at AOI centroid',
        latency: 'About 2-3 days',
        caveat: 'Delayed satellite/reanalysis agroclimatology. Not a forecast and not live.',
      },
      {
        name: 'Google Earth Engine (MODIS MOD13A1, SMAP SPL4SMGP, IMERG)',
        parameter: 'NDVI, root-zone soil moisture, 30-day rain total',
        kind: 'satellite_delayed',
        spatialResolution: '500 m (MODIS), ~9-11 km (SMAP, IMERG)',
        latency: 'Days to months depending on product',
        caveat: 'Values are present only when Earth Engine is configured and returned unmasked pixels. Coarse pixels are regional proxies for small farms.',
      },
    ],
  };
}
