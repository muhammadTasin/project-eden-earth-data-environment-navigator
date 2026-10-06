"""When the monsoon water leaves each upazila, from NASA OPERA's radar water maps.

Input : research/floods/opera_dswx_upazila.csv (research/acquire/opera_dswx.py): for every Sentinel-1 pass over an
        upazila, the share of its valid land under open water (DSWx-S1, 30 m, read at 120 m).
Method: passes with at least half the upazila seen; each upazila's series smoothed with a running median of three
        passes. Dry-season water = the median share in February-March 2025 (rivers, ponds, beels, shrimp ghers).
        Monsoon peak = the highest smoothed share from July to October 2025. The water that comes and goes each year
        is the peak minus the dry-season share. Where it is at least 3% of the upazila, the dates after the peak by
        which 80% and 90% of it had drained (two passes in a row below the line) stand for when low land and very
        low land are free to plough. One season (2025), so a guide to the usual date rather than a climatology.
Output: research/floods/opera_water_upazila.csv
Usage : python research/explore/opera_water.py
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "research" / "floods" / "opera_dswx_upazila.csv"
OUT = ROOT / "research" / "floods" / "opera_water_upazila.csv"
MIN_EXTRA = 0.03


def drained_by(series: pd.Series, peak_at, dry: float, peak: float, share: float):
    """First pass after the peak from which the water stays below dry + (1 - share) x (peak - dry) for two passes."""
    line = dry + (1 - share) * (peak - dry)
    after = series[series.index > peak_at]
    below = (after <= line).astype(int)
    two = below & below.shift(-1, fill_value=1)  # the last pass counts on its own
    hit = two[two == 1]
    return hit.index[0] if len(hit) else None


def main() -> None:
    d = pd.read_csv(SRC, parse_dates=["date"])
    d = d[d.valid_share >= 0.5].sort_values(["site_id", "date"])
    rows = []
    for sid, g in d.groupby("site_id"):
        s = g.set_index("date").water_share
        smooth = s.rolling(3, center=True, min_periods=1).median()
        dry_part = s[(s.index >= "2025-02-01") & (s.index <= "2025-03-31")]
        monsoon = smooth[(smooth.index >= "2025-07-01") & (smooth.index <= "2025-10-31")]
        if dry_part.empty or monsoon.empty:
            continue
        dry, peak, peak_at = float(dry_part.median()), float(monsoon.max()), monsoon.idxmax()
        extra = peak - dry
        season = smooth[smooth.index >= "2025-07-01"]
        r80 = drained_by(season, peak_at, dry, peak, 0.8) if extra >= MIN_EXTRA else None
        r90 = drained_by(season, peak_at, dry, peak, 0.9) if extra >= MIN_EXTRA else None
        rows.append({
            "site_id": sid, "passes": int(len(s)), "dry_share": round(dry, 3), "peak_share": round(peak, 3),
            "peak_date": peak_at.date().isoformat(), "extra_share": round(extra, 3),
            "drained80": r80.date().isoformat() if r80 is not None else "",
            "drained90": r90.date().isoformat() if r90 is not None else "",
            "still_wet_jan31": bool(extra >= MIN_EXTRA and r90 is None),
        })
    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)
    seasonal = out[out.extra_share >= MIN_EXTRA]
    print(f"{OUT.relative_to(ROOT)}: {len(out)} upazilas, {len(seasonal)} with seasonal water >= {MIN_EXTRA:.0%}")
    dates = pd.to_datetime(seasonal.drained80[seasonal.drained80 != ""]).sort_values()
    print("80% drained by (quartiles):", [str(dates.quantile(q).date()) for q in (0, .25, .5, .75, 1)], f"; never by 31 Jan: {int(seasonal.still_wet_jan31.sum())}")
    for k in ["ADM3_Khaliajuri", "ADM3_Itna", "ADM3_Tahirpur", "ADM3_Tanore", "ADM3_FaridpurSadar", "ADM3_Shyamnagar", "ADM3_Chauhali"]:
        r = out[out.site_id == k]
        print(k, r.iloc[0].to_dict() if len(r) else "missing")


if __name__ == "__main__":
    main()
