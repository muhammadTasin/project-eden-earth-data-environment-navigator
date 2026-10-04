"""Upazila and district outlines for the dashboard's map of Bangladesh.

geoBoundaries' simplified outlines (CC BY 4.0, research/acquire/boundaries.py) are thinned once more with
Douglas-Peucker and rounded to 4 decimals (~11 m), so all 544 upazilas load in the browser at once.  Each upazila
carries the engine's id (ADM3_*), its name and its district, so a click on the map picks the same place as the
dashboard's place list.

Input : research/data/boundaries/BGD_ADM3_simplified.geojson, BGD_ADM2_simplified.geojson,
        research/sites/adm3_centroids.csv (shape id -> upazila id), research/sites/upazilas.csv (districts)
Output: apps/saao-dashboard/public/data/bd_upazilas.geojson, bd_districts.geojson
Usage : python research/export/map_export.py
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOUNDS = ROOT / "research" / "data" / "boundaries"
SITES = ROOT / "research" / "sites"
OUT = ROOT / "apps" / "saao-dashboard" / "public" / "data"


def simplify(ring: list, tol: float) -> list:
    """Douglas-Peucker on one closed ring; keeps the first and last point."""
    if len(ring) <= 4:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        a, b = stack.pop()
        (x0, y0), (x1, y1) = ring[a], ring[b]
        dx, dy = x1 - x0, y1 - y0
        norm = (dx * dx + dy * dy) ** 0.5
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            x, y = ring[i]
            # distance to the chord; for the closed ring's first split (both ends the same point), to that point
            d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / norm if norm else ((x - x0) ** 2 + (y - y0) ** 2) ** 0.5
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    out = [p for p, k in zip(ring, keep) if k]
    return out if len(out) >= 4 else ring


def thin(geom: dict, tol: float) -> dict:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    out = []
    for poly in polys:
        rings = []
        for k, ring in enumerate(poly):
            r = [[round(x, 4), round(y, 4)] for x, y in simplify(ring, tol)]
            dedup = [p for i, p in enumerate(r) if i == 0 or p != r[i - 1]]
            if len(dedup) >= 4 or k == 0:
                rings.append(dedup)
        out.append(rings)
    return {"type": "MultiPolygon", "coordinates": out} if len(out) > 1 else {"type": "Polygon", "coordinates": out[0]}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    shape_to_id = {r["shape_id"]: r["site_id"] for r in csv.DictReader(open(SITES / "adm3_centroids.csv", encoding="utf-8"))}
    district = {r["site_id"]: r["district"] for r in csv.DictReader(open(SITES / "upazilas.csv", encoding="utf-8"))}

    up = json.loads((BOUNDS / "BGD_ADM3_simplified.geojson").read_text(encoding="utf-8"))
    feats = []
    for f in up["features"]:
        uid = shape_to_id[f["properties"]["shapeID"]]
        feats.append({"type": "Feature", "id": uid,
                      "properties": {"id": uid, "name": f["properties"]["shapeName"], "district": district.get(uid, "")},
                      "geometry": thin(f["geometry"], 0.003)})
    up_out = OUT / "bd_upazilas.geojson"
    up_out.write_text(json.dumps({"type": "FeatureCollection", "attribution": "geoBoundaries gbOpen (CC BY 4.0)",
                                  "features": feats}, separators=(",", ":")), encoding="utf-8")

    di = json.loads((BOUNDS / "BGD_ADM2_simplified.geojson").read_text(encoding="utf-8"))
    dfeats = [{"type": "Feature", "properties": {"name": f["properties"]["shapeName"]}, "geometry": thin(f["geometry"], 0.005)}
              for f in di["features"]]
    di_out = OUT / "bd_districts.geojson"
    di_out.write_text(json.dumps({"type": "FeatureCollection", "attribution": "geoBoundaries gbOpen (CC BY 4.0)",
                                  "features": dfeats}, separators=(",", ":")), encoding="utf-8")

    def vertices(fc):
        return sum(len(r) for f in fc for poly in ([f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon"
                                                    else f["geometry"]["coordinates"]) for r in poly)
    print(f"{len(feats)} upazilas, {vertices(feats)} points -> {up_out.relative_to(ROOT)} ({up_out.stat().st_size // 1024} kB)")
    print(f"{len(dfeats)} districts, {vertices(dfeats)} points -> {di_out.relative_to(ROOT)} ({di_out.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
