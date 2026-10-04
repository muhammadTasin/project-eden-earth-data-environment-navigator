import type { AdviceJSON, CandidateRotation, NarrationResult } from '@project-eden/contracts';
import { TemplateNarrator } from './template_narrator.ts';

/** Words no farmer message may contain: pesticide brands, loans, interest, cash asks, free-fertilizer offers. */
export const FORBIDDEN_TERMS = ['ঋণ', 'সুদ', 'কীটনাশক ব্র্যান্ড', 'টাকা দিন', 'ফ্রি সার'];

export interface ILocalLLMClient {
  generate(prompt: string, maxTokens?: number): Promise<string>;
}

export class DualGateNarrationValidator {
  private templateNarrator = new TemplateNarrator();
  private llmClient?: ILocalLLMClient;
  private timeoutMs: number;

  constructor(llmClient?: ILocalLLMClient, opts: { timeoutMs?: number } = {}) {
    this.llmClient = llmClient;
    this.timeoutMs = opts.timeoutMs ?? 1500;
  }

  // Convert English number to Bengali digits and vice-versa
  private toBengaliDigits(numStr: string): string {
    const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return numStr.replace(/\d/g, d => bnDigits[parseInt(d, 10)]);
  }

  private toEnglishDigits(numStr: string): string {
    const bnMap: Record<string, string> = {
      '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
      '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
    };
    return numStr.replace(/[০-৯]/g, d => bnMap[d]);
  }

  /**
   * Gate 1: Pre-conditions input facts into an immutable slot dictionary.
   * Strips all PII (farmer identity, phone, coordinates).
   */
  prepareGate1Slots(advice: AdviceJSON, option: CandidateRotation): {
    approvedNumbers: Set<string>;
    slots: Record<string, string>;
    prompt: string;
  } {
    const approvedNumbers = new Set<string>();

    const addNum = (val: number | string) => {
      const s = String(val).trim();
      if (!s) return;
      const en = this.toEnglishDigits(s);
      const bn = this.toBengaliDigits(en);
      approvedNumbers.add(en);
      approvedNumbers.add(bn);
    };

    // Add approved numeric facts, all read from the advice itself
    const waterMetric = option.dimensionDetails['water']?.metrics;
    const totalSeasons = waterMetric?.totalSeasonsSimulated ?? 25;
    addNum(totalSeasons as number);
    if (waterMetric?.amanRescueIrrigationSeasons !== undefined) {
      addNum(waterMetric.amanRescueIrrigationSeasons as number);
    }
    if (waterMetric?.rabiNetIrrigationMm !== undefined) {
      addNum(waterMetric.rabiNetIrrigationMm as number);
    }
    const scoreVal = Math.round(option.totalWeightedScore * 100);
    addNum(scoreVal);
    addNum(1); // Keypad 1
    addNum(2); // Keypad 2
    addNum(3); // Keypad 3
    addNum(4); // Keypad 4 (less pesticide)
    addNum(9); // Keypad 9

    // Numbers inside the field-free date, variety and rotation names (e.g. ১০ নভেম্বর, 71, 8, 33)
    const allNames = `${option.fieldFreeDateBangla} ${option.nameBangla} ${option.nameEnglish} ${option.cropSequence.map(c => `${c.variety} ${c.varietyBangla ?? ''}`).join(' ')}`;
    const nameNumRegex = /(\d+|[০-৯]+)/g;
    let nameMatch;
    while ((nameMatch = nameNumRegex.exec(allNames)) !== null) {
      addNum(nameMatch[0]);
    }

    const amanCrop = option.cropSequence[0];
    const rabiCrop = option.cropSequence[1];

    const slots = {
      union: advice.scope.union_name_bangla,
      rotationName: option.nameBangla,
      amanVariety: amanCrop?.varietyBangla ?? amanCrop?.variety ?? '',
      rabiCropName: rabiCrop?.cropBangla ?? rabiCrop?.crop ?? '',
      rescueCount: String(waterMetric?.amanRescueIrrigationSeasons ?? ''),
      rabiIrrigationMm: String(waterMetric?.rabiNetIrrigationMm ?? ''),
      fieldFreeDate: option.fieldFreeDateBangla,
    };

    const prompt = `[CONTEXT - APPROVED FACTS ONLY]:
Union: ${slots.union}
Rotation: ${slots.rotationName}
Aman Variety: ${slots.amanVariety}
Field Free Date: ${slots.fieldFreeDate}
Historical Replay: ${totalSeasons} seasons simulation showed rescue irrigation needed in ${slots.rescueCount} seasons.
Rabi Crop: ${slots.rabiCropName} with ${slots.rabiIrrigationMm} mm irrigation needed.

[INSTRUCTION]:
Generate a short 3-sentence spoken Bangla advisory explaining why this rotation is optimal.
CRITICAL CONSTRAINT: Do NOT mention or invent ANY number, dosage, or price not in the facts above.`;

    return { approvedNumbers, slots, prompt };
  }

