/**
 * What a farmer asked for, from a sentence in Bangla, Banglish or English: the crops they want (and do not want),
 * the land type and what matters to them. It is the step between speech-to-text (a phone call, the app's mic, a
 * typed message) and the rotation engine, and it is rule-based on purpose: every word it acts on is listed in
 * data/crop_choice.ts, so an officer can see why a request was read the way it was.
 */
import type { LandType } from '@project-eden/contracts';
import { CHOICE_CROPS, CROP_GROUPS, NOT_MODELLED } from './data/crop_choice.ts';

export interface Understood {
  text: string;
  crops: string[]; // crop_choice.ts ids and group ids, in the order heard
  excluded: string[]; // crops named in a negative clause ("বোরো করব না")
  notModelled: string[]; // crops we do not replay yet (jute, onion...)
  landType: LandType | null;
  priorities: Record<string, number> | null; // water, income, soil, pest, fodder
  heard: Array<{ word: string; id: string; kind: 'crop' | 'group' | 'not_modelled' | 'land' | 'priority' }>;
}

const nfc = (s: string) => s.normalize('NFC').toLowerCase();

/** Endings a Bangla crop word can carry: মসুরের, আলুর, গমে, ভুট্টাও, সরিষা-টা, মসুরডাল... */
const SUFFIXES = ['', 'র', 'ের', 'এর', 'ে', 'য়', 'য়ে', 'তে', 'টা', 'টি', 'গুলো', 'ও', 'ই', 'কে', 'রও', 'েরও', 'ডাল', 'চাষ', 'সহ'].map(nfc);
const NEGATIONS = ['না', 'নয়', 'নাই', 'নেই', 'বাদ', 'চাইনা', 'not', "don't", 'dont', 'no'].map(nfc);
const CLAUSE_BREAK = /[।.,;!?\n]|\s(?:কিন্তু|তবে|but)\s/u;

const LAND: Array<[string[], LandType]> = [
  [['খুব নিচু', 'very low'], 'very_low'],
  [['মাঝারি নিচু', 'medium low'], 'medium_low'],
  [['মাঝারি উঁচু', 'মাঝারি উচু', 'medium high'], 'medium_high'],
  [['নিচু', 'নীচু', 'nichu', 'low land', 'lowland'], 'low'],
  [['উঁচু', 'উচু', 'uchu', 'high land', 'highland'], 'high'],
];

const PRIORITY: Array<[string[], string]> = [
  [['পানি', 'সেচ', 'pani', 'water', 'irrigation'], 'water'],
  [['লাভ', 'আয়', 'টাকা', 'দাম', 'income', 'profit', 'money'], 'income'],
  [['মাটি', 'soil'], 'soil'],
  [['পোকা', 'কীটনাশক', 'বিষ', 'pest', 'pesticide'], 'pest'],
  [['গরু', 'গোখাদ্য', 'খড়', 'fodder', 'cattle'], 'fodder'],
];

interface Lexeme { forms: string[]; id: string; kind: Understood['heard'][number]['kind'] }

const LEXICON: Lexeme[] = [
  ...CHOICE_CROPS.filter(c => c.aliases.length).map(c => ({ forms: c.aliases.map(nfc), id: c.id, kind: 'crop' as const })),
  ...CROP_GROUPS.map(g => ({ forms: g.aliases.map(nfc), id: g.id, kind: 'group' as const })),
  ...NOT_MODELLED.map(n => ({ forms: n.aliases.map(nfc), id: n.id, kind: 'not_modelled' as const })),
];

function tokens(clause: string): string[] {
  return clause.replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
}

/** A token is the form itself, the form with a Bangla ending, or an English plural. */
function tokenMatches(token: string, form: string): boolean {
  if (token === form || token === `${form}s`) return true;
  return token.startsWith(form) && SUFFIXES.includes(token.slice(form.length));
}

export function understandRequest(raw: string): Understood {
  const text = nfc(raw ?? '').trim();
  const heard: Understood['heard'] = [];
  const crops: string[] = [];
  const excluded: string[] = [];
  const notModelled: string[] = [];

  for (const part of text.split(CLAUSE_BREAK)) {
    let clause = ` ${part} `;
    const negative = tokens(clause).some(t => NEGATIONS.includes(t));
    // Several-word names first (মিষ্টি আলু, grass pea), then single words, so "মিষ্টি আলু" is not read as potato
    const lexemes = [...LEXICON].sort((a, b) => Math.max(...b.forms.map(f => f.length)) - Math.max(...a.forms.map(f => f.length)));
    const found: Array<{ id: string; kind: Lexeme['kind']; word: string }> = [];
    for (const lex of lexemes) {
      for (const form of lex.forms.filter(f => f.includes(' '))) {
        if (clause.includes(` ${form} `) || clause.includes(` ${form}`)) {
          found.push({ id: lex.id, kind: lex.kind, word: form });
          clause = clause.split(form).join(' ');
        }
      }
    }
    for (const token of tokens(clause)) {
      const lex = lexemes.find(l => l.forms.some(f => !f.includes(' ') && tokenMatches(token, f)));
      if (lex) found.push({ id: lex.id, kind: lex.kind, word: token });
    }
    // A group word ("ডাল") only counts when no member crop was named in the same clause ("মসুর ডাল")
    const named = new Set(found.filter(f => f.kind === 'crop').map(f => f.id));
    for (const f of found) {
      if (f.kind === 'group' && CROP_GROUPS.find(g => g.id === f.id)!.crops.some(c => named.has(c))) continue;
      heard.push({ word: f.word, id: f.id, kind: f.kind });
      const list = f.kind === 'not_modelled' ? notModelled : negative ? excluded : crops;
      if (!list.includes(f.id)) list.push(f.id);
    }
  }

  let landType: LandType | null = null;
  for (const [forms, type] of LAND) {
    const form = forms.map(nfc).find(f => text.includes(f));
    if (form) {
      landType = type;
      heard.push({ word: form, id: type, kind: 'land' });
      break;
    }
  }

  const priorities: Record<string, number> = {};
  for (const [forms, id] of PRIORITY) {
    const form = forms.map(nfc).find(f => tokens(text).some(t => tokenMatches(t, f)));
    if (form) {
      priorities[id] = 1;
      heard.push({ word: form, id, kind: 'priority' });
    }
  }

  return {
    text: raw,
    crops: crops.filter(c => !excluded.includes(c)),
    excluded,
    notModelled,
    landType,
    priorities: Object.keys(priorities).length ? priorities : null,
    heard,
  };
}
