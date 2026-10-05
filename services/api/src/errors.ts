/**
 * Shared API error type. Every /api/* error response uses the envelope
 * `{ error: { code, message, details? }, status }` (see docs/api-contract.md).
 */
export type ApiErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'provider_unavailable'
  | 'configuration_required'
  | 'no_data'
  | 'unauthorized'
  | 'forbidden'
  | 'internal';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  provider_unavailable: 502,
  configuration_required: 503,
  no_data: 404,
  unauthorized: 401,
  forbidden: 403,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function errorBody(err: ApiError) {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
    status: err.status,
  };
}

/** Source labelling attached to every data payload so clients never have to guess what they are showing. */
export type SourceKind = 'observed' | 'model_estimate' | 'satellite_delayed' | 'derived' | 'heuristic';

export interface SourceInfo {
  provider: string;
  kind: SourceKind;
  /** True only for data fetched from the provider during this cache window and describing "now". Never true for NASA POWER/SMAP. */
  live: boolean;
  fetchedAt: string;
  /** Latest time the data actually describes (ISO date or datetime), when known. */
  validAt: string | null;
  note: string;
}

/** Bangladesh bounding box used to reject coordinates that cannot be a Bangladesh location. */
export const BD_BOUNDS = { minLat: 20.4, maxLat: 26.8, minLon: 88.0, maxLon: 92.8 };

export function parseCoordinates(latRaw: string | null, lonRaw: string | null, opts: { bangladeshOnly?: boolean } = {}) {
  if (latRaw === null || lonRaw === null || latRaw.trim() === '' || lonRaw.trim() === '') {
    throw new ApiError('invalid_input', 'lat and lon query parameters are required');
  }
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new ApiError('invalid_input', 'Invalid latitude or longitude');
  }
  if (opts.bangladeshOnly !== false
    && (lat < BD_BOUNDS.minLat || lat > BD_BOUNDS.maxLat || lon < BD_BOUNDS.minLon || lon > BD_BOUNDS.maxLon)) {
    throw new ApiError('invalid_input', 'Coordinates are outside Bangladesh', BD_BOUNDS);
  }
  return { lat, lon };
}
