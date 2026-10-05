/**
 * The farmer's phone channel: what a farmer asked (speech-to-text, typed text or keypad keys) becomes an engine
 * request, and the engine's advice becomes a short Bangla call script and an SMS. Every crop, date and number in
 * the script comes from the advice; nothing is generated freely, so the reply can be read out by any text-to-speech
 * service (Awaj Digital's bn-BD voice, or the browser's) without a review step.
 */
import type { AdviceJSON, LandType } from '@project-eden/contracts';
import { understandRequest, type Understood } from '../../../packages/rotation-engine/src/understand.ts';
import { CHOICE_BY_ID } from '../../../packages/rotation-engine/src/data/crop_choice.ts';
import { bnDigits, bnGenitive } from '../../../packages/rotation-engine/src/bn.ts';

/**
 * The keypad menu for a phone survey (Awaj "Direct Survey" allows keys 1-9). Keys 1-8 name a crop; 9 asks for the
 * Krishi officer. The prompt is the text to record as the survey's question voice.
 */
export const KEYPAD_CROPS: Array<{ key: string; crop: string }> = [
  { key: '1', crop: 'lentil' },
  { key: '2', crop: 'mustard' },
  { key: '3', crop: 'wheat' },
  { key: '4', crop: 'potato' },
  { key: '5', crop: 'maize' },
  { key: '6', crop: 'sunflower' },
  { key: '7', crop: 'mungbean' },
  { key: '8', crop: 'boro' },
];
export const KEYPAD_OFFICER = '9';

/**
 * The land question, asked last when the Awaj template has it (AWAJ_LAND_QUESTION=1): how deep the field stands in
 * water in a normal monsoon, SRDI's land classes in a farmer's words (high: above the flood; medium high 0-90 cm;
 * medium low 90-180 cm; low 180 cm or more). Without an answer the engine takes the upazila's usual land.
 */
export const KEYPAD_LAND: Array<{ key: string; landType: LandType; bn: string; en: string }> = [
  { key: '1', landType: 'high', bn: 'বর্ষায় জমিতে পানি ওঠে না', en: 'no water on the field in the monsoon' },
  { key: '2', landType: 'medium_high', bn: 'হাঁটু পানি পর্যন্ত', en: 'up to knee-deep' },
  { key: '3', landType: 'medium_low', bn: 'কোমর থেকে বুক পানি', en: 'waist- to chest-deep' },
  { key: '4', landType: 'low', bn: 'মাথার ওপর পানি', en: "over a person's head" },
];

/** A land key from the phone survey -> the land type, or undefined. */
export function landFromKey(key: unknown): LandType | undefined {
  return KEYPAD_LAND.find(k => k.key === String(key ?? '').trim())?.landType;
}

const NUMBER_WORDS = ['শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়'];

export function keypadMenu() {
  const options = KEYPAD_CROPS.map(k => ({ ...k, cropBangla: CHOICE_BY_ID[k.crop].cropBangla, cropEnglish: CHOICE_BY_ID[k.crop].crop }));
  return {
    options,
    officerKey: KEYPAD_OFFICER,
    promptBangla: [
      'মাঠের কথা থেকে বলছি।',
      'কোন ফসল করতে চান, ফোনের বোতাম চেপে জানান।',
      `${options.map(o => `${bnGenitive(o.cropBangla)} জন্য ${NUMBER_WORDS[Number(o.key)]}`).join(', ')} চাপুন।`,
      `কৃষি কর্মকর্তার সাথে কথা বলতে ${NUMBER_WORDS[9]} চাপুন।`,
    ].join(' '),
    secondQuestionBangla: 'আরেকটি ফসল করতে চাইলে সেটির বোতাম চাপুন; না চাইলে অপেক্ষা করুন।',
    landQuestion: {
      promptBangla: [
        'বর্ষায় আপনার জমিতে কত পানি থাকে?',
        `${KEYPAD_LAND.map(l => `${l.bn} হলে ${NUMBER_WORDS[Number(l.key)]}`).join(', ')} চাপুন।`,
      ].join(' '),
      options: KEYPAD_LAND,
      note: 'Asked last in a two- or three-question Awaj template; set AWAJ_LAND_QUESTION=1 so the webhook reads the last key as the land.',
    },
    note: 'Awaj surveys play recorded voices (TTS is not allowed in surveys yet): record promptBangla, upload it as a voice, and use its name in question_voices.',
  };
}

/** Pressed keys from a phone survey -> crop ids, and whether the farmer asked for the officer. */
export function cropsFromKeys(keys: string[]): { crops: string[]; officer: boolean } {
  const crops: string[] = [];
  for (const key of keys) {
    const crop = KEYPAD_CROPS.find(k => k.key === String(key).trim())?.crop;
    if (crop && !crops.includes(crop)) crops.push(crop);
  }
  return { crops, officer: keys.some(k => String(k).trim() === KEYPAD_OFFICER) };
}

