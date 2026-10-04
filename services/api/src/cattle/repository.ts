/**
 * Persistence layer for AOIs, Background Jobs, Features, and Cattle Advisories.
 * The file-backed JSON implementation is for local development and single-process demos ONLY: synchronous
 * writes, no locking, no multi-process safety. It is not production-durable; swap ICattleRepository for a
 * real database before production use.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FarmAOI, BackgroundJob, ExtractedFeature, CattleAdvisoryResult } from './types.ts';
import { createFarmAoi } from './aoi.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../.data');
const DEFAULT_STORE_FILE = process.env.CATTLE_STORE_PATH || path.join(DEFAULT_DATA_DIR, 'cattle_store.json');

export interface ICattleRepository {
  // AOI CRUD
  getAoi(aoiId: string): Promise<FarmAOI | null>;
  listAois(): Promise<FarmAOI[]>;
  saveAoi(aoi: FarmAOI): Promise<FarmAOI>;
  deleteAoi(aoiId: string): Promise<boolean>;

  // Background Job operations
  getJob(jobId: string): Promise<BackgroundJob | null>;
  listJobs(aoiId?: string): Promise<BackgroundJob[]>;
  saveJob(job: BackgroundJob): Promise<BackgroundJob>;

  // Feature operations (keyed strictly by AOI and date)
  saveFeatures(aoiId: string, features: ExtractedFeature[]): Promise<void>;
  getFeatures(aoiId: string, dataset?: string): Promise<ExtractedFeature[]>;

  // Advisory operations
  saveAdvisory(advisory: CattleAdvisoryResult): Promise<void>;
  getLatestAdvisory(aoiId: string): Promise<CattleAdvisoryResult | null>;
}

interface CattleStoreData {
  aois: Record<string, FarmAOI>;
  jobs: Record<string, BackgroundJob>;
  features: Record<string, ExtractedFeature[]>; // aoiId -> features[]
  advisories: Record<string, CattleAdvisoryResult>; // aoiId -> latest advisory
}

export class LocalFileCattleRepository implements ICattleRepository {
  private filePath: string;
  private data: CattleStoreData;
  private isLoaded = false;
  /** Set when the store could not be read, or the last write failed; surfaced through GET /api/v1/config. */
  loadError: string | null = null;
  lastPersistError: string | null = null;

  constructor(filePath = DEFAULT_STORE_FILE) {
    this.filePath = filePath;
    this.data = {
      aois: {},
      jobs: {},
      features: {},
      advisories: {},
    };
  }

  private ensureLoaded(): void {
    if (this.isLoaded) return;

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          aois: parsed.aois || {},
          jobs: parsed.jobs || {},
          features: parsed.features || {},
          advisories: parsed.advisories || {},
        };
        this.migrate();
      } else {
        this.seedInitialData();
        this.persistSync();
      }
    } catch (err) {
      // Never overwrite a store we could not parse: move it aside so the data can be recovered by hand.
      try {
        const aside = `${this.filePath}.corrupt.${Date.now()}`;
        if (fs.existsSync(this.filePath)) fs.renameSync(this.filePath, aside);
        this.loadError = `Store could not be read and was moved to ${aside}: ${String((err as any)?.message || err)}`;
      } catch (moveErr) {
        this.loadError = `Store could not be read and could not be moved aside: ${String((moveErr as any)?.message || moveErr)}`;
      }
      console.error(this.loadError);
      this.seedInitialData();
    }

    this.isLoaded = true;
  }

  private persistSync(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
      this.lastPersistError = null;
    } catch (err) {
      this.lastPersistError = String((err as any)?.message || err);
      console.error('Failed to persist cattle store to disk:', err);
    }
  }

  /** Bring records written by older versions up to the current shape. */
  private migrate(): void {
    for (const job of Object.values(this.data.jobs) as any[]) {
      job.queuedAt ??= job.startedAt ?? new Date(0).toISOString();
      job.missing ??= [];
      job.attempts ??= 1;
      job.maxAttempts ??= 3;
    }
    // Advisories from the earlier schema carried unsupported figures; drop them so they are regenerated.
    for (const [id, adv] of Object.entries(this.data.advisories) as Array<[string, any]>) {
      if (!adv?.derived) delete this.data.advisories[id];
    }
    // The old build seeded a fabricated sample farm; label it instead of presenting it as a real farm.
    const legacy = this.data.aois['aoi_talanda_pasture_01'];
    if (legacy && legacy.demo === undefined) legacy.demo = true;
  }

  private seedInitialData(): void {
    // Demonstration data only when explicitly requested (SEED_DEMO_DATA=true); it is flagged demo:true.
    if (process.env.SEED_DEMO_DATA !== 'true') return;
    try {
      const seedAoi = createFarmAoi({
        aoiId: 'aoi_demo_sample_01',
        farmLabel: 'Demo sample farm (not real data)',
        demo: true,
        source: 'manual_entry',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [88.5810, 24.5150],
              [88.5845, 24.5150],
              [88.5845, 24.5185],
              [88.5810, 24.5185],
              [88.5810, 24.5150],
            ],
          ],
        },
      });
      this.data.aois[seedAoi.aoiId] = seedAoi;
    } catch (e) {
      console.warn('Seed AOI creation failed:', e);
    }
  }

  async getAoi(aoiId: string): Promise<FarmAOI | null> {
    this.ensureLoaded();
    return this.data.aois[aoiId] || null;
  }

  async listAois(): Promise<FarmAOI[]> {
    this.ensureLoaded();
    return Object.values(this.data.aois).sort((a, b) =>
      b.provenance.updatedAt.localeCompare(a.provenance.updatedAt)
    );
  }

  async saveAoi(aoi: FarmAOI): Promise<FarmAOI> {
    this.ensureLoaded();
    this.data.aois[aoi.aoiId] = aoi;
    this.persistSync();
    return aoi;
  }

  async deleteAoi(aoiId: string): Promise<boolean> {
    this.ensureLoaded();
    if (!this.data.aois[aoiId]) return false;
    delete this.data.aois[aoiId];
    delete this.data.features[aoiId];
    delete this.data.advisories[aoiId];
    for (const [jobId, job] of Object.entries(this.data.jobs)) {
      if (job.aoiId === aoiId) delete this.data.jobs[jobId];
    }
    this.persistSync();
    return true;
  }

  async getJob(jobId: string): Promise<BackgroundJob | null> {
    this.ensureLoaded();
    return this.data.jobs[jobId] || null;
  }

  async listJobs(aoiId?: string): Promise<BackgroundJob[]> {
    this.ensureLoaded();
    const all = Object.values(this.data.jobs);
    const list = aoiId ? all.filter(j => j.aoiId === aoiId) : all;
    return list.sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
  }

  async saveJob(job: BackgroundJob): Promise<BackgroundJob> {
    this.ensureLoaded();
    this.data.jobs[job.jobId] = job;
    this.persistSync();
    return job;
  }

  async saveFeatures(aoiId: string, features: ExtractedFeature[]): Promise<void> {
    this.ensureLoaded();
    if (!this.data.features[aoiId]) {
      this.data.features[aoiId] = [];
    }
    // Append or replace features by dataset and band and observationInterval
    for (const f of features) {
      const existingIdx = this.data.features[aoiId].findIndex(
        e => e.dataset === f.dataset && e.band === f.band && e.observationInterval === f.observationInterval
      );
      if (existingIdx >= 0) {
        this.data.features[aoiId][existingIdx] = f;
      } else {
        this.data.features[aoiId].push(f);
      }
    }
    this.persistSync();
  }

  async getFeatures(aoiId: string, dataset?: string): Promise<ExtractedFeature[]> {
    this.ensureLoaded();
    const list = this.data.features[aoiId] || [];
    if (!dataset) return list;
    return list.filter(f => f.dataset === dataset);
  }

  async saveAdvisory(advisory: CattleAdvisoryResult): Promise<void> {
    this.ensureLoaded();
    this.data.advisories[advisory.aoiId] = advisory;
    this.persistSync();
  }

  async getLatestAdvisory(aoiId: string): Promise<CattleAdvisoryResult | null> {
    this.ensureLoaded();
    return this.data.advisories[aoiId] || null;
  }
}

// Global default singleton instance
export const cattleRepository = new LocalFileCattleRepository();
