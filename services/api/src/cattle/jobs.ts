/**
 * Background job manager for the cattle pipeline.
 *
 * DURABILITY: jobs run in this process and are persisted to the local JSON store. This is NOT a production
 * queue: a restart interrupts running work (recoverInterruptedJobs marks it failed with
 * `interrupted_by_restart` so it can be retried), there is no worker pool, no locking and one process only.
 * Use a real database and queue for production.
 *
 * Lifecycle: queued -> running -> succeeded | partial | failed | blocked (see JobStatus in types.ts).
 * A job is "succeeded" only when every input it needs was really obtained.
 */
import crypto from 'node:crypto';
import { JOB_TYPES, type BackgroundJob, type JobType, type FarmAOI } from './types.ts';
import { cattleRepository } from './repository.ts';
import { fetchWeatherForAoi } from './adapters/weather_adapter.ts';
import { extractEarthEngineFeatures } from './adapters/earth_engine.ts';
import { compileFeaturesForAoi } from './features.ts';
import { generateCattleAdvisory } from './advisory.ts';
import { triggerModelTraining } from './ml_pipeline.ts';
import { ApiError } from '../errors.ts';

const MAX_ATTEMPTS = 3;
const jobTimeoutMs = () => Number(process.env.CATTLE_JOB_TIMEOUT_MS) || 180000;

class JobTimeout extends Error {}

export class BackgroundJobManager {
  private abandoned = new Set<string>();

