/**
 * Hand-written crop facts that are not research outputs: Bangla names, legume and fodder classes, and the income
 * placeholders. Research numbers live in the generated tanore_replay_data.ts.
 *
 * The gross margins are team estimates kept for the demo. They are not market data: DAM farm-gate prices and a
 * farmer cost survey are still pending, so the income plugin reports them as illustrative, low confidence.
 */

export interface AmanCatalogEntry {
  varietyBangla: string;
  noteBangla: string;
  noteEnglish: string;
}

export interface RabiCatalogEntry {
  crop: string;
  cropBangla: string;
  cropInBangla: string; // locative, 'মসুরে'
  varietyBangla: string;
  isLegume: boolean;
  isRice: boolean;
  hostGroup: 'rice' | 'legume' | 'brassica' | 'cereal' | 'oilseed' | 'tuber'; // pests carry over between crops of the same group
  fodderValue: 'high' | 'medium' | 'low';
  fodderNoteBangla: string;
  illustrativeGrossMarginTkPerHa: number | null; // null: no price and cost data yet, so income stays neutral
}

export const AMAN_CATALOG: Record<string, AmanCatalogEntry> = {
  'BRRI dhan71': { varietyBangla: 'ব্রি ধান৭১', noteBangla: 'স্বল্পমেয়াদি, খরা সহনশীল', noteEnglish: 'short duration, drought tolerant' },
  'BRRI dhan87': { varietyBangla: 'ব্রি ধান৮৭', noteBangla: 'মধ্যমেয়াদি, উচ্চ ফলনশীল', noteEnglish: 'medium duration, high yielding' },
  'BRRI dhan103': { varietyBangla: 'ব্রি ধান১০৩', noteBangla: 'মধ্যমেয়াদি, উচ্চ ফলনশীল', noteEnglish: 'medium duration, high yielding' },
  'BRRI dhan49': { varietyBangla: 'ব্রি ধান৪৯', noteBangla: 'দীর্ঘমেয়াদি, প্রচলিত জাত', noteEnglish: 'long duration, the usual variety' },
  'BRRI dhan75': { varietyBangla: 'ব্রি ধান৭৫', noteBangla: 'স্বল্পমেয়াদি, দেরিতে রোপণের জাত', noteEnglish: 'short duration, for late planting' },
};

export const RABI_CATALOG: Record<string, RabiCatalogEntry> = {
  'BARI Masur-8': {
    crop: 'Lentil',
    hostGroup: 'legume',
    cropBangla: 'মসুর',
    cropInBangla: 'মসুরে',
    varietyBangla: 'বারি মসুর-৮',
    isLegume: true,
    isRice: false,
    fodderValue: 'medium',
    fodderNoteBangla: 'মসুরের গাছ ও ভুসি গরুর আমিষসমৃদ্ধ খাবার।',
    illustrativeGrossMarginTkPerHa: 68000,
  },
  'BARI Sarisha-14': {
    crop: 'Mustard',
    hostGroup: 'brassica',
    cropBangla: 'সরিষা',
    cropInBangla: 'সরিষায়',
    varietyBangla: 'বারি সরিষা-১৪',
    isLegume: false,
    isRice: false,
    fodderValue: 'low',
    fodderNoteBangla: 'সরিষার জমি থেকে সরাসরি গোখাদ্য কম; খৈল কিনে খাওয়াতে হয়।',
    illustrativeGrossMarginTkPerHa: 52000,
  },
  'BARI Gom 33 (Early)': {
    crop: 'Wheat',
    hostGroup: 'cereal',
    cropBangla: 'গম',
    cropInBangla: 'গমে',
    varietyBangla: 'বারি গম-৩৩',
    isLegume: false,
    isRice: false,
    fodderValue: 'high',
    fodderNoteBangla: 'গমের খড় ও ভুসি ভালো শুকনা গোখাদ্য।',
    illustrativeGrossMarginTkPerHa: 58000,
  },
  'BARI Gom 33 (Late)': {
    crop: 'Wheat',
    hostGroup: 'cereal',
    cropBangla: 'গম',
    cropInBangla: 'গমে',
    varietyBangla: 'বারি গম-৩৩',
    isLegume: false,
    isRice: false,
    fodderValue: 'high',
    fodderNoteBangla: 'গমের খড় ও ভুসি ভালো শুকনা গোখাদ্য।',
    illustrativeGrossMarginTkPerHa: 39000,
  },
  'BRRI dhan28': {
    crop: 'Boro rice',
    hostGroup: 'rice',
    cropBangla: 'বোরো ধান',
    cropInBangla: 'বোরো ধানে',
    varietyBangla: 'ব্রি ধান২৮',
    isLegume: false,
    isRice: true,
    fodderValue: 'high',
    fodderNoteBangla: 'বোরোর খড় প্রচুর শুকনা গোখাদ্য দেয়।',
    illustrativeGrossMarginTkPerHa: 62000,
  },
};

export const ILLUSTRATIVE_AMAN_GROSS_MARGIN_TK_PER_HA = 42000;
