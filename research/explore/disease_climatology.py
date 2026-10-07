"""How many days of rice-blast and potato-late-blight weather each place gets in a typical season, 2001-2025.

For the pilot (Tanore) and each district's NASA POWER point, every day from the 2001 Aman to the 2026 Boro is marked
with the rules in research/live/disease_weather.py, and the marked days are counted in each susceptible window:
blast in Aman (15 Sep-15 Nov) and in Boro (1 Feb-15 Apr), late blight in the potato season (15 Nov-28 Feb). The
median of the 25 seasons, and the 20th and 80th percentiles, go to the engine's pest score.

Input : research/data/power/daily/*.parquet (research/acquire/power.py)
Output: packages/rotation-engine/src/data/disease_weather.json
Usage : python research/explore/disease_climatology.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research" / "live"))
from disease_weather import RULES, flags, in_window  # noqa: E402

POWER = ROOT / "research" / "data" / "power" / "daily"
OUT = ROOT / "packages" / "rotation-engine" / "src" / "data" / "disease_weather.json"
SEASONS = range(2001, 2026)  # Aman of 2001 ... Aman of 2025; Boro and the potato winter run into the next year


def place_counts(path: Path) -> dict:
    d = pd.read_parquet(path, columns=["T2M_MAX", "T2M_MIN", "T2MDEW"]).loc["2001-08-01":"2026-05-31"]
    days = [{"tmin": None if pd.isna(r.T2M_MIN) else r.T2M_MIN, "tmax": None if pd.isna(r.T2M_MAX) else r.T2M_MAX,
             "tdew": None if pd.isna(r.T2MDEW) else r.T2MDEW} for r in d.itertuples()]
    f = flags(days)
    marks = pd.DataFrame({"blast": f["riceBlast"], "late": f["lateBlight"]}, index=d.index)
    mmdd = marks.index.strftime("%m-%d")
    out = {"blastAman": [], "blastBoro": [], "lateBlight": []}
    for y in SEASONS:
        span = (marks.index >= f"{y}-08-01") & (marks.index <= f"{y + 1}-05-31")
        m, md, yr = marks[span], mmdd[span], marks.index[span].year
        aman = np.array([in_window(x, RULES["riceBlast"]["windows"]["aman"]) for x in md]) & (yr == y)
        boro = np.array([in_window(x, RULES["riceBlast"]["windows"]["boro"]) for x in md]) & (yr == y + 1)
        potato = np.array([in_window(x, RULES["lateBlight"]["windows"]["potato"]) for x in md])
        out["blastAman"].append(int(m.blast[aman].sum()))
        out["blastBoro"].append(int(m.blast[boro].sum()))
        out["lateBlight"].append(int(m.late[potato].sum()))
    return {k: {"median": float(np.median(v)), "p20": float(np.percentile(v, 20)), "p80": float(np.percentile(v, 80))} for k, v in out.items()}


def main() -> None:
    places = {"talanda_tanore": "RAJ_TANORE"}
    for _, s in pd.read_csv(ROOT / "research" / "sites" / "districts.csv").iterrows():
        places[str(s["name"])] = s["site_id"]
    res = {}
    for name, site in places.items():
        path = POWER / f"{site}.parquet"
        if path.exists():
            res[name] = place_counts(path)
    OUT.write_text(json.dumps({
        "method": ("Days of disease weather in each susceptible window, NASA POWER daily, seasons 2001-2025 "
                   "(research/explore/disease_climatology.py with the rules in research/live/disease_weather.py)"),
        "rules": {k: {kk: v[kk] for kk in ("nameEn", "nameBn", "windows", "basis")} for k, v in RULES.items()},
        "places": res,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    df = pd.DataFrame({k: {c: v[c]["median"] for c in v} for k, v in res.items()}).T
    print(f"{OUT.relative_to(ROOT)}: {len(res)} places")
    print(df.describe().round(1))
    print(df.loc[[p for p in ["talanda_tanore", "Rajshahi", "Dhaka", "Munshiganj", "Bogra", "Rangpur", "Sylhet", "Khulna", "Cox's Bazar"] if p in df.index]])


if __name__ == "__main__":
    main()
