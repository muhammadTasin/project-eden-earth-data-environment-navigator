"""AppEEARS point extraction for the products that need an Earthdata Login (EDL).

Needs EARTHDATA_USERNAME / EARTHDATA_PASSWORD in the environment or in the repo-root .env
(copy .env.example).  Nothing is hard-coded; never commit .env.

Presets (layer names verified against the AppEEARS product API):
  core : SMAP L3 enhanced 9 km daily soil moisture, VIIRS NOAA-20 NDVI (MODIS successor),
         SMAP L4 carbon (soil organic carbon, GPP)                 2015-04-01 -> today
  l4   : SMAP L4 9 km 3-hourly surface + ROOT-ZONE soil moisture and its climatological
         percentile (heavy: 8 steps/day, so default is the last 3 years)
  et   : MODIS ET / PET 500 m 8-day gap-filled (crop water use baseline) 2000 -> today

Usage:
  python research/acquire/appeears_points.py --preset core
  python research/acquire/appeears_points.py --preset l4 --start 2023-01-01
  python research/acquire/appeears_points.py --resume <task_id>     # only download
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, timedelta

from _common import load_dotenv, load_sites, out_dir, session, write_provenance

API = "https://appeears.earthdatacloud.nasa.gov/api"
PRESETS = {
    "core": ("2015-04-01", [
        ("SPL3SMP_E.006", "Soil_Moisture_Retrieval_Data_AM_soil_moisture"),
        ("SPL3SMP_E.006", "Soil_Moisture_Retrieval_Data_AM_retrieval_qual_flag"),
        ("VJ113A1.002", "500_m_16_days_NDVI"),
        ("VJ113A1.002", "500_m_16_days_pixel_reliability"),
        ("SPL4CMDL.008", "SOC_soc_mean"),
        ("SPL4CMDL.008", "GPP_gpp_mean"),
    ]),
    "l4": (str(date.today() - timedelta(days=3 * 365)), [
        ("SPL4SMGP.008", "Geophysical_Data_sm_surface"),
        ("SPL4SMGP.008", "Geophysical_Data_sm_rootzone"),
        ("SPL4SMGP.008", "Geophysical_Data_sm_rootzone_pctl"),
    ]),
    "et": ("2000-01-01", [
        ("MOD16A2GF.061", "ET_500m"),
        ("MOD16A2GF.061", "PET_500m"),
    ]),
    # national coverage for maps (run with --sites adm3_centroids / --sites districts): one pixel at each
    # upazila or district centroid, so a context layer, not a field value
    "ndvi_national": ("2000-02-18", [
        ("MOD13Q1.061", "_250m_16_days_NDVI"),
        ("MOD13Q1.061", "_250m_16_days_pixel_reliability"),
        ("VJ113A1.002", "500_m_16_days_NDVI"),
        ("VJ113A1.002", "500_m_16_days_pixel_reliability"),
    ]),
    "l4_national": (str(date.today() - timedelta(days=365)), [
        ("SPL4SMGP.008", "Geophysical_Data_sm_surface"),
        ("SPL4SMGP.008", "Geophysical_Data_sm_rootzone"),
    ]),
    # today's soil for every upazila (run with --sites upazilas): SMAP L4 root zone with its own percentile against
    # the SMAP L4 climatology (2015 onwards), the last 90 days; read by research/live/smap_now.py
    "smap_national": (str(date.today() - timedelta(days=90)), [
        ("SPL4SMGP.008", "Geophysical_Data_sm_surface"),
        ("SPL4SMGP.008", "Geophysical_Data_sm_rootzone"),
        ("SPL4SMGP.008", "Geophysical_Data_sm_rootzone_pctl"),
    ]),
}


def token(s) -> str:
    load_dotenv()
    user, pw = os.environ.get("EARTHDATA_USERNAME"), os.environ.get("EARTHDATA_PASSWORD")
    if not user or not pw:
        sys.exit("Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD (see .env.example). "
                 "Free account: https://urs.earthdata.nasa.gov/users/new")
    r = s.post(f"{API}/login", auth=(user, pw), timeout=60)
    r.raise_for_status()
    return r.json()["token"]


def submit(s, tok: str, preset: str, sites: list[dict], start: str, end: str) -> str:
    fmt = lambda d: date.fromisoformat(d).strftime("%m-%d-%Y")  # AppEEARS wants MM-DD-YYYY
    task = {"task_type": "point", "task_name": f"fieldshift_{preset}_{date.today():%Y%m%d}", "params": {
        "dates": [{"startDate": fmt(start), "endDate": fmt(end)}],
        "layers": [{"product": p, "layer": l} for p, l in PRESETS[preset][1]],
        "coordinates": [{"id": x["site_id"], "category": x.get("district", ""), "latitude": x["lat"],
                         "longitude": x["lon"]} for x in sites]}}
    r = s.post(f"{API}/task", json=task, headers={"Authorization": f"Bearer {tok}"}, timeout=120)
    r.raise_for_status()
    return r.json()["task_id"]


def wait_and_download(s, tok: str, task_id: str, preset: str) -> None:
    h = {"Authorization": f"Bearer {tok}"}
    fails = 0
    while True:
        try:
            j = s.get(f"{API}/task/{task_id}", headers=h, timeout=60).json()
        except Exception as e:  # network blip: try again next minute
            j = {"message": type(e).__name__}
        st = j.get("status")
        print(time.strftime("%H:%M:%S"), task_id, st or j.get("message", "no status"), flush=True)
        if st == "done":
            break
        if st in ("error", "expired"):
            sys.exit(f"task {task_id} ended with status {st}")
        if st is None:  # token revoked or expired (a logout elsewhere revokes it): log in again
            fails += 1
            if fails > 30:
                sys.exit("AppEEARS keeps refusing the request; check the Earthdata login")
            tok = token(s)
            h = {"Authorization": f"Bearer {tok}"}
        else:
            fails = 0
        time.sleep(60)
    d = out_dir("appeears", preset)
    for f in s.get(f"{API}/bundle/{task_id}", headers=h, timeout=60).json()["files"]:
        path = d / f["file_name"].replace("/", "_")
        with s.get(f"{API}/bundle/{task_id}/{f['file_id']}", headers=h, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(path, "wb") as fh:
                for block in r.iter_content(1 << 20):
                    fh.write(block)
        print("saved", path.name, flush=True)
    write_provenance(d / "bundle", source="NASA AppEEARS point extraction", url=API, task_id=task_id,
                     layers=PRESETS[preset][1])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", choices=PRESETS, default="core")
    ap.add_argument("--sites", default="pilot_sites")
    ap.add_argument("--start")
    ap.add_argument("--end", default=str(date.today() - timedelta(days=3)))
    ap.add_argument("--resume", help="existing task_id: skip submit, just wait + download")
    args = ap.parse_args()
    s = session()
    tok = token(s)
    task_id = args.resume or submit(s, tok, args.preset, load_sites(args.sites),
                                    args.start or PRESETS[args.preset][0], args.end)
    print("task_id", task_id, "(re-run with --resume if you stop this script)", flush=True)
    wait_and_download(s, tok, task_id, args.preset)


if __name__ == "__main__":
    main()
