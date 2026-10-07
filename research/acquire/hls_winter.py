"""How much of each upazila's Aman land grew a winter crop, from NASA's 30 m Harmonized Landsat Sentinel-2 (HLS).

HLS v2.0 vegetation indices (HLSS30_VI from Sentinel-2, HLSL30_VI from Landsat 8/9; LP DAAC) give NDVI for every
clear look at 30 m, with the Fmask cloud mask beside it. For each winter, three windows are composited per MGRS tile
from the 4x overviews (120 m pixels), clear looks only (Fmask cloud, adjacent cloud and shadow bits off):
  Aman      15 Sep - 31 Oct  greenest look   (Aman rice at full canopy)
  bare      20 Nov - 31 Dec  barest look     (the field after the Aman harvest)
  winter     5 Jan - 10 Mar  greenest look   (lentil, mustard, wheat, maize, potato, Boro)
Aman land is a pixel green in the Aman window (NDVI >= 0.5) and bare after it (<= 0.35): fields, not the forest,
orchards or homestead trees that stay green. Its winter-crop share is the part green again in winter (>= 0.45).
Monsoon-flooded land (NDVI < 0.05 in the Aman window, water) green in winter is Boro on the haor and beel land.
Relay pulses sown into standing Aman never look bare, so they are missed: the share is a lower bound.

HLS files have no overviews and are stored a row at a time, so every read fetches the whole tile. To keep a winter to
about an hour, each tile uses the clearest passes only (CMR cloud cover): five for the Aman and winter windows and
four for the bare window, and the Fmask is read only for the bare window, since a cloud can lower NDVI but never
raise it, so it cannot spoil a greenest-look composite.

Output: research/crops/hls_winter_upazila.csv (site_id, winter, aman_px, aman_green_px, winter_crop_share, flood_px,
        flood_green_px, flood_winter_share, aman_land_share), research/data/hls_winter/tiles.jsonl (per-tile cache)
Needs : EARTHDATA_USERNAME / EARTHDATA_PASSWORD (.env), earthaccess, rasterio
Usage : python research/acquire/hls_winter.py [--winters 2025-26 2024-25] [--workers 16] [--tiles T46QBM ...]
"""
from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta

import earthaccess
import numpy as np
import pandas as pd
import rasterio

from _common import RESEARCH, load_dotenv, out_dir, write_provenance
from opera_dswx import TileLabels, overlaps, upazilas

PRODUCTS = ["HLSS30_VI", "HLSL30_VI"]
BBOX = (88.0, 20.5, 92.7, 26.7)
DECIMATION = 4
MAX_CLOUD = 80  # percent of the tile; cloudier passes are not opened
AMAN_GREEN, BARE, WINTER_GREEN, WATER = 0.5, 0.35, 0.45, 0.05
MIN_PX = 50  # ~0.7 km2 at 120 m before a share is given
KEEP = {"aman": 5, "bare": 4, "winter": 5}  # clearest passes per tile and window
OUT = RESEARCH / "crops" / "hls_winter_upazila.csv"


def windows(winter: str) -> dict:
    y = int(winter[:4])
    return {"aman": (f"{y}-09-15", f"{y}-10-31"), "bare": (f"{y}-11-20", f"{y}-12-31"), "winter": (f"{y + 1}-01-05", f"{y + 1}-03-10")}


def cloud(g) -> float:
    for a in g["umm"].get("AdditionalAttributes", []):
        if a.get("Name") == "CLOUD_COVERAGE":
            try:
                return float(a["Values"][0])
            except (ValueError, KeyError, IndexError):
                return 0.0
    return 0.0


def search(start: str, end: str) -> list:
    found = []
    for product in PRODUCTS:
        found += earthaccess.search_data(short_name=product, bounding_box=BBOX, temporal=(start, end), count=-1)
    return [g for g in found if cloud(g) <= MAX_CLOUD]


def tile_of(g) -> str:
    return g["umm"]["GranuleUR"].split(".")[2]  # HLS-VI.S30.T46QBM.2026010T043049.v2.0


