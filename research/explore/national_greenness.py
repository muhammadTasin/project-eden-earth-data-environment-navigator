"""How many crops a year each upazila's land grows, and how green its winter is, from NASA MODIS (MOD13Q1 250 m NDVI).

The AppEEARS request fieldshift_ndvi_national_20260927 (acquire/appeears_points.py --preset ndvi_national --sites
upazilas) gives one 250 m pixel at each of the 544 upazila centroids, every 16 days from February 2000. Using the
pilots' method (field_cycles.py, first_look.py):
  crop cycles per year: growth peaks of the 8-day, Savitzky-Golay-smoothed NDVI (height 0.35, prominence 0.08, at
                        least 48 days apart), agricultural year November-October
  winter peak:          the highest NDVI from 15 January to 15 March, after the Aman harvest; 0.50 or more means
                        winter crops (or Boro) cover the land around the point
Only good or marginal pixels count (pixel reliability 0 or 1). One pixel mixes fields, so this describes the landscape
around the upazila's centre, not a farm; it is context beside the replay, not an input to the scores.

Output: research/pilots/greenness_upazila.csv, packages/rotation-engine/src/data/greenness_upazila.json
Usage : python research/explore/national_greenness.py   (after downloading the AppEEARS bundle)
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import signal

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0] / "acquire"))
from _common import DATA, RESEARCH  # noqa: E402

SRC = DATA / "appeears" / "ndvi_national" / "fieldshift-ndvi-national-20260927-MOD13Q1-061-results.csv"
OUT_JSON = RESEARCH.parent / "packages" / "rotation-engine" / "src" / "data" / "greenness_upazila.json"
WINTER_CROP_NDVI = 0.50
EARLY, RECENT = range(2001, 2006), range(2021, 2026)


def cycles_per_year(nd: pd.Series) -> pd.Series:
    """Growth peaks per agricultural year (Nov-Oct), as first_look.crop_cycles."""
    s = nd.resample("8D").mean().interpolate(limit=4)
    sm = pd.Series(signal.savgol_filter(s.bfill().ffill().values, 7, 2), index=s.index)
    peaks, _ = signal.find_peaks(sm.values, prominence=0.08, height=0.35, distance=6)
    pk = sm.index[peaks]
    agyear = pk.year + (pk.month >= 11)
    return pd.Series(1, index=agyear).groupby(level=0).sum().reindex(range(2001, 2026), fill_value=0)


def main() -> None:
    cols = ["ID", "Date", "MOD13Q1_061__250m_16_days_NDVI", "MOD13Q1_061__250m_16_days_pixel_reliability"]
    d = pd.read_csv(SRC, usecols=cols)
    d.columns = ["id", "date", "ndvi", "rel"]
    d = d[d["rel"].isin([0, 1])].copy()
    d["date"] = pd.to_datetime(d["date"])

    rows, out = [], {}
    for uid, g in d.groupby("id"):
        nd = g.set_index("date")["ndvi"].sort_index()
        nd = nd[~nd.index.duplicated()]
        if len(nd) < 300:
            continue
        cyc = cycles_per_year(nd)
        winter = {y: nd.loc[f"{y + 1}-01-15":f"{y + 1}-03-15"].max() for y in range(2001, 2026)}
        winter = pd.Series(winter, dtype=float)
        row = {
            "site_id": uid,
            "cycles_2001_05": round(float(cyc.loc[EARLY.start:EARLY.stop - 1].mean()), 2),
            "cycles_2021_25": round(float(cyc.loc[RECENT.start:RECENT.stop - 1].mean()), 2),
            "winter_peak_2001_05": round(float(winter.loc[EARLY.start:EARLY.stop - 1].mean()), 2),
            "winter_peak_2021_25": round(float(winter.loc[RECENT.start:RECENT.stop - 1].mean()), 2),
            "winter_crop_share_2021_25": round(float((winter.loc[RECENT.start:RECENT.stop - 1] >= WINTER_CROP_NDVI).mean()), 2),
            "good_composites": int(len(nd)),
        }
        rows.append(row)
        out[uid] = {
            "product": "MODIS MOD13Q1 NDVI, 250 m (one pixel at the upazila centre)",
            "early": {"years": "2001-02 to 2005-06", "peakNdvi": row["winter_peak_2001_05"], "cyclesPerYear": row["cycles_2001_05"]},
            "recent": {"years": "2021-22 to 2025-26", "peakNdvi": row["winter_peak_2021_25"], "cyclesPerYear": row["cycles_2021_25"]},
            "winterCropShareRecent": row["winter_crop_share_2021_25"],
        }
    t = pd.DataFrame(rows)
    t.to_csv(RESEARCH / "pilots" / "greenness_upazila.csv", index=False)
    OUT_JSON.write_text(json.dumps({"generatedOn": f"{date.today()}", "source": "NASA MODIS MOD13Q1 v061 via AppEEARS "
                                    "(request fieldshift_ndvi_national_20260927)", "method": __doc__.split("\n\n")[1].strip(),
                                    "upazilas": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(t)} upazilas; crops a year 2001-05 {t['cycles_2001_05'].mean():.2f} -> 2021-25 {t['cycles_2021_25'].mean():.2f}; "
          f"winter peak NDVI {t['winter_peak_2001_05'].mean():.2f} -> {t['winter_peak_2021_25'].mean():.2f}")
    print("Tanore:", t[t["site_id"] == "ADM3_Tanore"].to_dict("records"))
    top = t.sort_values("cycles_2021_25", ascending=False).head(5)[["site_id", "cycles_2021_25", "winter_peak_2021_25"]]
    low = t.sort_values("winter_peak_2021_25").head(5)[["site_id", "cycles_2021_25", "winter_peak_2021_25"]]
    print("most crops a year:\n", top.to_string(index=False), "\ngreyest winters:\n", low.to_string(index=False))


if __name__ == "__main__":
    main()
