/**
 * Rule-based Bengali agricultural assistant (NOT an LLM and not machine learning).
 * It answers only from data this server really has: NASA POWER delayed observations for the requested
 * coordinates, and the SRDI union card for the Talanda pilot. Everything else is refused with a pointer to the
 * local SAAO officer. Evidence labels:
 *   provider_data         - computed from a provider response for the requested coordinates
 *   reference_card        - read from a static reference record (SRDI union card), valid for its own union only
 *   insufficient_evidence - nothing supportable to say
 * Conversational LLM narration, when configured, is a separate step (providers/llm.ts).
 */

import { FORBIDDEN_TERMS } from '../../../packages/narration-core/src/dual_gate_validator.ts';
import { getNasaWeather, type WeatherResponse } from './weather.ts';
import { getRiverErosion } from './erosion.ts';
import { TALANDA_SRDI } from '../../../packages/rotation-engine/src/data/tanore_replay_data.ts';

export interface AiAskRequest {
  query: string;
  /** Coordinates of the farmer's selected location. Without them no weather-based answer is given. */
  lat?: number;
  lon?: number;
  farmProfile?: {
    farmName?: string;
    region?: string;
    landType?: string;
    soilTexture?: string;
    currentCrop?: string;
  };
  language?: 'bn' | 'en';
}

export interface AiAskResponse {
  answer: string;
  sources: string[];
  evidenceLevel: 'provider_data' | 'reference_card' | 'insufficient_evidence';
  followUpSuggestions: string[];
  timestamp: string;
}

// The SRDI card is for Talanda union, Tanore (24.62N, 88.56E). Only answer from it near that point.
const TALANDA = { lat: 24.62, lon: 88.56, radiusKm: 15 };
function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const isNear = (r: AiAskRequest) => Number.isFinite(r.lat) && Number.isFinite(r.lon)
  && kmBetween(r.lat as number, r.lon as number, TALANDA.lat, TALANDA.lon) <= TALANDA.radiusKm;

const SAAO_REFERRAL = 'আপনার ব্লকের উপসহকারী কৃষি কর্মকর্তা (SAAO) বা উপজেলা কৃষি অফিসের পরামর্শ নিন।';
const now = () => new Date().toISOString();
const n = (v: number | null, unit = '') => (v === null ? 'উপাত্ত নেই' : `${v}${unit}`);

