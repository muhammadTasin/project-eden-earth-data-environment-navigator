"""NASA OPERA DSWx-S1 surface water over Bangladesh: the share of every upazila under open water on every pass.

OPERA's Dynamic Surface Water Extent from Sentinel-1 (JPL, distributed by PO.DAAC; 30 m on the MGRS grid, a pass
every 6-12 days since September 2024) maps water from radar, which sees through the monsoon cloud that hid NASA's
MODIS flood map (~98% cloud over Bangladesh in August). For each granule over Bangladesh the binary water layer
(BWTR: 0 dry, 1 water, 250-255 masked or no data) is read from its 4x overview (120 m), so a season costs a few
hundred megabytes, and the water and valid pixels inside each upazila are counted. The counts are cached per
granule, so a stopped run resumes where it left off.

Output: research/floods/opera_dswx_upazila.csv (site_id, date, tiles, water_px, valid_px, water_share)
        research/data/opera_dswx/counts.jsonl (per granule and upazila, git-ignored cache)
Needs : EARTHDATA_USERNAME / EARTHDATA_PASSWORD (.env), the earthaccess package
Usage : python research/acquire/opera_dswx.py [--start 2024-09-01] [--end 2026-01-31] [--workers 8]
"""
from __future__ import annotations

import argparse
import json
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

import earthaccess
import numpy as np
import pandas as pd
import rasterio
from rasterio import features
from rasterio.warp import transform_bounds, transform_geom

from _common import DATA, RESEARCH, SITES, load_dotenv, out_dir, write_provenance

SHORT_NAME = "OPERA_L3_DSWX-S1_V1"
BBOX = (88.0, 20.5, 92.7, 26.7)  # west, south, east, north
DECIMATION = 4  # read the 4x overview: 120 m pixels
OUT = RESEARCH / "floods" / "opera_dswx_upazila.csv"


def upazilas() -> list[dict]:
    """Upazila outlines (geoBoundaries ADM3, simplified) with the engine's site ids and lon/lat bounds."""
    sid = pd.read_csv(SITES / "adm3_centroids.csv").set_index("shape_id")["site_id"].to_dict()
    feats = json.loads((DATA / "boundaries" / "BGD_ADM3_simplified.geojson").read_text(encoding="utf-8"))["features"]
    out = []
    for f in feats:
        coords = np.array([xy for ring in (f["geometry"]["coordinates"] if f["geometry"]["type"] == "Polygon"
                                           else [r for poly in f["geometry"]["coordinates"] for r in poly]) for xy in ring])
        out.append({"site_id": sid[f["properties"]["shapeID"]], "geometry": f["geometry"],
                    "bounds": (coords[:, 0].min(), coords[:, 1].min(), coords[:, 0].max(), coords[:, 1].max())})
    return out


def granules(start: str, end: str) -> list:
    """Every DSWx-S1 granule over the box, searched a month at a time."""
    found, d0 = [], date.fromisoformat(start)
    stop = date.fromisoformat(end)
    while d0 <= stop:
        d1 = min(stop, (d0.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1))
        found += earthaccess.search_data(short_name=SHORT_NAME, bounding_box=BBOX, temporal=(str(d0), str(d1)), count=-1)
        d0 = d1 + timedelta(days=1)
    return found


def overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


class TileLabels:
    """Upazila labels rasterised once per MGRS tile on its overview grid (every pass of a tile shares the grid)."""

    def __init__(self, ups: list[dict]):
        self.ups = ups
        self.cache: dict[str, tuple] = {}
        self.lock = threading.Lock()

    def get(self, tile: str, src, shape) -> tuple:
        with self.lock:
            if tile in self.cache:
                return self.cache[tile]
        transform = src.transform * src.transform.scale(src.width / shape[1], src.height / shape[0])
        lonlat = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
        inside = [(i, u) for i, u in enumerate(self.ups) if overlaps(u["bounds"], lonlat)]
        shapes = [(transform_geom("EPSG:4326", src.crs, u["geometry"]), i + 1) for i, u in inside]
        labels = features.rasterize(shapes, out_shape=shape, transform=transform, fill=0, dtype="int32") if shapes \
            else np.zeros(shape, "int32")
        with self.lock:
            self.cache[tile] = (labels, len(self.ups) + 1)
        return self.cache[tile]

    def empty(self, tile: str) -> bool:
        """A tile already known to hold no upazila: its other passes need not be opened."""
        with self.lock:
            return tile in self.cache and not self.cache[tile][0].any()


