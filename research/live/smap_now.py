"""Today's NASA SMAP root-zone soil moisture for every upazila, read straight from the newest SMAP L4 file.

SMAP Level-4 Global 3-hourly 9 km Surface and Root Zone Soil Moisture (SPL4SMGP, version 8, NSIDC) assimilates the
SMAP radiometer into a land model and ships, for every 9 km cell, the root-zone soil moisture and its percentile
against the model's own climatology (sm_rootzone_pctl). Instead of queueing an AppEEARS request (the national one sat
"processing" for more than four hours), this reads only Bangladesh's rows and columns of the newest granule over
HTTPS (a few megabytes), and takes the cell under each upazila's centroid.

The same cut-offs as the NASA POWER reading in daily_update.py: at or below the 20th percentile is "dry", at or
above the 80th is "wet". The API prefers this reading over POWER's while it is less than a week old.

Output: services/api/data/live/smap_upazila.json
Needs : EARTHDATA_USERNAME / EARTHDATA_PASSWORD (.env), earthaccess, h5py, pyproj
Usage : python research/live/smap_now.py [--days 7]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research" / "acquire"))
from _common import load_dotenv  # noqa: E402

OUT = ROOT / "services" / "api" / "data" / "live" / "smap_upazila.json"
SITES = ROOT / "research" / "sites" / "adm3_centroids.csv"
LAYERS = {"rootzonePctl": "sm_rootzone_pctl", "rootzone": "sm_rootzone", "surface": "sm_surface"}
FILL = -9999.0


def status(pctl: float | None) -> str:
    if pctl is None:
        return "unknown"
    return "dry" if pctl <= 20 else "wet" if pctl >= 80 else "normal"


def newest_granule(days: int):
    import earthaccess
    end = date.today()
    found = earthaccess.search_data(short_name="SPL4SMGP", version="008", temporal=(str(end - timedelta(days=days)), str(end)),
                                    bounding_box=(88.0, 20.5, 92.7, 26.7))
    if not found:
        raise SystemExit(f"no SPL4SMGP granule in the last {days} days")

    def begins(g):
        return g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
    g = max(found, key=begins)
    url = next(u for u in g.data_links(access="external") if u.endswith(".h5"))
    return url, begins(g)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()
    load_dotenv()
    import earthaccess
    import h5py
    from pyproj import Transformer

    for attempt in range(5):  # a DNS blip at login should not end the run
        try:
            earthaccess.login(strategy="environment")
            break
        except Exception as err:  # noqa: BLE001
            if attempt == 4:
                raise
            print("login failed, retrying:", type(err).__name__)
            time.sleep(10)

    url, begins = newest_granule(args.days)
    sites = list(csv.DictReader(open(SITES, encoding="utf-8-sig")))
    to_ease = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)
    xs, ys = to_ease.transform([float(s["lon"]) for s in sites], [float(s["lat"]) for s in sites])

    fs = earthaccess.get_fsspec_https_session()
    with fs.open(url, "rb", block_size=4 * 2**20) as fh, h5py.File(fh, "r") as h:
        gx, gy = h["x"][:], h["y"][:]  # EASE-Grid 2.0 cell centres, metres; y runs north to south
        cols = np.abs(gx[None, :] - np.asarray(xs)[:, None]).argmin(axis=1)
        rows = np.abs(gy[None, :] - np.asarray(ys)[:, None]).argmin(axis=1)
        r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
        grids = {k: h["Geophysical_Data"][v][r0:r1, c0:c1].astype(float) for k, v in LAYERS.items()}

    def at(grid, r, c):
        v = grid[r - r0, c - c0]
        if v > FILL + 1:
            return float(v)
        win = grid[max(r - r0 - 1, 0):r - r0 + 2, max(c - c0 - 1, 0):c - c0 + 2]  # coast or water: the land cells around it
        ok = win[win > FILL + 1]
        return float(ok.mean()) if ok.size else None

    when = datetime.fromisoformat(begins.replace("Z", "+00:00"))
    records = []
    for s, r, c in zip(sites, rows, cols):
        vals = {k: at(g, r, c) for k, g in grids.items()}
        pctl = None if vals["rootzonePctl"] is None else round(vals["rootzonePctl"], 1)
        records.append({"id": s["site_id"], "rootzonePctl": pctl,
                        "rootzone": None if vals["rootzone"] is None else round(vals["rootzone"], 3),
                        "surface": None if vals["surface"] is None else round(vals["surface"], 3),
                        "status": status(pctl)})
    counts = {k: sum(r["status"] == k for r in records) for k in ("dry", "normal", "wet", "unknown")}
    OUT.write_text(json.dumps({
        "source": "NASA SMAP L4 (SPL4SMGP v8, 9 km): root-zone soil moisture and its percentile against the model climatology",
        "granule": url.rsplit("/", 1)[-1], "validTime": when.strftime("%Y-%m-%dT%H:%MZ"), "date": when.date().isoformat(),
        "made": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "cutoffs": "dry at or below the 20th percentile, wet at or above the 80th",
        "summary": counts, "upazilas": records,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(records)} upazilas at {when:%Y-%m-%d %H:%M}Z; {counts}")


if __name__ == "__main__":
    main()