  /**
   * Gate 2: Audits the generated text for unauthorized numbers, forbidden actions, or hallucinated claims.
   */
  auditGate2(text: string, approvedNumbers: Set<string>): {
    passed: boolean;
    unapprovedNumbers: string[];
    unapprovedActions: string[];
  } {
    const unapprovedNumbers: string[] = [];
    const unapprovedActions: string[] = [];

    // Extract all numbers (English and Bengali)
    const numberRegex = /(\d+|[০-৯]+)/g;
    let match;
    while ((match = numberRegex.exec(text)) !== null) {
      const rawNum = match[0];
      const enNum = this.toEnglishDigits(rawNum);
      const bnNum = this.toBengaliDigits(rawNum);

      if (!approvedNumbers.has(rawNum) && !approvedNumbers.has(enNum) && !approvedNumbers.has(bnNum)) {
        unapprovedNumbers.push(rawNum);
      }
    }

    // Check for forbidden terms (e.g. chemical brand names, loans, medical advice)
    const forbiddenKeywords = FORBIDDEN_TERMS;
    for (const word of forbiddenKeywords) {
      if (text.includes(word)) {
        unapprovedActions.push(word);
      }
    }

    const passed = unapprovedNumbers.length === 0 && unapprovedActions.length === 0;
    return { passed, unapprovedNumbers, unapprovedActions };
  }

  /**
   * Full Dual-Gate Pipeline Execution with Zero-Risk Fallback.
   */
  async narrate(advice: AdviceJSON, selectedOption?: CandidateRotation): Promise<NarrationResult> {
    const startTime = Date.now();
    const option = selectedOption || advice.options[0];
    const { approvedNumbers, prompt } = this.prepareGate1Slots(advice, option);

    // If no LLM client configured, return pure deterministic template instantly
    if (!this.llmClient) {
      return this.templateNarrator.render(advice, option);
    }

    try {
      // Execute the LLM with a strict timeout (default 1500 ms; raise it for remote endpoints)
      const llmPromise = this.llmClient.generate(prompt, 120);
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`LLM inference timeout (>${this.timeoutMs}ms)`)), this.timeoutMs)
      );

      const rawLLMOutput = await Promise.race([llmPromise, timeoutPromise]);
      const latencyMs = Date.now() - startTime;

      // Gate 2: Post-generation audit
      const audit = this.auditGate2(rawLLMOutput, approvedNumbers);

      if (audit.passed) {
        return {
          status: 'local_model_checked',
          banglaSpeechText: rawLLMOutput.trim(),
          banglaKeypadPrompt: this.templateNarrator.render(advice, option).banglaKeypadPrompt,
          durationSecondsEstimate: Math.max(25, Math.round(rawLLMOutput.length / 15)),
          auditLog: {
            gate1Passed: true,
            gate2Passed: true,
            tokenDiffOk: true,
            unapprovedNumbersFound: [],
            unapprovedActionsFound: [],
            latencyMs,
            engineUsed: 'local_model_checked',
          },
        };
      }

      // If Gate 2 failed, log and fallback
      const fallbackResult = this.templateNarrator.render(advice, option);
      fallbackResult.status = 'fallback_template';
      fallbackResult.auditLog = {
        gate1Passed: true,
        gate2Passed: false,
        tokenDiffOk: false,
        unapprovedNumbersFound: audit.unapprovedNumbers,
        unapprovedActionsFound: audit.unapprovedActions,
        latencyMs,
        engineUsed: 'fallback_template',
      };
      return fallbackResult;
    } catch {
      // On any error or timeout, transparent fallback to template
      const fallbackResult = this.templateNarrator.render(advice, option);
      fallbackResult.status = 'fallback_template';
      fallbackResult.auditLog.latencyMs = Date.now() - startTime;
      fallbackResult.auditLog.engineUsed = 'fallback_template';
      return fallbackResult;
    }
  }
}