def count(g, fs, labels: TileLabels, ups: list[dict]) -> list[dict]:
    """Water and valid pixels per upazila for one granule (empty when the tile misses Bangladesh)."""
    ur = g["umm"]["GranuleUR"]
    tile = ur.split("_")[3]  # 'T46RDP'
    day = ur.split("_")[4][:8]  # acquisition start, YYYYMMDD
    if labels.empty(tile):
        return []
    href = next(l for l in g.data_links() if l.endswith("_BWTR.tif"))
    with rasterio.open(href, opener=fs.open) as src:
        shape = (src.height // DECIMATION, src.width // DECIMATION)
        lab, n = labels.get(tile, src, shape)
        if not lab.any():
            return []
        a = src.read(1, out_shape=shape)
    water = np.bincount(lab.ravel(), weights=(a == 1).ravel(), minlength=n)
    valid = np.bincount(lab.ravel(), weights=(a <= 1).ravel(), minlength=n)
    area = np.bincount(lab.ravel(), minlength=n)
    return [{"granule": ur, "tile": tile, "date": f"{day[:4]}-{day[4:6]}-{day[6:]}", "site_id": ups[i - 1]["site_id"],
             "water_px": int(water[i]), "valid_px": int(valid[i]), "area_px": int(area[i])}
            for i in np.nonzero(area)[0] if i > 0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2024-09-01")
    ap.add_argument("--end", default=str(date.today() - timedelta(days=3)))
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    load_dotenv()
    for attempt in range(5):  # a DNS or network blip at login should not end a long run
        try:
            earthaccess.login(strategy="environment")
            fs = earthaccess.get_fsspec_https_session()
            break
        except Exception as e:
            print("login failed, retrying:", type(e).__name__, flush=True)
            time.sleep(30 * (attempt + 1))
    else:
        raise SystemExit("Earthdata login failed five times")
    ups = upazilas()
    bd = (min(u["bounds"][0] for u in ups), min(u["bounds"][1] for u in ups), max(u["bounds"][2] for u in ups),
          max(u["bounds"][3] for u in ups))
    cache = out_dir("opera_dswx") / "counts.jsonl"
    done = set()
    if cache.exists():
        for line in cache.read_text(encoding="utf-8").splitlines():
            done.add(json.loads(line)["granule"])
    found = granules(args.start, args.end)
    todo = []
    for g in found:
        rects = g["umm"]["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"].get("BoundingRectangles") or []
        polys = g["umm"]["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"].get("GPolygons") or []
        boxes = [(r["WestBoundingCoordinate"], r["SouthBoundingCoordinate"], r["EastBoundingCoordinate"], r["NorthBoundingCoordinate"])
                 for r in rects]
        for p in polys:
            pts = p["Boundary"]["Points"]
            boxes.append((min(q["Longitude"] for q in pts), min(q["Latitude"] for q in pts),
                          max(q["Longitude"] for q in pts), max(q["Latitude"] for q in pts)))
        if g["umm"]["GranuleUR"] not in done and any(overlaps(b, bd) for b in boxes):
            todo.append(g)
    print(f"{len(found)} granules in the box, {len(done)} already counted, {len(todo)} to read", flush=True)
    labels = TileLabels(ups)
    lock = threading.Lock()
    with ThreadPoolExecutor(args.workers) as pool, open(cache, "a", encoding="utf-8") as out:
        futures = {pool.submit(count, g, fs, labels, ups): g for g in todo}
        for k, fut in enumerate(as_completed(futures), 1):
            g = futures[fut]
            try:
                rows = fut.result()
            except Exception as e:  # a granule that fails is retried on the next run
                print("  skipped", g["umm"]["GranuleUR"], type(e).__name__, str(e)[:120], flush=True)
                continue
            with lock:
                for r in rows or [{"granule": g["umm"]["GranuleUR"], "site_id": None}]:
                    out.write(json.dumps(r) + "\n")
                out.flush()
            if k % 50 == 0:
                print(f"  {k}/{len(todo)} granules", flush=True)

    rows = [json.loads(l) for l in cache.read_text(encoding="utf-8").splitlines()]
    df = pd.DataFrame([r for r in rows if r.get("site_id")])
    agg = df.groupby(["site_id", "date"]).agg(tiles=("tile", "nunique"), water_px=("water_px", "sum"),
                                               valid_px=("valid_px", "sum"), area_px=("area_px", "sum")).reset_index()
    agg["water_share"] = (agg.water_px / agg.valid_px.where(agg.valid_px > 0)).round(4)
    agg["valid_share"] = (agg.valid_px / agg.area_px).round(3)
    agg.sort_values(["site_id", "date"]).to_csv(OUT, index=False)
    write_provenance(OUT, source="NASA/JPL OPERA DSWx-S1 v1 (PO.DAAC), binary water layer at its 4x overview (120 m)",
                     collection=SHORT_NAME, period=f"{args.start} to {args.end}", granules=len(set(df.granule)))
    print(f"wrote {OUT.relative_to(RESEARCH.parent)}: {agg.site_id.nunique()} upazilas, {agg.date.nunique()} pass dates", flush=True)


if __name__ == "__main__":
    main()
