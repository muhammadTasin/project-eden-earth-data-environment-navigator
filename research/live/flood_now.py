"""Land under flood water now, from NASA OPERA's optical water maps (DSWx-HLS), for every upazila.

OPERA's radar water maps (DSWx-S1, research/acquire/opera_dswx.py) over Bangladesh stop on 16 July 2026, so the
monsoon is read from DSWx-HLS: Landsat 8/9 and Sentinel-2 at 30 m, binary water layer B02_BWTR (0 dry, 1 water,
252 snow, 253 cloud or cloud shadow, 255 no data), read at its 4x overview (120 m). Cloud hides much of the monsoon;
from late September most passes are clear.
  - Lasting water: December 2025 (after Aman, before Boro) and February 2026 (Boro transplanting), passes under 20%
    cloud. A pixel is lasting water when it was water in at least half of its clear looks in both months: rivers,
    ponds, beels and shrimp ghers, but not Boro paddies, which stand in water in February and are dry in December.
  - Now: each pixel's latest clear look in the last 24 days (passes under 90% cloud).
  - Flood: water now on a pixel that is not lasting water, as a share of the pixels seen clear now and in both
    months. In the monsoon
    this is the water that comes and goes each year as well as an unusual flood, so each upazila also carries the
    same weeks of 2025 from OPERA's radar (research/floods/opera_dswx_upazila.csv: water share above the February-March
    2025 share, median of the passes within 12 days of the date a year earlier). Radar also sees water under rice and
    grass that optical maps miss, so last year's figure tends to read higher.
Granule overviews and each tile's upazila labels are cached (research/data/opera_hls_water/, git-ignored), so a daily
run reads only new passes.

Output: services/api/data/live/flood_now.json
Needs : EARTHDATA_USERNAME / EARTHDATA_PASSWORD (.env), earthaccess, rasterio
Usage : python research/live/flood_now.py [--days 24] [--baseline 2026-02-01 2026-02-28] [--baseline2 2025-12-01 2025-12-31] [--workers 8]
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research" / "acquire"))
import earthaccess  # noqa: E402
import rasterio  # noqa: E402
from _common import load_dotenv, out_dir  # noqa: E402
from opera_dswx import BBOX, TileLabels, upazilas  # noqa: E402

SHORT_NAME = "OPERA_L3_DSWX-HLS_V1"
DECIMATION = 4  # 120 m
BASE_CLOUD, NOW_CLOUD = 20, 90  # granule cloud cover (%) allowed for the dry-season baseline and for now
MIN_SEEN = 0.2  # the share of an upazila seen clear in both before a flood share is given
OUT = ROOT / "services" / "api" / "data" / "live" / "flood_now.json"
RADAR_2025 = ROOT / "research" / "floods" / "opera_dswx_upazila.csv"
RADAR_DRY = ROOT / "research" / "floods" / "opera_water_upazila.csv"
SOURCE = ("NASA/JPL OPERA DSWx-HLS v1 (LP DAAC): Landsat 8/9 and Sentinel-2 surface water at 30 m, binary layer read "
          "at 120 m; flood = water now on land that is not lasting water (water in both December 2025 and February 2026)")


def cloud_of(g) -> float | None:
    for a in g["umm"].get("AdditionalAttributes", []):
        if a.get("Name") == "CloudCoverage":
            try:
                return float(a["Values"][0])
            except (KeyError, ValueError, IndexError):
                return None
    return None


def search(start: date, end: date, max_cloud: float) -> list:
    found = earthaccess.search_data(short_name=SHORT_NAME, bounding_box=BBOX, temporal=(str(start), str(end)), count=-1)
    return [g for g in found if (c := cloud_of(g)) is None or c <= max_cloud]


def tile_day(g) -> tuple[str, str]:
    ur = g["umm"]["GranuleUR"]
    return ur.split("_")[3], ur.split("_")[4][:8]


class Reader:
    """Reads a granule's water overview once, keeping it and its tile's upazila labels on disk."""

    def __init__(self, fs, ups):
        self.fs, self.ups = fs, ups
        self.dir = out_dir("opera_hls_water")
        (self.dir / "g").mkdir(exist_ok=True)
        self.labels = TileLabels(ups)
        self.lock = threading.Lock()

    def labels_of(self, tile: str):
        path = self.dir / f"labels_{tile}.npz"
        return np.load(path)["labels"] if path.exists() else None

    def read(self, g) -> tuple[str, str, np.ndarray] | None:
        tile, day = tile_day(g)
        path = self.dir / "g" / f"{g['umm']['GranuleUR']}.npz"
        if path.exists() and (self.dir / f"labels_{tile}.npz").exists():
            return tile, day, np.load(path)["a"]
        href = next((l for l in g.data_links() if l.endswith("_B02_BWTR.tif")), None)
        if not href:
            return None
        with rasterio.open(href, opener=self.fs.open) as src:
            shape = (src.height // DECIMATION, src.width // DECIMATION)
            lab, _ = self.labels.get(tile, src, shape)
            a = src.read(1, out_shape=shape)
        lpath = self.dir / f"labels_{tile}.npz"
        with self.lock:
            if not lpath.exists():
                np.savez_compressed(lpath, labels=lab)
        np.savez_compressed(path, a=a)
        return tile, day, a


def read_all(reader: Reader, gs: list, workers: int, what: str) -> dict[str, list[tuple[str, np.ndarray]]]:
    """{tile: [(YYYYMMDD, overview), ...]} for the granules, oldest first."""
    by_tile: dict[str, list] = defaultdict(list)
    with ThreadPoolExecutor(workers) as pool:
        futures = {pool.submit(reader.read, g): g for g in gs}
        for k, fut in enumerate(as_completed(futures), 1):
            try:
                got = fut.result()
            except Exception as e:  # a pass that fails is read again on the next run
                print(f"  skipped {futures[fut]['umm']['GranuleUR']}: {type(e).__name__} {str(e)[:100]}", flush=True)
                continue
            if got:
                by_tile[got[0]].append((got[1], got[2]))
            if k % 100 == 0:
                print(f"  {what}: {k}/{len(gs)} passes", flush=True)
    return {t: sorted(v, key=lambda x: x[0]) for t, v in by_tile.items()}


def last_year(on: date) -> dict[str, float]:
    """Each upazila's 2025 radar water above its dry-season share, around the same date a year earlier."""
    import pandas as pd
    if not RADAR_2025.exists() or not RADAR_DRY.exists():
        return {}
    s = pd.read_csv(RADAR_2025, parse_dates=["date"])
    s = s[s.valid_share >= 0.5]
    dry = pd.read_csv(RADAR_DRY).set_index("site_id")["dry_share"]
    then = pd.Timestamp(on.replace(year=on.year - 1)).to_datetime64()
    near = s[(s.date - then).abs() <= pd.Timedelta(days=12)]
    med = near.groupby("site_id").water_share.median()
    return {k: round(max(0.0, float(v - dry[k])), 3) for k, v in med.items() if k in dry}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--days", type=int, default=24)
    ap.add_argument("--baseline", nargs=2, default=["2026-02-01", "2026-02-28"])
    ap.add_argument("--baseline2", nargs=2, default=["2025-12-01", "2025-12-31"])
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    load_dotenv()
    earthaccess.login(strategy="environment")
    fs = earthaccess.get_fsspec_https_session()
    ups = upazilas()
    reader = Reader(fs, ups)
    today = date.today()
    start = today - timedelta(days=args.days)

    base_gs = search(date.fromisoformat(args.baseline[0]), date.fromisoformat(args.baseline[1]), BASE_CLOUD)
    base2_gs = search(date.fromisoformat(args.baseline2[0]), date.fromisoformat(args.baseline2[1]), BASE_CLOUD)
    now_gs = search(start, today, NOW_CLOUD)
    print(f"DSWx-HLS: {len(base_gs)} February passes, {len(base2_gs)} December passes (cloud <= {BASE_CLOUD}%), "
          f"{len(now_gs)} passes since {start} (cloud <= {NOW_CLOUD}%)", flush=True)
    base = read_all(reader, base_gs, args.workers, "February")
    base2 = read_all(reader, base2_gs, args.workers, "December")
    now = read_all(reader, now_gs, args.workers, "now")

    n = len(ups) + 1
    sums = {k: np.zeros(n) for k in ("area", "seen", "flood", "nowClear", "nowWater", "dryClear", "dryWater", "dateSum")}
    epoch = date(1970, 1, 1)
    for tile in sorted(set(base) | set(now)):
        lab = reader.labels_of(tile)
        if lab is None or not lab.any() or tile not in now:
            continue
        shape = lab.shape
        def lasting(passes):
            water = np.zeros(shape, np.uint16)
            clear = np.zeros(shape, np.uint16)
            for _, a in passes:
                if a.shape != shape:
                    continue
                water += a == 1
                clear += a <= 1
            return clear > 0, (clear > 0) & (2 * water >= clear)
        feb_clear, feb_water = lasting(base.get(tile, []))
        dec_clear, dec_water = lasting(base2.get(tile, []))
        dry_clear = feb_clear & dec_clear
        dry_water = dry_clear & feb_water & dec_water
        latest = np.full(shape, 255, np.uint8)
        latest_day = np.zeros(shape, np.int32)
        for day, a in now[tile]:
            if a.shape != shape:
                continue
            ok = a <= 1
            latest[ok] = a[ok]
            latest_day[ok] = (date(int(day[:4]), int(day[4:6]), int(day[6:])) - epoch).days
        now_clear = latest <= 1
        now_water = latest == 1
        seen = now_clear & dry_clear
        flood = seen & now_water & ~dry_water
        flat = lab.ravel()
        count = lambda m: np.bincount(flat, weights=m.ravel().astype(float), minlength=n)  # noqa: E731
        sums["area"] += np.bincount(flat, minlength=n)
        sums["seen"] += count(seen)
        sums["flood"] += count(flood)
        sums["nowClear"] += count(now_clear)
        sums["nowWater"] += count(now_water)
        sums["dryClear"] += count(dry_clear)
        sums["dryWater"] += count(dry_water)
        sums["dateSum"] += np.bincount(flat, weights=np.where(now_clear, latest_day, 0).ravel().astype(float), minlength=n)

    before = last_year(today)
    rows = {}
    for i, u in enumerate(ups, start=1):
        area = sums["area"][i]
        if area == 0:
            continue
        seen = sums["seen"][i]
        rows[u["site_id"]] = {
            "date": f"{epoch + timedelta(days=round(sums['dateSum'][i] / sums['nowClear'][i]))}" if sums["nowClear"][i] else None,
            "seenShare": round(seen / area, 3),
            "floodShare": round(sums["flood"][i] / seen, 3) if seen >= MIN_SEEN * area else None,
            "waterNow": round(sums["nowWater"][i] / sums["nowClear"][i], 3) if sums["nowClear"][i] else None,
            "waterDry": round(sums["dryWater"][i] / sums["dryClear"][i], 3) if sums["dryClear"][i] else None,
            "lastYearRadar": before.get(u["site_id"]),
        }
    given = [r["floodShare"] for r in rows.values() if r["floodShare"] is not None]
    out = {
        "source": SOURCE,
        "made": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window": [f"{start}", f"{today}"],
        "baseline": [args.baseline2, args.baseline],
        "passes": {"now": len(now_gs), "february": len(base_gs), "december": len(base2_gs)},
        "minSeenShare": MIN_SEEN,
        "summary": {"upazilas": len(rows), "withFloodShare": len(given),
                    "floodAtLeast10pct": sum(1 for v in given if v >= 0.10), "floodAtLeast25pct": sum(1 for v in given if v >= 0.25)},
        "upazilas": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} upazilas, {len(given)} seen enough; flood >= 10% in "
          f"{out['summary']['floodAtLeast10pct']}, >= 25% in {out['summary']['floodAtLeast25pct']}", flush=True)


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"done in {time.time() - t0:.0f} s")