def look(g, fs, labels: TileLabels, masked: bool):
    """One NDVI look at the tile's 120 m grid (NaN where no data, and where cloudy when `masked`), and the labels."""
    links = g.data_links()
    ndvi_href = next(u for u in links if u.endswith(".NDVI.tif"))
    fmask_href = next(u for u in links if u.endswith(".Fmask.tif"))
    with rasterio.open(ndvi_href, opener=fs.open) as src:
        shape = (src.height // DECIMATION, src.width // DECIMATION)
        lab, n = labels.get(tile_of(g), src, shape)
        if not lab.any():
            return None, lab, n
        raw = src.read(1, out_shape=shape).astype("float32")
        nodata, scale, offset = src.nodata, src.scales[0] or 1.0, src.offsets[0] or 0.0
    ndvi = raw * scale + offset
    if scale == 1.0 and np.nanmax(np.abs(raw[raw != nodata])) > 2:  # stored as NDVI x 10000 without a scale tag
        ndvi = raw / 10000.0
    clear = (raw != nodata) & (ndvi >= -1) & (ndvi <= 1)
    if masked:
        with rasterio.open(fmask_href, opener=fs.open) as src:
            fm = src.read(1, out_shape=shape)
        clear &= (fm != 255) & ((fm & 0b1110) == 0)
    return np.where(clear, ndvi, np.nan).astype("float32"), lab, n


def run_tile(tile: str, by_window: dict, fs, labels: TileLabels, ups: list, workers: int) -> list[dict]:
    comp = {"aman": None, "bare": None, "winter": None}
    lab, n = None, None
    with ThreadPoolExecutor(workers) as pool:
        futures = {pool.submit(look, g, fs, labels, w == "bare"): w for w, gs in by_window.items() for g in gs}
        for fut in as_completed(futures):
            w = futures[fut]
            try:
                arr, lab_, n_ = fut.result()
            except Exception as e:  # a pass that fails to read is skipped; the composite still has the others
                print(f"    {tile} {w}: skipped a pass ({type(e).__name__})", flush=True)
                continue
            lab, n = lab_, n_
            if arr is None:
                continue
            if comp[w] is None:
                comp[w] = arr
            else:
                comp[w] = (np.fmin if w == "bare" else np.fmax)(comp[w], arr)
    if lab is None or not lab.any() or any(v is None for v in comp.values()):
        return []
    with np.errstate(invalid="ignore"):
        aman_land = (comp["aman"] >= AMAN_GREEN) & (comp["bare"] <= BARE)
        flood_land = comp["aman"] < WATER
        seen = ~np.isnan(comp["winter"])
        green = comp["winter"] >= WINTER_GREEN
    count = lambda mask: np.bincount(lab.ravel(), weights=mask.ravel(), minlength=n)  # noqa: E731
    a, ag, f, fg = count(aman_land & seen), count(aman_land & green), count(flood_land & seen), count(flood_land & green)
    area, aman_seen = np.bincount(lab.ravel(), minlength=n), count(~np.isnan(comp["aman"]))
    return [{"tile": tile, "site_id": ups[i - 1]["site_id"], "aman_px": int(a[i]), "aman_green_px": int(ag[i]),
             "flood_px": int(f[i]), "flood_green_px": int(fg[i]), "area_px": int(area[i]), "aman_seen_px": int(aman_seen[i])}
            for i in np.nonzero(area)[0] if i > 0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--winters", nargs="+", default=["2025-26", "2024-25"])
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--tiles", nargs="*", help="only these MGRS tiles (a test run)")
    args = ap.parse_args()
    load_dotenv()
    for attempt in range(5):
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
    labels = TileLabels(ups)
    cache = out_dir("hls_winter") / "tiles.jsonl"
    done = set()
    if cache.exists():
        for line in cache.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            done.add((r["winter"], r["tile"]))
    for winter in args.winters:
        by_tile: dict[str, dict] = defaultdict(lambda: {"aman": [], "bare": [], "winter": []})
        for w, (start, end) in windows(winter).items():
            for g in search(start, end):
                by_tile[tile_of(g)][w].append(g)
        for t in by_tile:
            for w in by_tile[t]:
                by_tile[t][w] = sorted(by_tile[t][w], key=cloud)[:KEEP[w]]
        tiles = sorted(t for t in by_tile if (not args.tiles or t in args.tiles))
        print(f"{winter}: {len(tiles)} tiles, {sum(len(v) for t in tiles for v in by_tile[t].values())} clear-enough passes", flush=True)
        with open(cache, "a", encoding="utf-8") as out:
            for k, tile in enumerate(tiles, 1):
                if (winter, tile) in done:
                    continue
                t0 = time.time()
                rows = run_tile(tile, by_tile[tile], fs, labels, ups, args.workers)
                for r in rows or [{"tile": tile, "site_id": None}]:
                    out.write(json.dumps({"winter": winter, **r}) + "\n")
                out.flush()
                print(f"  {winter} {tile} ({k}/{len(tiles)}): {len(rows)} upazila rows in {time.time() - t0:.0f} s", flush=True)

    rows = [json.loads(l) for l in cache.read_text(encoding="utf-8").splitlines()]
    df = pd.DataFrame([r for r in rows if r.get("site_id")])
    agg = df.groupby(["site_id", "winter"])[["aman_px", "aman_green_px", "flood_px", "flood_green_px", "area_px", "aman_seen_px"]].sum().reset_index()
    agg["winter_crop_share"] = (agg.aman_green_px / agg.aman_px).where(agg.aman_px >= MIN_PX).round(3)
    agg["flood_winter_share"] = (agg.flood_green_px / agg.flood_px).where(agg.flood_px >= MIN_PX).round(3)
    agg["aman_land_share"] = (agg.aman_px / agg.area_px).round(3)
    agg.sort_values(["site_id", "winter"]).to_csv(OUT, index=False)
    write_provenance(OUT, source="NASA HLS v2.0 vegetation indices (HLSS30_VI, HLSL30_VI; LP DAAC), NDVI and Fmask at the 4x overview (120 m)",
                     collection=",".join(PRODUCTS), period=", ".join(args.winters), tiles=int(df.tile.nunique()))
    print(f"wrote {OUT.relative_to(RESEARCH.parent)}: {agg.site_id.nunique()} upazilas, winters {sorted(agg.winter.unique())}", flush=True)


if __name__ == "__main__":
    main()