export async function askAiAssistant(req: AiAskRequest): Promise<AiAskResponse> {
  const query = (req.query || '').trim();
  const qLower = query.toLowerCase();

  for (const forbidden of FORBIDDEN_TERMS) {
    if (query.includes(forbidden)) {
      return {
        answer: `দুঃখিত, "${forbidden}" সংক্রান্ত পরামর্শ দেওয়া হয় না। ফসল ও আবহাওয়া সংক্রান্ত প্রশ্ন জিজ্ঞাসা করুন।`,
        sources: [],
        evidenceLevel: 'insufficient_evidence',
        followUpSuggestions: ['সাম্প্রতিক আবহাওয়া কেমন?'],
        timestamp: now(),
      };
    }
  }

  const hasCoords = Number.isFinite(req.lat) && Number.isFinite(req.lon);
  const wantsWeather = ['সেচ', 'পানি', 'আবহাওয়া', 'বৃষ্টি', 'তাপমাত্রা', 'irrigation', 'weather', 'rain'].some(k => qLower.includes(k));

  if (wantsWeather) {
    if (!hasCoords) {
      return {
        answer: 'আবহাওয়ার তথ্য দেখাতে আপনার অবস্থান (জেলা/উপজেলা বা জিপিএস) প্রয়োজন। অনুগ্রহ করে অবস্থান নির্বাচন করে আবার জিজ্ঞাসা করুন।',
        sources: [],
        evidenceLevel: 'insufficient_evidence',
        followUpSuggestions: ['অবস্থান নির্বাচন করার পর আবহাওয়া জানতে চাই'],
        timestamp: now(),
      };
    }
    let weather: WeatherResponse;
    try {
      weather = await getNasaWeather(req.lat as number, req.lon as number);
    } catch {
      return {
        answer: `এই অবস্থানের নাসা পর্যবেক্ষণ উপাত্ত এখন পাওয়া যাচ্ছে না, তাই আবহাওয়া নিয়ে কোনো তথ্য দেওয়া যাচ্ছে না। কিছুক্ষণ পর আবার চেষ্টা করুন। ${SAAO_REFERRAL}`,
        sources: [],
        evidenceLevel: 'insufficient_evidence',
        followUpSuggestions: [],
        timestamp: now(),
      };
    }
    const l = weather.latest;
    return {
      answer: `নাসা পাওয়ার-এর বিলম্বিত পর্যবেক্ষণ উপাত্ত (সরাসরি নয়, পূর্বাভাসও নয়) — আপনার নির্বাচিত অবস্থানের জন্য:\n\n` +
        `• **সর্বশেষ পর্যবেক্ষণের তারিখ**: ${weather.latestObservationDate}\n` +
        `• **তাপমাত্রা**: গড় ${n(l.t2m, '°C')}, সর্বোচ্চ ${n(l.t2mMax, '°C')}, সর্বনিম্ন ${n(l.t2mMin, '°C')}\n` +
        `• **আপেক্ষিক আর্দ্রতা**: ${n(l.rh2m, '%')}\n` +
        `• **বৃষ্টিপাত (সর্বশেষ দিন)**: ${n(l.rainMm, ' মিমি')}\n` +
        `• **${weather.windowStart} থেকে ${weather.windowEnd}**: মোট বৃষ্টিপাত ${n(weather.rainWindowMm, ' মিমি')} (${weather.rainDaysWithData} দিনের উপাত্ত)\n\n` +
        `সেচ দেওয়ার আগে জমির মাটির ভেজা ভাব হাতে পরীক্ষা করুন। সেচের সুনির্দিষ্ট সময় ও পরিমাণের জন্য ${SAAO_REFERRAL}`,
      sources: [`${weather.source.provider} (${weather.source.kind}, তথ্য ${weather.latestObservationDate} পর্যন্ত)`],
      evidenceLevel: 'provider_data',
      followUpSuggestions: ['এই অঞ্চলের সারের সুপারিশ কী?'],
      timestamp: now(),
    };
  }

  if (['সার', 'ইউরিয়া', 'টিএসপি', 'পটাশ', 'fertilizer'].some(k => qLower.includes(k))) {
    if (!isNear(req)) {
      return {
        answer: `সারের সুপারিশ ইউনিয়নভিত্তিক মাটি পরীক্ষার ওপর নির্ভর করে। আমাদের কাছে শুধু তালন্দ ইউনিয়নের (তানোর, রাজশাহী) এসআরডিআই কার্ড আছে; আপনার নির্বাচিত অবস্থানের জন্য কোনো সুপারিশ নেই। ${SAAO_REFERRAL}`,
        sources: [],
        evidenceLevel: 'insufficient_evidence',
        followUpSuggestions: [],
        timestamp: now(),
      };
    }
    const a = TALANDA_SRDI.aman;
    return {
      answer: `তালন্দ ইউনিয়নের এসআরডিআই সার সুপারিশ কার্ড (${TALANDA_SRDI.soilTypeBangla}, ${TALANDA_SRDI.landTypeBangla}) অনুযায়ী ${a.cropGroupBangla}-র জন্য, হেক্টর প্রতি:\n\n` +
        `• ইউরিয়া: ${a.ureaKgHa} কেজি\n• টিএসপি: ${a.tspKgHa} কেজি\n• এমওপি: ${a.mopKgHa} কেজি\n• জিপসাম: ${a.gypsumKgHa} কেজি\n• জিংক সালফেট: ${a.zincSulphateKgHa} কেজি\n\n` +
        `এটি ইউনিয়ন-পর্যায়ের কার্ড; আপনার নিজের জমির মাটি পরীক্ষা ছাড়া এটি চূড়ান্ত নয়। অন্যান্য ফসলের জন্য ${SAAO_REFERRAL}`,
      sources: [TALANDA_SRDI.source],
      evidenceLevel: 'reference_card',
      followUpSuggestions: [],
      timestamp: now(),
    };
  }

  if (['ভাঙন', 'নদী', 'বন্যা', 'erosion', 'river'].some(k => qLower.includes(k))) {
    const e = getRiverErosion().corridor;
    return {
      answer: `নদীভাঙন সংক্রান্ত রেফারেন্স তথ্য (${e.riverNameBangla}, ${e.basinNameBangla}) আলাদা "নদীভাঙন" পর্দায় তাদের নিজস্ব উৎসসহ দেখানো হয়। এই সহকারী নির্দিষ্ট জমির ভাঙনের ঝুঁকি বা হার অনুমান করে না। ${SAAO_REFERRAL}`,
      sources: [],
      evidenceLevel: 'insufficient_evidence',
      followUpSuggestions: [],
      timestamp: now(),
    };
  }

  return {
    answer: `এই প্রশ্নের নির্ভরযোগ্য উত্তর দেওয়ার মতো উপাত্ত আমাদের কাছে নেই, তাই অনুমান করে কিছু বলা হচ্ছে না। ফসল আবর্তনের পরামর্শের জন্য "পরিকল্পনা" পর্দা (শুধু তালন্দ পাইলট) দেখুন। ${SAAO_REFERRAL}`,
    sources: [],
    evidenceLevel: 'insufficient_evidence',
    followUpSuggestions: ['সাম্প্রতিক আবহাওয়া কেমন?', 'আমার এলাকার সারের সুপারিশ কী?'],
    timestamp: now(),
  };
}
