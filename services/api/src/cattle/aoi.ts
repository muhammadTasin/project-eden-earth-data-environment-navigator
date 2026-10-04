/**
 * AOI Geometry Engine & Validator.
 * Handles GeoJSON Polygon/MultiPolygon validation, Bangladesh bounds check,
 * geodesic area and centroid computation.
 */
import crypto from 'node:crypto';
import type { FarmAOI, AoiGeometry, GeoJsonPolygon, GeoJsonMultiPolygon } from './types.ts';
import { ApiError } from '../errors.ts';
import { nearestLocation } from '../locations.ts';

// Bounding box for Bangladesh landmass (approximate with slight buffer for borderlands/islands)
const BD_BOUNDS = {
  minLat: 20.4,
  maxLat: 26.8,
  minLon: 88.0,
  maxLon: 92.8,
};

export interface CreateAoiInput {
  aoiId?: string;
  farmLabel: string;
  ownerName?: string;
  geometry: unknown;
  source?: 'map_draw' | 'geojson_upload' | 'manual_entry';
  drawnBy?: string;
  uploadedFileName?: string;
  demo?: boolean;
}

export interface GeometryValidationResult {
  valid: boolean;
  error?: string;
  geometry?: AoiGeometry;
  bbox?: [number, number, number, number];
  centroid?: [number, number];
  areaSquareMeters?: number;
}

/**
 * Validates coordinate pair [lon, lat] and bounds inside Bangladesh.
 */
function isValidCoord(coord: unknown): coord is [number, number] {
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lon, lat] = coord;
  if (typeof lon !== 'number' || !Number.isFinite(lon)) return false;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return false;
  return true;
}

/**
 * Calculates planar geodesic-corrected polygon area in square meters.
 */
function calculatePolygonAreaSqMeters(coords: number[][]): number {
  if (coords.length < 3) return 0;

  // Compute centroid latitude in radians for projection scaling
  let sumLat = 0;
  for (const [, lat] of coords) sumLat += lat;
  const meanLatRad = (sumLat / coords.length) * (Math.PI / 180);

  // WGS84 ellipsoidal distance per degree at this latitude
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * meanLatRad) + 1.175 * Math.cos(4 * meanLatRad);
  const mPerDegLon = 111412.84 * Math.cos(meanLatRad) - 93.5 * Math.cos(3 * meanLatRad);

  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1Deg, y1Deg] = coords[i];
    const [x2Deg, y2Deg] = coords[i + 1];

    const x1 = x1Deg * mPerDegLon;
    const y1 = y1Deg * mPerDegLat;
    const x2 = x2Deg * mPerDegLon;
    const y2 = y2Deg * mPerDegLat;

    area += (x1 * y2 - x2 * y1);
  }
  return Math.abs(area) / 2;
}

/**
 * Calculates polygon centroid [lon, lat].
 */
function calculatePolygonCentroid(coords: number[][]): [number, number] {
  let sumLon = 0;
  let sumLat = 0;
  const count = coords.length - 1 > 0 ? coords.length - 1 : coords.length;
  for (let i = 0; i < count; i++) {
    sumLon += coords[i][0];
    sumLat += coords[i][1];
  }
  return [Number((sumLon / count).toFixed(6)), Number((sumLat / count).toFixed(6))];
}