  async enqueueJob(aoiId: string, jobType: JobType = 'pipeline_refresh'): Promise<BackgroundJob> {
    if (!(JOB_TYPES as readonly string[]).includes(jobType)) {
      throw new ApiError('invalid_input', `Unknown jobType "${jobType}"`, { allowed: JOB_TYPES });
    }
    const aoi = await cattleRepository.getAoi(aoiId);
    if (!aoi) throw new ApiError('not_found', `AOI "${aoiId}" not found`);

    const job: BackgroundJob = {
      jobId: `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      aoiId,
      jobType,
      status: 'queued',
      progressPct: 0,
      stageMessage: 'Queued',
      stageMessageBangla: 'লাইনে জমা হয়েছে',
      errors: [],
      missing: [],
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      queuedAt: new Date().toISOString(),
    };
    await cattleRepository.saveJob(job);
    this.schedule(job, aoi);
    return job;
  }

  /** Manual retry of a failed job. Blocked jobs are not retried until configuration/data changes, so they are rejected too. */
  async retryJob(jobId: string): Promise<BackgroundJob> {
    const job = await cattleRepository.getJob(jobId);
    if (!job) throw new ApiError('not_found', `Job "${jobId}" not found`);
    if (job.status !== 'failed' && job.status !== 'blocked') {
      throw new ApiError('invalid_input', `Only failed or blocked jobs can be retried (job is ${job.status})`);
    }
    if (job.attempts >= job.maxAttempts) {
      throw new ApiError('invalid_input', `Job already used its ${job.maxAttempts} attempts; enqueue a new job instead`);
    }
    const aoi = await cattleRepository.getAoi(job.aoiId);
    if (!aoi) throw new ApiError('not_found', `AOI "${job.aoiId}" not found`);
    Object.assign(job, {
      status: 'queued', progressPct: 0, stageMessage: 'Queued for retry', stageMessageBangla: 'পুনরায় চেষ্টার জন্য লাইনে জমা হয়েছে',
      errors: [], missing: [], errorCode: undefined, finishedAt: undefined, startedAt: undefined, resultsSummary: undefined,
    });
    await cattleRepository.saveJob(job);
    this.schedule(job, aoi);
    return job;
  }

  /** Call once at startup: anything still queued/running belonged to a previous process and will never finish. */
  async recoverInterruptedJobs(): Promise<number> {
    let n = 0;
    for (const job of await cattleRepository.listJobs()) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.errorCode = 'interrupted_by_restart';
        job.finishedAt = new Date().toISOString();
        job.stageMessage = 'Interrupted by a server restart; retry the job';
        job.stageMessageBangla = 'সার্ভার রিস্টার্টের কারণে কাজটি থেমে গেছে; আবার চেষ্টা করুন';
        job.errors.push('interrupted_by_restart');
        await cattleRepository.saveJob(job);
        n++;
      }
    }
    return n;
  }

  private schedule(job: BackgroundJob, aoi: FarmAOI): void {
    setImmediate(() => {
      this.run(job.jobId, aoi).catch(err => console.error(`Background job ${job.jobId} crashed:`, err));
    });
  }

  private async run(jobId: string, aoi: FarmAOI): Promise<void> {
    const job = await cattleRepository.getJob(jobId);
    if (!job) return;
    job.attempts += 1;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    await this.save(job, 5, 'Starting', 'শুরু হচ্ছে');

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.execute(job, aoi),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new JobTimeout()), jobTimeoutMs()); }),
      ]);
    } catch (err: any) {
      this.abandoned.add(job.jobId); // stop a still-running execute() from overwriting the final state
      const timedOut = err instanceof JobTimeout;
      const code = timedOut ? 'timeout' : err instanceof ApiError ? err.code : 'internal';
      job.status = code === 'configuration_required' ? 'blocked' : 'failed';
      job.errorCode = code;
      job.finishedAt = new Date().toISOString();
      const message = timedOut ? `Timed out after ${jobTimeoutMs()} ms` : String(err?.message || err);
      job.errors.push(message);
      job.stageMessage = `${job.status === 'blocked' ? 'Blocked' : 'Failed'}: ${message}`;
      job.stageMessageBangla = job.status === 'blocked' ? 'প্রয়োজনীয় কনফিগারেশন বা উপাত্ত নেই; কাজটি আটকে আছে' : 'কাজটি ব্যর্থ হয়েছে';
      job.progressPct = 100;
      await cattleRepository.saveJob(job);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Persist a progress update unless the job was already finalised (e.g. by a timeout). */
  private async save(job: BackgroundJob, pct: number, en: string, bn: string): Promise<void> {
    if (this.abandoned.has(job.jobId)) throw new JobTimeout();
    job.progressPct = pct;
    job.stageMessage = en;
    job.stageMessageBangla = bn;
    await cattleRepository.saveJob(job);
  }

  private async execute(job: BackgroundJob, aoi: FarmAOI): Promise<void> {
    if (job.jobType === 'train_model') {
      await this.save(job, 40, 'Checking for labelled training data', 'প্রশিক্ষণের যাচাইকৃত উপাত্ত খোঁজা হচ্ছে');
      const result = await triggerModelTraining('heat_stress_panting', aoi);
      job.finishedAt = new Date().toISOString();
      job.progressPct = 100;
      job.resultsSummary = { modelStatus: result.status };
      if (result.success) {
        job.status = 'succeeded';
        job.stageMessage = result.message;
        job.stageMessageBangla = 'প্রশিক্ষণ সম্পন্ন';
      } else {
        job.status = 'blocked';
        job.errorCode = result.status;
        job.errors.push(result.message);
        job.missing.push({ input: 'labelled_training_data', reason: result.message });
        job.stageMessage = result.message;
        job.stageMessageBangla = 'প্রশিক্ষণের জন্য যাচাইকৃত লেবেলযুক্ত উপাত্ত নেই; কোনো মডেল তৈরি হয়নি';
      }
      await cattleRepository.saveJob(job);
      return;
    }

    const needsWeather = job.jobType !== 'satellite_extract';
    const needsSatellite = job.jobType !== 'weather_refresh';

    let weather: Awaited<ReturnType<typeof fetchWeatherForAoi>> | null = null;
    if (needsWeather) {
      await this.save(job, 25, 'Fetching Open-Meteo forecast and NASA POWER observations', 'আবহাওয়া পূর্বাভাস ও নাসা পর্যবেক্ষণ সংগ্রহ');
      weather = await fetchWeatherForAoi(aoi); // Open-Meteo failure throws -> job failed (provider_unavailable)
      if (weather.nasaUnavailableReason) job.missing.push({ input: 'nasa_power', reason: weather.nasaUnavailableReason });
    }

    let satelliteFeatures = needsSatellite ? [] : await cattleRepository.getFeatures(aoi.aoiId);
    let satelliteReport: { unavailable: Array<{ dataset: string; reason: string }>; reason?: string } = { unavailable: [] };
    let eeStatus: string | null = null;
    if (needsSatellite) {
      await this.save(job, 50, 'Extracting satellite data through Earth Engine', 'আর্থ ইঞ্জিন থেকে উপগ্রহ উপাত্ত সংগ্রহ');
      const ee = await extractEarthEngineFeatures(aoi);
      eeStatus = ee.status;
      satelliteFeatures = ee.features;
      satelliteReport = { unavailable: ee.unavailable, reason: ee.message };
      if (ee.features.length > 0) await cattleRepository.saveFeatures(aoi.aoiId, ee.features);
      for (const u of ee.unavailable) job.missing.push({ input: u.dataset, reason: u.reason });
      if (!ee.success) {
        if (job.jobType === 'satellite_extract') {
          // This job exists only to extract satellite data, so having none is a failure/block, not a partial success.
          throw new ApiError(ee.status === 'configuration_required' ? 'configuration_required' : 'provider_unavailable', ee.message);
        }
        job.errors.push(ee.message);
      }
    }

    let advisorySummary: BackgroundJob['resultsSummary'] = {};
    let qualityIssues: string[] = [];
    if (weather) {
      await this.save(job, 80, 'Computing THI and guidance', 'THI ও পরামর্শ গণনা');
      const compiled = compileFeaturesForAoi(aoi, weather, satelliteFeatures);
      qualityIssues = compiled.qualityIssues;
      const advisory = generateCattleAdvisory(aoi, compiled, satelliteFeatures, satelliteReport);
      await cattleRepository.saveAdvisory(advisory);
      advisorySummary = {
        thiLatest: advisory.derived.thi.current,
        thiCategory: advisory.derived.thi.category,
        weatherSource: 'Open-Meteo (model estimate)' + (weather.nasaAgroclimatology ? ' + NASA POWER (delayed)' : ''),
        modelStatus: advisory.modelStatus.modelRegistryStatus,
      };
    }

    job.resultsSummary = {
      ...advisorySummary,
      satelliteSource: needsSatellite ? (satelliteFeatures.length ? 'Google Earth Engine' : 'Unavailable') : 'Not requested',
      featuresExtracted: needsSatellite ? satelliteFeatures.length : undefined,
      featuresExpected: needsSatellite ? 3 : undefined,
      isRegionalProxy: satelliteFeatures.some(f => f.isRegionalProxy),
      qualityIssues,
    };
    job.progressPct = 100;
    job.finishedAt = new Date().toISOString();
    if (this.abandoned.has(job.jobId)) return;
    if (job.missing.length === 0) {
      job.status = 'succeeded';
      job.stageMessage = 'Completed: all inputs were obtained';
      job.stageMessageBangla = 'সম্পন্ন: সব প্রয়োজনীয় উপাত্ত পাওয়া গেছে';
    } else {
      job.status = 'partial';
      job.errorCode = eeStatus === 'configuration_required' ? 'configuration_required' : undefined;
      job.stageMessage = `Completed with missing inputs: ${job.missing.map(m => m.input).join(', ')}`;
      job.stageMessageBangla = 'আংশিক সম্পন্ন: কিছু উপাত্ত পাওয়া যায়নি';
    }
    await cattleRepository.saveJob(job);
  }
}

export const backgroundJobManager = new BackgroundJobManager();