const andJoin = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} ও ${names[names.length - 1]}` : names[0] ?? '');

/** Text-to-speech reads symbols aloud; give it words. */
function speakable(text: string): string {
  return text
    .replace(/~/g, '')
    .replace(/\s*–\s*/g, ' থেকে ')
    .replace(/মিমি/g, 'মিলিমিটার')
    .replace(/→/g, ', তারপর')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The spoken reply for a phone call (about 40-60 seconds) and a short SMS. The top option is read with its dates
 * and irrigation; notes from the crop choice (both crops are winter crops, a crop not modelled yet) follow.
 */
export function replyFor(advice: AdviceJSON, understood?: Pick<Understood, 'crops' | 'notModelled'> | null) {
  const top = advice.options[0];
  const [monsoon, rabi, k1] = top.cropSequence;
  const water = top.dimensionDetails.water?.metrics ?? {};
  const choice = advice.crop_choice;
  const place = advice.scope.union_id === 'talanda_tanore' ? bnGenitive(advice.scope.union_name_bangla) : 'আপনার এলাকার';
  const asked = choice?.requested.map(r => r.cropBangla) ?? [];
  const rabiAction = top.approvedActionBangla[2] ?? '';
  const rabiMm = water.rabiNetIrrigationMm;
  // Spoken notes: what the farmer must know (main crop, crops that compete, crops not modelled); not price gaps,
  // scores or the list of monsoon alternatives, which the officer sees on screen
  const notes = (choice?.notesBangla ?? []).filter(n => !n.includes('বাজারদর') && !n.includes('স্কোর') && !n.startsWith('কোনো চক্রে ধান')).slice(0, 2);

  const speech = speakable([
    'আসসালামু আলাইকুম। মাঠের কথা থেকে বলছি।',
    asked.length ? `আপনি ${andJoin(asked)} করতে চেয়েছেন।` : '',
    `নাসার পঁচিশ বছরের আবহাওয়া ও বৃষ্টির হিসাবে ${place} জন্য ভালো চক্র: ${[
      monsoon.seasonType === 'Aman' ? `আমনে ${monsoon.varietyBangla}` : monsoon.fallow ? '' : `বর্ষায় ${monsoon.cropBangla}`,
      `${monsoon.fallow ? 'শীতে ' : ''}${rabi.cropBangla}`,
      k1 ? k1.cropBangla : '',
    ].filter(Boolean).join(', তারপর ')}।`,
    top.approvedActionBangla[0] ?? '',
    rabiAction,
    typeof rabiMm === 'number' && !rabiAction.includes('মিমি') ? `${rabi.cropBangla} চাষে সেচ লাগবে প্রায় ${bnDigits(rabiMm)} মিমি।` : '',
    top.approvedActionBangla[3] ?? '',
    // One soil-and-water saving the farmer can hear: the first sentence of the water tip
    (top.stewardship?.find(t => t.kind === 'water')?.bn.split('।')[0] ?? '') + (top.stewardship?.some(t => t.kind === 'water') ? '।' : ''),
    ...notes,
    notes.some(n => n.includes('কর্মকর্তা')) ? 'ধন্যবাদ।' : 'বিস্তারিত জানতে আপনার উপসহকারী কৃষি কর্মকর্তার সাথে কথা বলুন। ধন্যবাদ।',
  ].filter(Boolean).join(' '));

  const verb = (p: typeof rabi) => (p.seasonType === 'Aman' || p.seasonType === 'Aus' || p.crop.toLowerCase().includes('rice') ? 'রোপণ' : 'বপন');
  const named = (p: typeof rabi) => `${p.seasonType === 'Aman' ? p.varietyBangla : p.cropBangla}${p.sowingBangla ? ` (${verb(p)} ~${p.sowingBangla})` : ''}`;
  const sms = `মাঠের কথা: ${[monsoon, rabi, k1].filter(p => p && !p.fallow).map(p => named(p!)).join(' → ')}${monsoon.fallow ? '; বর্ষায় ধান নেই' : ''}। প্রশ্নে SAAO-কে ফোন করুন।`;

  return {
    speechBangla: speech,
    smsBangla: sms,
    smsSegments: sms.length <= 70 ? 1 : Math.ceil(sms.length / 67), // Bangla SMS is Unicode: 70 characters, 67 per part
    durationSecondsEstimate: Math.max(20, Math.round(speech.length / 12)),
    topOptionId: top.id,
    understoodCrops: understood?.crops ?? choice?.requested.map(r => r.id) ?? [],
    notModelled: understood?.notModelled ?? choice?.notModelled.map(n => n.id) ?? [],
  };
}

/** A typed or transcribed sentence -> what to plan for. */
export function understand(text: string): Understood {
  return understandRequest(text);
}

/**
 * What a heard sentence asks the engine for: the main crop, the other crops (crops we do not model ride along so the
 * advice can say so), the crops to avoid, the land type and the priorities. Fields the sentence did not name are
 * left out, so a caller's own values stay.
 */
export function requestFromWords(heard: Understood) {
  const others = heard.crops.filter(c => c !== heard.hero);
  const crops = [...others, ...heard.notModelled];
  return {
    ...(heard.hero ? { heroCrop: heard.hero } : {}),
    ...(crops.length ? { preferredCrops: crops } : {}),
    ...(heard.excluded.length ? { avoidCrops: heard.excluded } : {}),
    ...(heard.landType ? { landType: heard.landType } : {}),
    ...(heard.irrigation ? { irrigation: heard.irrigation } : {}),
    ...(heard.priorities ? { farmerPriorities: heard.priorities } : {}),
  };
}
