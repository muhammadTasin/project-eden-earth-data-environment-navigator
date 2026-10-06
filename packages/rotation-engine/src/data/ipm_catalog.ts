import type { IpmTip } from '@project-eden/contracts';

/**
 * Integrated pest management (IPM) steps shown with each rotation. They favour rotation, timing, resistant
 * varieties and scouting over sprays, and never name a pesticide product (the narration gate also blocks brands).
 *
 * Facts from the research tables are cited to them (BWMRI and BRRI variety pages, SRDI card). A tip that cites or leans on the SRDI card
 * carries `needsSoilCard: true` and is left out where a place has no card. The rest are
 * standard IPM rules, marked "IPM principle"; there are no field pest counts for Talanda yet.
 */

export const IPM_GENERAL: IpmTip[] = [
  {
    bn: 'স্প্রে করার আগে মাঠ ঘুরে ক্ষতিকর ও উপকারী পোকা গুনুন; ক্ষতির মাত্রা ছাড়ালে তবেই, কর্মকর্তার পরামর্শে ওষুধ দিন।',
    en: 'Scout before spraying: count pests and their natural enemies, and spray only past the damage threshold, on the officer’s advice.',
    source: 'IPM principle (DAE, FAO)',
  },
  {
    bn: 'SRDI কার্ডের চেয়ে বেশি ইউরিয়া দেবেন না; বেশি নাইট্রোজেনে পোকা ও রোগ বাড়ে।',
    en: 'Do not go above the SRDI urea dose; extra nitrogen invites pests and disease.',
    source: 'SRDI Talanda card; IPM principle',
    needsSoilCard: true,
  },
];

export const IPM_AMAN: IpmTip[] = [
  {
    bn: 'আমনে আলোক ফাঁদ দিন ও ডাল পুঁতে পাখি বসার ব্যবস্থা (পার্চিং) করুন; পাখি ও ফাঁদ পোকা কমায়।',
    en: 'In Aman, set light traps and perching sticks; birds and traps take out insect pests.',
    source: 'BRRI rice IPM guidance',
  },
];

/** Keyed like TANORE_RABI_REPLAY. */
export const IPM_BY_RABI: Record<string, IpmTip[]> = {
  'BARI Masur-8': [
    {
      bn: 'ধানের পর ডাল: ধানের পোকার চক্র ভাঙে, আর মসুরে ইউরিয়া লাগে সামান্য।',
      en: 'A pulse after rice breaks the rice-pest cycle, and lentil needs little urea.',
      source: 'IPM principle; SRDI Talanda card',
      needsSoilCard: true,
    },
    {
      bn: 'জমিতে পানি জমতে দেবেন না; ভেজা মাটিতে গোড়া পচা রোগ বাড়ে।',
      en: 'Keep water from standing in the field; wet soil favours root rot.',
      source: 'BARI pulse guidance',
    },
  ],
  'BARI Sarisha-14': [
    {
      bn: '১৫ নভেম্বরের মধ্যে বুনুন; দেরিতে বোনা সরিষায় জাব পোকা বেশি লাগে।',
      en: 'Sow by 15 Nov; late-sown mustard gets more aphids.',
      source: 'BARI oilseed guidance',
    },
    {
      bn: 'ফুল ফোটার সময় স্প্রে করবেন না; মৌমাছি সরিষার পরাগায়ন করে।',
      en: 'Do not spray at flowering; bees pollinate mustard.',
      source: 'IPM principle',
    },
  ],
  'BARI Gom 33 (Early)': [
    {
      bn: 'বারি গম-৩৩ ব্লাস্ট ও মরিচা রোগ প্রতিরোধী, তাই ছত্রাকনাশক কম লাগে।',
      en: 'BARI Gom 33 resists blast and rust, so fewer fungicide sprays are needed.',
      source: 'BWMRI variety page',
    },
    {
      bn: '১৫–৩০ নভেম্বরের মধ্যে বুনুন; দেরিতে বোনা গমে তাপ ও রোগের ঝুঁকি বাড়ে।',
      en: 'Sow 15–30 Nov; late wheat meets more heat and disease.',
      source: 'BWMRI variety page',
    },
  ],
  'BARI Gom 33 (Late)': [
    {
      bn: 'বারি গম-৩৩ ব্লাস্ট ও মরিচা রোগ প্রতিরোধী, তবে ডিসেম্বরে বুনলে তাপ ও রোগের চাপ বাড়ে।',
      en: 'BARI Gom 33 resists blast and rust, but December sowing raises heat and disease pressure.',
      source: 'BWMRI variety page',
    },
  ],
  'BRRI dhan28': [
    {
      bn: 'ধানের পর আবার ধানে মাজরা পোকা ও বাদামি গাছফড়িং সারা বছর খাবার পায়; রবিতে অন্য ফসল দিলে চক্র ভাঙে।',
      en: 'Rice after rice feeds stem borers and brown planthoppers all year; a non-rice Rabi crop breaks the cycle.',
      source: 'IPM principle',
    },
    {
      bn: 'বোরো রাখলে ব্লাস্ট-প্রতিরোধী জাত (যেমন ব্রি ধান১১৪) বিবেচনা করুন।',
      en: 'If Boro stays, consider a blast-resistant variety such as BRRI dhan114.',
      source: 'BRRI dhan114 factsheet',
    },
  ],
};

/** Research-backed disease resistance of the Rabi varieties in the candidate rotations. */
export const RESISTANT_VARIETIES: Record<string, { bn: string; en: string; source: string }> = {
  'BARI Gom 33 (Early)': { bn: 'ব্লাস্ট ও মরিচা রোগ প্রতিরোধী', en: 'blast and rust resistant', source: 'BWMRI variety page' },
  'BARI Gom 33 (Late)': { bn: 'ব্লাস্ট ও মরিচা রোগ প্রতিরোধী', en: 'blast and rust resistant', source: 'BWMRI variety page' },
};