function segmentsIntersect(a: number[], b: number[], c: number[], d: number[]): boolean {
  const orient = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when two non-adjacent edges of the closed ring properly cross. O(n^2), fine for hand-drawn farm outlines. */
function ringSelfIntersects(ring: number[][]): boolean {
  const n = ring.length - 1; // last point repeats the first
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

/**
 * Validates a GeoJSON Polygon or MultiPolygon geometry.
 */
export function validateAoiGeometry(geometry: unknown): GeometryValidationResult {
  if (!geometry || typeof geometry !== 'object') {
    return { valid: false, error: 'Geometry must be a valid GeoJSON object' };
  }

  const geom = geometry as Record<string, any>;
  const type = geom.type;

  if (type !== 'Polygon' && type !== 'MultiPolygon') {
    return { valid: false, error: `Invalid geometry type "${type}". Must be "Polygon" or "MultiPolygon"` };
  }

  if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) {
    return { valid: false, error: 'Geometry coordinates array is missing or empty' };
  }

  let totalArea = 0;
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  const allCentroids: Array<{ centroid: [number, number]; area: number }> = [];

  const polygons: number[][][][] = type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

  for (let pIdx = 0; pIdx < polygons.length; pIdx++) {
    const polygon = polygons[pIdx];
    if (!Array.isArray(polygon) || polygon.length === 0) {
      return { valid: false, error: `Polygon at index ${pIdx} has no linear rings` };
    }

    if (polygon.length > 1) {
      return { valid: false, error: `Polygon ${pIdx} has interior rings (holes), which are not supported; draw separate polygons instead` };
    }
    const exteriorRing = polygon[0];
    if (!Array.isArray(exteriorRing) || exteriorRing.length < 4) {
      return { valid: false, error: `Exterior ring at polygon ${pIdx} must have at least 4 coordinates (triangle + closed point)` };
    }

    // Verify ring closure
    const first = exteriorRing[0];
    const last = exteriorRing[exteriorRing.length - 1];
    if (!isValidCoord(first) || !isValidCoord(last)) {
      return { valid: false, error: 'Coordinate points must be [longitude, latitude] number pairs' };
    }

    const distClose = Math.hypot(first[0] - last[0], first[1] - last[1]);
    if (distClose > 0.0001) {
      return { valid: false, error: 'Polygon ring is not closed: first and last coordinate must match' };
    }

    // Check all vertices
    for (const pt of exteriorRing) {
      if (!isValidCoord(pt)) {
        return { valid: false, error: `Invalid coordinate pair found: ${JSON.stringify(pt)}` };
      }
      const [lon, lat] = pt;

      // Bangladesh boundary check
      if (lat < BD_BOUNDS.minLat || lat > BD_BOUNDS.maxLat || lon < BD_BOUNDS.minLon || lon > BD_BOUNDS.maxLon) {
        return {
          valid: false,
          error: `Coordinate [lon: ${lon.toFixed(4)}, lat: ${lat.toFixed(4)}] is outside Bangladesh bounds (${BD_BOUNDS.minLon}°E–${BD_BOUNDS.maxLon}°E, ${BD_BOUNDS.minLat}°N–${BD_BOUNDS.maxLat}°N)`
        };
      }

      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    if (ringSelfIntersects(exteriorRing)) {
      return { valid: false, error: `Polygon ${pIdx} crosses itself; draw a simple outline without crossing edges` };
    }

    const polyArea = calculatePolygonAreaSqMeters(exteriorRing);
    if (polyArea < 50) {
      return { valid: false, error: `Polygon area is too small (${polyArea.toFixed(1)} m²). Minimum farm area is 50 m²` };
    }
    if (polyArea > 500_000_000) {
      // 50,000 hectares
      return { valid: false, error: `Polygon area is too large (${(polyArea / 10000).toFixed(1)} ha). Maximum allowed area is 50,000 ha` };
    }

    totalArea += polyArea;
    allCentroids.push({
      centroid: calculatePolygonCentroid(exteriorRing),
      area: polyArea,
    });
  }

  // Weighted centroid
  let weightedLon = 0;
  let weightedLat = 0;
  for (const c of allCentroids) {
    weightedLon += c.centroid[0] * c.area;
    weightedLat += c.centroid[1] * c.area;
  }
  const finalCentroid: [number, number] = [
    Number((weightedLon / totalArea).toFixed(6)),
    Number((weightedLat / totalArea).toFixed(6)),
  ];

  return {
    valid: true,
    geometry: geom as AoiGeometry,
    bbox: [Number(minLon.toFixed(6)), Number(minLat.toFixed(6)), Number(maxLon.toFixed(6)), Number(maxLat.toFixed(6))],
    centroid: finalCentroid,
    areaSquareMeters: Math.round(totalArea),
  };
}

/**
 * Nearest reference point from the shared locations dataset. This is an approximation by distance, not a
 * point-in-polygon lookup, so distanceKm is returned and stored with the AOI.
 */
export function findNearestReferenceUpazila(centroid: [number, number]) {
  const { location, distanceKm } = nearestLocation(centroid[1], centroid[0]);
  return {
    nearestUpazila: `${location.upazilaEn} (${location.upazilaBn})`,
    district: `${location.districtEn} (${location.districtBn})`,
    distanceKm,
  };
}

/**
 * Creates and validates a new Farm AOI entity.
 */
export function createFarmAoi(input: CreateAoiInput): FarmAOI {
  const label = String(input.farmLabel || '').trim();
  if (!label) {
    throw new ApiError('invalid_input', 'Farm label or name is required');
  }

  const validation = validateAoiGeometry(input.geometry);
  if (!validation.valid || !validation.geometry || !validation.centroid || !validation.bbox || validation.areaSquareMeters === undefined) {
    throw new ApiError('invalid_input', validation.error || 'Invalid geometry');
  }

  const now = new Date().toISOString();
  const aoiId = input.aoiId || `aoi_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const areaSqM = validation.areaSquareMeters;
  const areaHa = Number((areaSqM / 10000).toFixed(3));
  const areaAc = Number((areaSqM / 4046.8564224).toFixed(3));

  const ref = findNearestReferenceUpazila(validation.centroid);

  return {
    aoiId,
    farmLabel: label,
    ownerName: String(input.ownerName || '').trim(),
    geometry: validation.geometry,
    crs: 'EPSG:4326',
    areaSquareMeters: areaSqM,
    areaHectares: areaHa,
    areaAcres: areaAc,
    centroid: validation.centroid,
    bbox: validation.bbox,
    nearestUpazila: ref.nearestUpazila,
    nearestUpazilaDistanceKm: ref.distanceKm,
    district: ref.district,
    ...(input.demo ? { demo: true } : {}),
    provenance: {
      source: input.source || 'map_draw',
      drawnBy: input.drawnBy,
      uploadedFileName: input.uploadedFileName,
      createdAt: now,
      updatedAt: now,
    },
  };
}
