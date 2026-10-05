"""How much of a full yield each upland crop makes on rain and stored soil water alone, at every district and Tanore.

The water replays (connect_check.py, national_replay.py, crop_choice_replay.py) count a crop's whole water use as the
irrigation it needs, less effective rain and 50 mm of soil water left by Aman: right for planning pumped water, but
it says a lentil crop sown on the soil's own water would fail, while most of Bangladesh's lentil is grown that way.
This adds FAO-56's root-zone soil water balance (Allen et al. 1998, chapter 8) on the same NASA weather:

  * the root zone deepens from 0.2 m at sowing to the crop's depth by the end of development: the deep end of FAO-56
    Table 22's range for the crop on rain alone, the shallow end for scheduling irrigation, as FAO-56 advises;
  * it holds 150 mm of available water per metre (a silt loam, FAO-56 Table 19; the floodplain soils' class), full
    at sowing for a winter crop after the monsoon and half full for a crop sown before the monsoon;
  * every day rain (the replays' rule: 80% of rain above 5 mm) refills it and the crop draws ETc (FAO-56 crop
    coefficients on NASA POWER ET0); below the readily available water (FAO-56 Table 22's depletion fraction p) the
    crop transpires less, Ks = (TAW - Dr) / ((1 - p) TAW);
  * relative yield = 1 - Ky (1 - ETa/ETc), FAO-33's seasonal yield response (crops/fao_ky_seasonal.csv; pulses
    take beans' and peas' 1.15, crops without a value 1.0, both marked as assumed);
  * the irrigation that keeps the crop unstressed refills the root zone whenever depletion passes p (FAO-56's
    management-allowed depletion): a farmer's irrigation need, beside the replays' full-water-use figure.

It leaves out water a shallow water table can feed up to the roots (FAO-56 counts capillary rise only within about
a metre below the root zone), so on low floodplain land it is a lower bound.

Output: packages/rotation-engine/src/data/rainfed_yield.json: per place and crop, one row per sowing date:
        [sowing, typical relative yield, dry-year (one in five) relative yield, typical ETa/ETc, irrigation mm,
         irrigations, day of the first irrigation after sowing]
Usage : python research/explore/rainfed_yield.py   (needs the POWER cache, like crop_choice_replay.py)
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[0] / "export"))
sys.path.insert(0, str(HERE.parents[0] / "acquire"))
import connect_check as cc  # noqa: E402
import crop_choice_replay as ccr  # noqa: E402  (CROPS, plan, kc_of, UPLAND_FRAC, SEASONS)
import national_replay as nr  # noqa: E402  (weather)
from _common import DATA, RESEARCH  # noqa: E402

ROOT = RESEARCH.parent
OUT = ROOT / "packages" / "rotation-engine" / "src" / "data" / "rainfed_yield.json"
AWC_MM_PER_M = 150.0  # silt loam, FAO-56 Table 19 (theta_FC - theta_WP about 0.15 m3/m3)
ZR_START = 0.2
TABLE22 = "FAO-56 Table 22"
# id -> ((root depth range m, FAO-56 Table 22), depletion fraction p, FAO-33 crop for Ky or None)
ROOTS = {
    "lentil": ((0.6, 0.8), 0.50, "Peas"), "chickpea": ((0.6, 1.0), 0.50, "Peas"), "grasspea": ((0.6, 1.0), 0.40, "Peas"),
    "mungbean": ((0.6, 0.9), 0.45, "Beans"), "soybean": ((0.6, 1.3), 0.50, "Soybean"), "mustard": ((1.0, 1.5), 0.60, None),
    "wheat_early": ((1.0, 1.5), 0.55, "Spring wheat"), "wheat_late": ((1.0, 1.5), 0.55, "Spring wheat"),
    "barley": ((1.0, 1.5), 0.55, "Spring wheat"), "maize": ((1.0, 1.7), 0.55, "Maize"), "potato": ((0.4, 0.6), 0.35, "Potato"),
    "sweetpotato": ((1.0, 1.5), 0.65, None), "sunflower": ((0.8, 1.5), 0.45, "Sunflower"),
    "sunflower_kharif": ((0.8, 1.5), 0.45, "Sunflower"), "sesame": ((1.0, 1.5), 0.60, None), "jute": ((1.0, 1.0), 0.50, None),
}
# The research release's winter crops (national_replay.py's definitions): sowing (month, day), days, crop_parameters key
RELEASE = {"lentil": ((11, 10), 112, "Lentil"), "mustard": ((11, 10), 80, "Mustard"),
           "wheat_early": ((11, 20), 105, "Wheat"), "wheat_late": ((12, 10), 105, "Wheat")}


def taw_curve(zr_max: float, n: int, grow_days: int) -> np.ndarray:
    zr = np.minimum(zr_max, ZR_START + (zr_max - ZR_START) * np.arange(1, n + 1) / max(1, grow_days))
    return AWC_MM_PER_M * zr


def balance(et0: np.ndarray, rain: np.ndarray, kc: np.ndarray, zr: tuple, p: float, start_full: float, grow_days: int):
    """FAO-56 root-zone depletion for one season: ETa/ETc on rain alone (deep roots), and the irrigation that keeps the
    crop unstressed (shallow roots, refilled whenever depletion passes p)."""
    n = len(et0)
    taw, tawi = taw_curve(zr[1], n, grow_days), taw_curve(zr[0], n, grow_days)
    eff = np.where(rain > 5, 0.8 * rain, 0.0)
    etc = kc * et0
    dr, dri = (1 - start_full) * taw[0], (1 - start_full) * tawi[0]
    eta = irrigation = 0.0
    events, first = 0, None
    for i in range(n):
        if i:  # deeper roots reach soil as wet as it was at sowing
            dr += (1 - start_full) * (taw[i] - taw[i - 1])
            dri += (1 - start_full) * (tawi[i] - tawi[i - 1])
        dr = max(0.0, dr - eff[i])
        ks = 1.0 if dr <= p * taw[i] else max(0.0, (taw[i] - dr) / ((1 - p) * taw[i]))
        eta += ks * etc[i]
        dr = min(taw[i], dr + ks * etc[i])
        dri = max(0.0, dri - eff[i]) + etc[i]
        if dri > p * tawi[i]:
            irrigation += dri
            events += 1
            first = i + 1 if first is None else first
            dri = 0.0
    return eta / etc.sum(), irrigation, events, first


def main() -> None:
    cp = pd.read_csv(RESEARCH / "crops" / "crop_parameters.csv").set_index("crop")
    fao = pd.read_csv(RESEARCH / "crops" / "fao56_kc.csv")
    ky = pd.read_csv(RESEARCH / "crops" / "fao_ky_seasonal.csv").set_index("crop")
    tech = pd.read_csv(RESEARCH / "crops" / "bari_production_technology.csv").drop_duplicates("crop_en").set_index("crop_en")
    brri = pd.read_csv(RESEARCH / "crops" / "brri_rice_varieties.csv").drop_duplicates("variety").set_index("variety")

    seasons: dict[str, list] = {}  # crop id -> [(sowing reference dates, days, kc tuple, frac, start_full)]
    for cid, (md, n, key) in RELEASE.items():
        kc = tuple(float(x) for x in cp.loc[key, ["kc_ini", "kc_mid", "kc_end"]])
        seasons[cid] = [([pd.Timestamp(2001, *md)], n, kc, (0.15, 0.25, 0.4, 0.2), 1.0)]
    for cid, spec in ccr.CROPS.items():
        if cid not in ROOTS or spec["season"] == "Kharif-2" or "brri" in spec:
            continue
        kc, _ = ccr.kc_of(spec, cp, fao)
        cal = ccr.plan(cid, spec, tech, brri)
        seasons[cid] = [(cal["sow"], cal["days"], kc, ccr.UPLAND_FRAC, 0.5 if spec["season"] == "Kharif-1" else 1.0)]

    crops = {}
    for cid, (zr, p, ky_crop) in ROOTS.items():
        k = float(ky.loc[ky_crop, "ky_max"]) if ky_crop else 1.0
        crops[cid] = {"rootDepthM": list(zr), "depletionFraction": p, "ky": k,
                      "kySource": f"FAO-33 ({ky_crop}{', standing in' if cid in ('lentil', 'chickpea', 'grasspea', 'mungbean', 'barley') else ''})" if ky_crop else "none in FAO-33: 1.0 assumed",
                      "kyAssumed": ky_crop is None or cid in ("lentil", "chickpea", "grasspea", "mungbean", "barley"),
                      "rootSource": TABLE22 if cid != "jute" else "not in FAO-56: 1.0 m assumed",
                      "startFull": seasons[cid][0][4]}

    st = pd.read_csv(RESEARCH / "sites" / "bmd_stations_gsod.csv")
    gsod = DATA / "stations" / "gsod"
    st["path"] = [next(iter(gsod.glob(f"{w}_*.parquet")), None) for w in st["wmo"]]
    st = st.dropna(subset=["path"]).reset_index(drop=True)
    pilot = pd.read_csv(RESEARCH / "sites" / "pilot_sites.csv").set_index("site_id").loc["RAJ_TANORE"]
    places = [("talanda_tanore", "RAJ_TANORE", float(pilot["lat"]), float(pilot["lon"]))]
    for _, s in pd.read_csv(RESEARCH / "sites" / "districts.csv").iterrows():
        places.append((str(s["name"]), s["site_id"], float(s["lat"]), float(s["lon"])))

    out = {}
    for name, site, lat, lon in places:
        if not (DATA / "power" / "daily" / f"{site}.parquet").exists():
            continue
        wx, _ = nr.weather(site, lat, lon, st)
        out[name] = {}
        for cid, [(sows, n, kc, frac, start_full)] in seasons.items():
            zr, p, _ = ROOTS[cid]
            curve = cc.kc_curve(n, kc, frac)
            grow = round(n * (frac[0] + frac[1]))
            rows = []
            for ref in sows:
                ratios, irr, counts, firsts = [], [], [], []
                for y in ccr.SEASONS:
                    sow = pd.Timestamp(y if ref.month >= 7 else y + 1, ref.month, ref.day)
                    days = pd.date_range(sow, periods=n)
                    if days[-1] > wx.index.max():
                        continue
                    et0 = wx.loc[days, "et0"].to_numpy()
                    rain = wx.loc[days, "rain"].to_numpy()
                    if np.isnan(et0).any() or np.isnan(rain).any():
                        continue
                    r, i, e, f = balance(et0, rain, curve, zr, p, start_full, grow)
                    ratios.append(r)
                    irr.append(i)
                    counts.append(e)
                    if f is not None:
                        firsts.append(f)
                if not ratios:
                    continue
                k = crops[cid]["ky"]
                yields = np.clip(1 - k * (1 - np.array(ratios)), 0, 1)
                rows.append([ref.strftime("%m-%d"), round(float(np.median(yields)), 2), round(float(np.quantile(yields, 0.2)), 2),
                             round(float(np.median(ratios)), 2), int(round(float(np.median(irr)))),
                             int(round(float(np.median(counts)))), int(round(float(np.median(firsts)))) if firsts else None])
            out[name][cid] = rows
        lent = out[name].get("lentil", [[None, None, None, None, None]])[0]
        print(f"{name:<16} lentil rainfed {lent[1]} (dry year {lent[2]}), irrigation {lent[4]} mm in {lent[5]}, first day {lent[6]}; "
              f"potato {out[name]['potato'][0][1]}; wheat {out[name]['wheat_early'][0][1]}", flush=True)

    OUT.write_text(json.dumps({"generatedOn": f"{date.today()}", "seasons": "2001-02 to 2024-25", "method": __doc__.split("\n\n")[1].strip(),
                               "columns": ["sowing", "relativeYieldTypical", "relativeYieldDryYear", "etaOverEtc", "irrigationToAvoidStressMm",
                                           "irrigations", "firstIrrigationDay"],
                               "awcMmPerM": AWC_MM_PER_M, "crops": crops, "places": out},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(crops)} crops x {len(out)} places")


if __name__ == "__main__":
    main()
