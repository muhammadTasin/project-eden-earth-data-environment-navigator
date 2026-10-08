"""Where this year's Aman is missing or weak, from NASA's 30 m Harmonized Landsat Sentinel-2 (HLS) greenness.

Last year's Aman land is a pixel green in mid-September to early October 2025 (NDVI >= 0.5) and bare after the
harvest, 20 November to 31 December 2025 (<= 0.35): fields, not the trees and orchards that stay green
(research/acquire/hls_winter.py). On that land, this year's greenest clear look in the same weeks (10 September to
8 October 2026) is set against last year's:
  - not green  : NDVI below 0.4 now, the crop lost, not replanted yet, replanted late, or the field left fallow;
  - under water: NDVI below 0.05 now (open water on the field);
  - weaker     : green but at least 0.15 below last year.
Only pixels seen clear in both years count (Fmask cloud, adjacent cloud and shadow bits off, read for this year and for
the bare window; last year's greenest look needs no mask, since a cloud can lower NDVI but never raise it). HLS v2.0 vegetation
indices (HLSS30_VI, HLSL30_VI) are read at the 4x overview grid (120 m); the files have no overviews and are stored a
row at a time, so every look fetches the whole tile, and each tile keeps only its clearest passes. Each window's
composite is cached per tile (research/data/crop_loss/, git-ignored), so a rerun reads only what is new.

Greenness is not yield, and one year is compared with one year: the share is a list of places to check, beside
NASA OPERA's flood water now (services/api/data/live/flood_now.json).
Output: services/api/data/live/crop_loss.json, research/crops/crop_loss_upazila.csv
Needs : EARTHDATA_USERNAME / EARTHDATA_PASSWORD (.env), earthaccess, rasterio
Usage : python research/live/crop_loss.py [--year 2026] [--workers 16] [--tiles T46QBM ...]
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research" / "acquire"))
import earthaccess  # noqa: E402
import pandas as pd  # noqa: E402
from _common import load_dotenv, out_dir, write_provenance  # noqa: E402
from hls_winter import AMAN_GREEN, BARE, cloud, look, search, tile_of  # noqa: E402
from opera_dswx import TileLabels, upazilas  # noqa: E402

NOT_GREEN, WATER, WEAKER = 0.40, 0.05, 0.15
KEEP = {"before": 5, "bare": 4, "now": 6}  # clearest passes per tile and window
MIN_PX = 300  # ~4 km2 of Aman land seen before a share is given
MIN_AMAN_SHARE = 0.05  # and Aman on at least this share of the upazila: below it a few pixels of hill or coast decide
OUT = ROOT / "services" / "api" / "data" / "live" / "crop_loss.json"
CSV = ROOT / "research" / "crops" / "crop_loss_upazila.csv"
SOURCE = ("NASA HLS v2.0 vegetation indices (HLSS30_VI, HLSL30_VI; LP DAAC), NDVI with Fmask, read at 120 m: last "
          "year's Aman land and this year's greenest clear look in the same weeks")


def windows(year: int, end: str) -> dict[str, tuple[str, str]]:
    return {"before": (f"{year - 1}-09-10", f"{year - 1}-{end}"), "bare": (f"{year - 1}-11-20", f"{year - 1}-12-31"),
            "now": (f"{year}-09-10", f"{year}-{end}")}


def composite(tile: str, window: str, dates: tuple[str, str], gs: list, fs, labels: TileLabels, workers: int, cache: Path):
    """The window's composite for one tile (greenest clear look; barest for 'bare') and the tile's labels."""
    path = cache / f"{window}_{dates[0]}_{dates[1]}_{tile}.npz"
    if path.exists():
        z = np.load(path)
        return z["comp"], z["labels"]
    comp, lab = None, None
    with ThreadPoolExecutor(workers) as pool:
        futures = [pool.submit(look, g, fs, labels, window != "before") for g in gs]
        for fut in as_completed(futures):
            try:
                arr, lab_, _ = fut.result()
            except Exception as e:  # a pass that fails is skipped; the composite keeps the others
                print(f"    {tile} {window}: skipped a pass ({type(e).__name__})", flush=True)
                continue
            lab = lab_
            if arr is None:
                continue
            comp = arr if comp is None else (np.fmin if window == "bare" else np.fmax)(comp, arr)
    if comp is None or lab is None:
        return None, lab
    np.savez_compressed(path, comp=comp.astype("float32"), labels=lab)
    return comp, lab


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--end", default=None, help="last day of the comparison window, MM-DD (default: today, at most 10-31)")
    ap.add_argument("--workers", type=int, default=6, help="passes read at once per window")
    ap.add_argument("--tile-workers", type=int, default=4, help="tiles read at once")
    ap.add_argument("--tiles", nargs="*", help="only these MGRS tiles (a test run)")
    args = ap.parse_args()
    end = args.end or min(f"{date.today():%m-%d}", "10-31")
    load_dotenv()
    earthaccess.login(strategy="environment")
    fs = earthaccess.get_fsspec_https_session()
    ups = upazilas()
    labels = TileLabels(ups)
    cache = out_dir("crop_loss", str(args.year))
    wins = windows(args.year, end)
    by_tile: dict[str, dict[str, list]] = defaultdict(lambda: {w: [] for w in wins})
    for w, (start, stop) in wins.items():
        for g in search(start, stop):
            by_tile[tile_of(g)][w].append(g)
    for t in by_tile:
        for w in by_tile[t]:
            by_tile[t][w] = sorted(by_tile[t][w], key=cloud)[:KEEP[w]]
    tiles = sorted(t for t in by_tile if (not args.tiles or t in args.tiles) and all(by_tile[t][w] for w in wins))
    print(f"{args.year} against {args.year - 1}, {wins['now'][0]} to {wins['now'][1]}: {len(tiles)} tiles, "
          f"{sum(len(v) for t in tiles for v in by_tile[t].values())} passes", flush=True)

    n = len(ups) + 1
    keys = ("area", "aman", "seen", "notGreen", "water", "weaker", "changeSum")
    sums = {k: np.zeros(n) for k in keys}
    lock = threading.Lock()

    def do_tile(k: int, tile: str) -> None:
        t0 = time.time()
        with ThreadPoolExecutor(len(wins)) as pool:
            got = {w: pool.submit(composite, tile, w, wins[w], by_tile[tile][w], fs, labels, args.workers, cache) for w in wins}
            comps = {w: f.result() for w, f in got.items()}
        lab = next((l for _, l in comps.values() if l is not None), None)
        if lab is None or not lab.any() or any(c is None for c, _ in comps.values()):
            print(f"  {tile} ({k}/{len(tiles)}): no upazila or no clear look", flush=True)
            return
        before, bare, now = comps["before"][0], comps["bare"][0], comps["now"][0]
        with np.errstate(invalid="ignore"):
            aman = (before >= AMAN_GREEN) & (bare <= BARE)
            seen = aman & ~np.isnan(now)
            not_green = seen & (now < NOT_GREEN)
            water = seen & (now < WATER)
            weaker = seen & (now >= NOT_GREEN) & (now <= before - WEAKER)
            change = np.where(seen, now - before, 0.0)
        flat = lab.ravel()
        count = lambda m: np.bincount(flat, weights=m.ravel().astype(float), minlength=n)  # noqa: E731
        add = {"area": np.bincount(flat, minlength=n), "aman": count(aman), "seen": count(seen), "notGreen": count(not_green),
               "water": count(water), "weaker": count(weaker), "changeSum": count(change)}
        with lock:
            for key, v in add.items():
                sums[key] += v
        print(f"  {tile} ({k}/{len(tiles)}): {int(seen.sum())} Aman pixels seen in both years in {time.time() - t0:.0f} s", flush=True)

    with ThreadPoolExecutor(args.tile_workers) as pool:
        for fut in as_completed([pool.submit(do_tile, k, tile) for k, tile in enumerate(tiles, 1)]):
            try:
                fut.result()
            except Exception as e:  # a tile that fails is read again on the next run
                print(f"  a tile failed: {type(e).__name__} {str(e)[:120]}", flush=True)

    rows = []
    for i, u in enumerate(ups, start=1):
        if sums["area"][i] == 0:
            continue
        seen, aman = sums["seen"][i], sums["aman"][i]
        ok = seen >= MIN_PX and aman >= MIN_AMAN_SHARE * sums["area"][i]
        rows.append({
            "site_id": u["site_id"], "aman_px": int(aman), "seen_px": int(seen),
            "aman_land_share": round(aman / sums["area"][i], 3), "seen_share": round(seen / aman, 3) if aman else None,
            "not_green_share": round(sums["notGreen"][i] / seen, 3) if ok else None,
            "water_share": round(sums["water"][i] / seen, 3) if ok else None,
            "weaker_share": round(sums["weaker"][i] / seen, 3) if ok else None,
            "mean_change": round(sums["changeSum"][i] / seen, 3) if ok else None,
        })
    df = pd.DataFrame(rows)
    CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CSV, index=False)
    write_provenance(CSV, source=SOURCE, windows=wins, tiles=len(tiles))
    given = df.dropna(subset=["not_green_share"])
    out = {
        "source": SOURCE, "made": datetime.now(timezone.utc).isoformat(timespec="seconds"), "year": args.year, "windows": wins,
        "thresholds": {"amanGreen": AMAN_GREEN, "bare": BARE, "notGreen": NOT_GREEN, "water": WATER, "weaker": WEAKER, "minPx": MIN_PX, "minAmanShare": MIN_AMAN_SHARE},
        "summary": {"upazilas": int(len(given)), "notGreenAtLeast10pct": int((given.not_green_share >= 0.1).sum()),
                    "notGreenAtLeast20pct": int((given.not_green_share >= 0.2).sum()), "medianNotGreen": round(float(given.not_green_share.median()), 3),
                    "medianChange": round(float(given.mean_change.median()), 3)},
        "upazilas": {r["site_id"]: {"amanLandShare": r["aman_land_share"], "seenShare": r["seen_share"], "notGreenShare": r["not_green_share"],
                                     "waterShare": r["water_share"], "weakerShare": r["weaker_share"], "meanChange": r["mean_change"]}
                     for r in rows if r["not_green_share"] is not None},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(given)} upazilas with enough Aman land seen; not green on 10%+ of it in "
          f"{out['summary']['notGreenAtLeast10pct']}, 20%+ in {out['summary']['notGreenAtLeast20pct']}", flush=True)


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"done in {time.time() - t0:.0f} s")
