import type { EvaluationContext } from '@project-eden/contracts';
import { LOC } from './location.ts';
import { AMAN_CATALOG } from './crop_catalog.ts';
import { catalogFor, recordFor } from './crop_choice.ts';

/*
 * Look up a rotation's crops by their explicit season. These throw instead of falling back to a default crop:
 * a silent fallback once made the dhan49 -> Boro rotation score with lentil's water and heat numbers.
 * Rabi and Kharif-1 varieties are research-release keys ('BARI Masur-8') or crop-choice keys ('sunflower@11-25').
 */

export function amanOf(context: EvaluationContext) {
  const crop = context.crops.find(c => c.season === 'Aman');
  const record = crop ? LOC.aman[crop.variety] : undefined;
  const catalog = crop ? AMAN_CATALOG[crop.variety] : undefined;
  if (!crop || !record || !catalog) {
    throw new Error(`No Aman replay data for "${crop?.variety ?? 'none'}" in rotation ${context.rotationId}`);
  }
  return { crop, record, catalog };
}

/** The Aman crop when the plan has one; plans built around another crop may leave rice out. */
export function amanOrNull(context: EvaluationContext) {
  return context.crops.some(c => c.season === 'Aman') ? amanOf(context) : null;
}

/** A non-rice crop in the monsoon (Kharif-2) slot, when the plan has one. */
export function kharif2Of(context: EvaluationContext) {
  const crop = context.crops.find(c => c.season === 'Kharif-2');
  if (!crop) return null;
  const record = recordFor(crop.variety);
  const catalog = catalogFor(crop.variety);
  if (!record || !catalog) {
    throw new Error(`No Kharif-2 replay data for "${crop.variety}" in rotation ${context.rotationId}`);
  }
  return { crop, record, catalog };
}

export function rabiOf(context: EvaluationContext) {
  const crop = context.crops.find(c => c.season === 'Rabi');
  const record = crop ? recordFor(crop.variety) : undefined;
  const catalog = crop ? catalogFor(crop.variety) : undefined;
  if (!crop || !record || !catalog) {
    throw new Error(`No Rabi replay data for "${crop?.variety ?? 'none'}" in rotation ${context.rotationId}`);
  }
  return { crop, record, catalog };
}

/** The crop between the winter crop and the next Aman, when the rotation has one. */
export function kharif1Of(context: EvaluationContext) {
  const crop = context.crops.find(c => c.season === 'Kharif-1');
  if (!crop) return null;
  const record = recordFor(crop.variety);
  const catalog = catalogFor(crop.variety);
  if (!record || !catalog) {
    throw new Error(`No Kharif-1 replay data for "${crop.variety}" in rotation ${context.rotationId}`);
  }
  return { crop, record, catalog };
}

export function clampScore(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Number(value.toFixed(2))));
}
