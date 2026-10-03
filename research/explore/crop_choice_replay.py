"""Water, timing and heat for the crops a farmer may ask for, at every district and the Talanda pilot.

The engine's five fixed rotations (Aman, then lentil, mustard, wheat or Boro) come from connect_check.py (Tanore) and
national_replay.py (every district). A farmer may want another crop: sunflower, potato, maize, chickpea, mungbean
before the next Aman, or no rice at all (soybean, mungbean or sesame in the monsoon, or jute). This script replays each
of them with the same chain, at the same NASA points:
  NASA POWER weather, Tmax/Tmin corrected by month against the nearest BMD station -> FAO-56 Penman-Monteith ET0;
  GPM IMERG Final rain (via POWER); FAO-56 crop coefficients by stage; sowing windows and durations from the BARI
  handbook (crops/bari_production_technology.csv), BRRI factsheets and crops/crop_parameters.csv.
Each crop is sown on every 10th day of its window (and on the window's last day), so the engine can start it when the
field is actually free. For each sowing date, over the seasons 2001-2025:
  upland crops: net irrigation = crop water use - effective rain (80% of daily rain above 5 mm) - soil water left by
                the crop before (50 mm after Aman or in the monsoon, none after a winter crop), as in connect_check.py;
  Aus rice:     a daily bunded-paddy balance (2 mm/day seepage, 100 mm bunds) that irrigates back to 50 mm whenever
                the field dries, plus 150 mm to puddle it;
  heat:         days above the crop's limit in its sensitive stage. Rice 35 C and wheat 30 C come from
                crops/crop_parameters.csv; the other limits are literature values and are marked as assumed;
  heavy rain:   days with 50 mm of rain or more while the crop is in the field (IMERG), the waterlogging risk for
                upland crops in the monsoon.
Fertilizer: the SRDI Talanda card, the engine's stand-in everywhere until each upazila's card is added; barley and
soybean, which the card does not list, use the BARI handbook doses. Jute has no FAO-56 crop coefficient; it uses
fibre-crop values marked as assumed.

Output: packages/rotation-engine/src/data/crop_choice_replay.json
Usage : python research/explore/crop_choice_replay.py   (needs the POWER cache from research/acquire)
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
import connect_check as cc  # noqa: E402  (kc_curve, window, mid, SEEPAGE, BUND, START_WATER)
import eden_release as er  # noqa: E402  (nfc)
import national_replay as nr  # noqa: E402  (weather)
from _common import DATA, RESEARCH  # noqa: E402

ROOT = RESEARCH.parent
OUT = ROOT / "packages" / "rotation-engine" / "src" / "data" / "crop_choice_replay.json"
SEASONS = range(2001, 2025)  # monsoon 2001-2024, Rabi 2001-02 to 2024-25, Kharif-1 2002 to 2025
UPLAND_FRAC = (0.15, 0.25, 0.4, 0.2)  # FAO-56 stage shares used for every upland crop in connect_check.py
HANDBOOK = "BARI Krishi Projukti Hatboi (crops/bari_production_technology.csv)"

# id -> how to replay it. window: handbook crop name (first window listed) or explicit text with its source.
# heat: (stage, stage in Bangla, limit C, share of the season where the stage falls, source)
CROPS: dict[str, dict] = {
    "potato": dict(season="Rabi", label="Potato (BARI Potato-25)", handbook="potato", days=93,
                   days_source="crops/crop_parameters.csv: BARI Potato-25, 90-95 days", kc=("cp", "Potato"),
                   heat=("tuber bulking", "আলু বড় হওয়ার সময়", 30, (0.6, 1.0),
                         "tuber growth slows above about 30 C (Struik 2007); assumed"),
                   srdi=("Rabi", "আলু")),
    "maize": dict(season="Rabi", label="Maize (BARI Hybrid Maize-13)", window="15 Oct-25 Dec",
                  window_source="BBS crop calendar (crops/crop_parameters.csv)", days=143,
                  days_source="BWMRI variety page: BARI Hybrid Maize-13, 140-145 days", kc=("cp", "Maize"),
                  heat=("silking", "মোচা আসার সময়", 35, (0.55, 0.7),
                        "pollen viability falls above about 35 C (Herrero and Johnson 1980); assumed"),
                  srdi=("Rabi", "ভূট্টা (বারি হাইব্রিড")),
    "sunflower": dict(season="Rabi", label="Sunflower (BARI Sunflower-2)", handbook="sunflower", days=100,
                      days_source="BARI handbook: 90-110 days", kc=("fao", "Sunflower"),
                      heat=("flowering", "ফুল আসার সময়", 35, (0.5, 0.7), "general flowering limit; assumed"),
                      srdi=("Rabi", "সূর্যমুখী")),
    "sunflower_kharif": dict(season="Kharif-1", label="Sunflower, summer (BARI Sunflower-2)", handbook="sunflower",
                             handbook_window=1, days=100, days_source="BARI handbook: 90-110 days",
                             kc=("fao", "Sunflower"),
                             heat=("flowering", "ফুল আসার সময়", 35, (0.5, 0.7), "general flowering limit; assumed"),
                             srdi=("Rabi", "সূর্যমুখী")),
    "chickpea": dict(season="Rabi", label="Chickpea (BARI Chickpea-10)", handbook="chickpea", days=110,
                     days_source="BARI handbook: sown 15 Nov-7 Dec, harvested 8-22 Mar", kc=("fao", "Chick pea"),
                     heat=("flowering", "ফুল আসার সময়", 35, (0.45, 0.7),
                           "pods fail above about 35 C at flowering (Devasirvatham et al. 2012); assumed"),
                     srdi=("Rabi", "ছোলা")),
    "grasspea": dict(season="Rabi", label="Grass pea (BARI Grasspea-3)", handbook="grass pea", days=122,
                     days_source="BARI handbook: 114-130 days", kc=("cp", "Grass pea (khesari)"), heat=None,
                     srdi=("Rabi", "খেসারী"), relay_days=15),
    "sweetpotato": dict(season="Rabi", label="Sweet potato (BARI Sweet potato-12)", handbook="sweet potato", days=130,
                        days_source="BARI handbook: 120-140 days", kc=("fao", "Sweet Potato"), heat=None,
                        srdi=("Rabi", "মিষ্টি আলু")),
    "barley": dict(season="Rabi", label="Barley (BARI Barley-7)", handbook="barley", days=112,
                   days_source="BARI handbook: sown 8 Nov-14 Dec, harvested 15-21 Mar", kc=("fao", "Barley"),
                   heat=("grain filling", "দানা পুষ্ট হওয়ার সময়", 30, (0.73, 1.0), "wheat's limit, assumed for barley"),
                   handbook_dose="barley"),
    "soybean": dict(season="Rabi", label="Soybean (BARI Soybean-6)", handbook="soybean", days=105,
                    days_source="BARI handbook: 90-120 days", kc=("fao", "Soybeans"),
                    heat=("flowering", "ফুল আসার সময়", 35, (0.4, 0.6), "general flowering limit; assumed"),
                    handbook_dose="soybean"),
    "mungbean": dict(season="Kharif-1", label="Mungbean (BARI Mungbean-6)", handbook="mung bean", days=60,
                     days_source="crops/crop_parameters.csv: BARI Mungbean-6, 58-62 days", kc=("cp", "Mungbean"),
                     heat=("flowering", "ফুল আসার সময়", 40, (0.45, 0.75), "summer pulse flowering limit; assumed"),
                     srdi=("Rabi", "মুগ")),
    "sesame": dict(season="Kharif-1", label="Sesame (BARI Sesame-4)", handbook="sesame", days=88,
                   days_source="BARI handbook: 85-90 days", kc=("fao", "Sesame"),
                   heat=("flowering", "ফুল আসার সময়", 40, (0.4, 0.65), "summer oilseed flowering limit; assumed"),
                   srdi=("Kharif-1", "তিল")),
    "jute": dict(season="Kharif-1", label="Jute (BJRI Tossa Pat-4)", window="15 Apr-5 May",
                 window_source="BBS crop calendar (crops/crop_parameters.csv): mid-April to early May", days=120,
                 days_source="BBS crop calendar: harvested in August", kc=("assumed", (0.5, 1.1, 0.8)),
                 kc_source="no FAO-56 value for jute; fibre-crop values, assumed", heat=None,
                 srdi=("Kharif-1", "পাট")),
    "soybean_k2": dict(season="Kharif-2", label="Soybean, monsoon (BARI Soybean-6)", handbook="soybean",
                       handbook_window=1, days=105, days_source="BARI handbook: 90-120 days", kc=("fao", "Soybeans"),
                       heat=("flowering", "ফুল আসার সময়", 35, (0.4, 0.6), "general flowering limit; assumed"),
                       handbook_dose="soybean"),
    "mungbean_k2": dict(season="Kharif-2", label="Mungbean, monsoon (BARI Mungbean-6)", handbook="mung bean",
                        handbook_window=1, days=60, days_source="crops/crop_parameters.csv: BARI Mungbean-6, 58-62 days",
                        kc=("cp", "Mungbean"),
                        heat=("flowering", "ফুল আসার সময়", 40, (0.45, 0.75), "summer pulse flowering limit; assumed"),
                        srdi=("Rabi", "মুগ")),
    "sesame_k2": dict(season="Kharif-2", label="Sesame, monsoon (BARI Sesame-4)", handbook="sesame", handbook_window=1,
                      days=88, days_source="BARI handbook: 85-90 days", kc=("fao", "Sesame"),
                      heat=("flowering", "ফুল আসার সময়", 40, (0.4, 0.65), "summer oilseed flowering limit; assumed"),
                      srdi=("Kharif-1", "তিল")),
    "aus": dict(season="Kharif-1", label="Aus rice (BRRI dhan48)", brri="BRRI dhan48", kc=("cp", "Aus rice"),
                heat=("flowering", "ফুল আসার সময়", 35, None, "crops/crop_parameters.csv: spikelet sterility above 35 C"),
                srdi=("Kharif-1", "আউশ (")),
}


def srdi_card() -> pd.DataFrame:
    d = pd.read_csv(RESEARCH / "soil" / "srdi_frs_doses.csv")
    d = d[d["site_id"] == "RAJ_TANORE"].copy()
    for c in ("crop_bn", "land_type_bn"):
        d[c] = d[c].map(er.nfc)
    return d[d["land_type_bn"] == er.nfc("মাঝারি উঁচু জমি")]


def dose(spec: dict, card: pd.DataFrame, tech: pd.DataFrame) -> dict:
    """The fertilizer dose in the engine's FertilizerDose shape, with its source."""
    if "srdi" in spec:
        season, prefix = spec["srdi"]
        rows = card[(card["season"] == season) & card["crop_bn"].str.startswith(er.nfc(prefix))]
        if len(rows) != 1:
            raise SystemExit(f"SRDI card: expected one {season} row for {prefix}, found {len(rows)}")
        r = rows.iloc[0]
        return {"cropGroupBangla": r["crop_bn"].split("(")[0].strip(), "ureaKgHa": float(r["urea_kg_ha"]),
                "tspKgHa": float(r["tsp_kg_ha"]), "mopKgHa": float(r["mop_kg_ha"]), "gypsumKgHa": float(r["gypsum_kg_ha"]),
                "zincSulphateKgHa": float(r["zinc_sulphate_kg_ha"]), "boricAcidKgHa": float(r["boric_acid_kg_ha"]),
                "source": "SRDI Talanda card (medium-high land)"}
    r = tech.loc[spec["handbook_dose"]]
    val = lambda c: 0.0 if pd.isna(r[c]) else float(r[c])
    return {"cropGroupBangla": str(r["crop_bn"]).split("(")[0].strip(), "ureaKgHa": val("urea_kg_ha"),
            "tspKgHa": val("tsp_kg_ha"), "mopKgHa": val("mop_kg_ha"), "gypsumKgHa": val("gypsum_kg_ha"),
            "zincSulphateKgHa": val("zinc_sulphate_kg_ha"), "boricAcidKgHa": val("boron_kg_ha"),
            "source": "BARI handbook (not on the SRDI Talanda card)"}


def kc_of(spec: dict, cp: pd.DataFrame, fao: pd.DataFrame) -> tuple[tuple[float, float, float], str]:
    table, name = spec["kc"]
    if table == "assumed":
        return tuple(name), spec["kc_source"]
    if table == "cp":
        return tuple(float(x) for x in cp.loc[name, ["kc_ini", "kc_mid", "kc_end"]]), "crops/crop_parameters.csv (FAO-56 Table 12)"
    r = fao[fao["crop"] == name].iloc[0]
    return (float(r["kc_ini"]), float(r["kc_mid"]), float(r["kc_end"])), "FAO-56 Table 12 (crops/fao56_kc.csv)"


def sow_dates(start: pd.Timestamp, end: pd.Timestamp) -> list[pd.Timestamp]:
    dates = list(pd.date_range(start, end, freq="10D"))
    return dates if dates[-1] == end else dates + [end]


def plan(crop_id: str, spec: dict, tech: pd.DataFrame, brri: pd.DataFrame) -> dict:
    """Sowing dates (reference year 2001), field days and the window shown to farmers."""
    if "brri" in spec:
        r = brri.loc[spec["brri"]]
        seedling = round(cc.mid(r["seedling_age_days"]))
        s0, s1 = cc.window(r["seedbed_sowing"], 2001)
        seedbeds = sow_dates(s0, s1)
        days = int(r["duration_days_min"]) - seedling
        return {"sow": [d + pd.Timedelta(days=seedling) for d in seedbeds], "days": days, "seedling": seedling,
                "window": [(s0 + pd.Timedelta(days=seedling)).strftime("%m-%d"), (s1 + pd.Timedelta(days=seedling)).strftime("%m-%d")],
                "window_source": f"BRRI factsheet: seedbed {r['seedbed_sowing']}, {r['seedling_age_days']}-day seedlings",
                "days_source": f"BRRI factsheet: {int(r['duration_days_min'])} days from seeding"}
    if "handbook" in spec:
        text = str(tech.loc[spec["handbook"], "sowing_windows"]).split(";")[spec.get("handbook_window", 0)].strip()
        source = HANDBOOK
    else:
        text, source = spec["window"], spec["window_source"]
    s0, s1 = cc.window(text, 2001)
    return {"sow": sow_dates(s0, s1), "days": spec["days"], "seedling": None,
            "window": [s0.strftime("%m-%d"), s1.strftime("%m-%d")], "window_source": source,
            "days_source": spec["days_source"]}


def replay_crop(p: pd.DataFrame, spec: dict, kc: tuple, cal: dict) -> list[list]:
    """[sowing, harvest, net irrigation median, p10, p90, crop water use median, hot days median, days with 50 mm+
    of rain median] per sowing date."""
    rows = []
    n = cal["days"]
    paddy = "brri" in spec
    residual = 0.0 if spec["season"] == "Kharif-1" else 50.0  # wet soil after Aman or in the monsoon
    for ref in cal["sow"]:
        net, use, hot, wet = [], [], [], []
        for y in SEASONS:
            sow = pd.Timestamp(y if ref.month >= 7 else y + 1, ref.month, ref.day)
            days = pd.date_range(sow, periods=n)
            if days[-1] > p.index.max():
                continue
            et0 = p.loc[days, "et0"].to_numpy()
            rain = p.loc[days, "rain"].to_numpy()
            if np.isnan(et0).any() or np.isnan(rain).any():
                continue  # missing days stay missing: the season is left out, never filled
            wet.append(int((rain >= 50).sum()))
            if paddy:
                etc = cc.kc_curve(n, kc) * et0
                s, irrigation = cc.START_WATER, 150.0  # puddling, then keep standing water
                for r_, e_ in zip(rain, etc):
                    s = min(s + r_ - e_ - (cc.SEEPAGE if s > 0 else 0.0), cc.BUND)
                    if s < 0:
                        irrigation += cc.START_WATER - s
                        s = cc.START_WATER
                net.append(irrigation)
                flower = days[-1] - pd.Timedelta(days=29)  # maturity - 30 days, as for Aman and Boro
                fl = p.loc[flower - pd.Timedelta(days=7):flower + pd.Timedelta(days=7), "tmax"]
                hot.append(int((fl >= spec["heat"][2]).sum()))
            else:
                etc = cc.kc_curve(n, kc, UPLAND_FRAC) * et0
                eff = np.where(rain > 5, 0.8 * rain, 0).sum()
                net.append(max(0.0, etc.sum() - eff - residual))
                if spec["heat"]:
                    f0, f1 = spec["heat"][3]
                    hot.append(int((p.loc[days[int(n * f0):int(n * f1)], "tmax"] > spec["heat"][2]).sum()))
            use.append(etc.sum())
        net_s = pd.Series(net)
        harvest = (ref + pd.Timedelta(days=n - 1)).strftime("%m-%d")
        rows.append([ref.strftime("%m-%d"), harvest, int(round(net_s.median())), int(round(net_s.quantile(0.1))),
                     int(round(net_s.quantile(0.9))), int(round(float(np.median(use)))),
                     int(round(float(np.median(hot)))) if hot else None, int(round(float(np.median(wet))))])
    return rows


def main() -> None:
    cp = pd.read_csv(RESEARCH / "crops" / "crop_parameters.csv").set_index("crop")
    fao = pd.read_csv(RESEARCH / "crops" / "fao56_kc.csv")
    tech = pd.read_csv(RESEARCH / "crops" / "bari_production_technology.csv").drop_duplicates("crop_en").set_index("crop_en")
    brri = pd.read_csv(RESEARCH / "crops" / "brri_rice_varieties.csv").drop_duplicates("variety").set_index("variety")
    card = srdi_card()

    crops, cals = {}, {}
    for cid, spec in CROPS.items():
        kc, kc_source = kc_of(spec, cp, fao)
        cal = plan(cid, spec, tech, brri)
        cals[cid] = (spec, kc, cal)
        heat = None
        if spec["heat"]:
            stage, stage_bn, limit, share, source = spec["heat"]
            window_days = 15 if share is None else int(cal["days"] * share[1]) - int(cal["days"] * share[0])
            heat = {"stage": stage, "stageBangla": stage_bn, "thresholdC": limit, "windowDays": window_days,
                    "source": source, "assumed": source.endswith("assumed")}
        crops[cid] = {"season": spec["season"], "label": spec["label"], "window": cal["window"],
                      "windowSource": cal["window_source"], "fieldDays": cal["days"], "daysSource": cal["days_source"],
                      "seedlingDays": cal["seedling"], "relayDays": spec.get("relay_days", 0),
                      "kc": list(kc), "kcSource": kc_source, "kcAssumed": spec["kc"][0] == "assumed",
                      "residualSoilWaterMm": 0 if spec["season"] == "Kharif-1" else 50,
                      "waterMethod": "paddy" if "brri" in spec else "upland", "heat": heat,
                      "fertilizer": dose(spec, card, tech)}

    st = pd.read_csv(RESEARCH / "sites" / "bmd_stations_gsod.csv")
    gsod = DATA / "stations" / "gsod"
    st["path"] = [next(iter(gsod.glob(f"{w}_*.parquet")), None) for w in st["wmo"]]
    st = st.dropna(subset=["path"]).reset_index(drop=True)

    pilot = pd.read_csv(RESEARCH / "sites" / "pilot_sites.csv").set_index("site_id").loc["RAJ_TANORE"]
    places = [("talanda_tanore", "RAJ_TANORE", float(pilot["lat"]), float(pilot["lon"]))]
    for _, s in pd.read_csv(RESEARCH / "sites" / "districts.csv").iterrows():
        places.append((str(s["name"]), s["site_id"], float(s["lat"]), float(s["lon"])))

    out = {}
    for key, site, lat, lon in places:
        if not (DATA / "power" / "daily" / f"{site}.parquet").exists():
            print(f"  {key}: no POWER cache, skipped")
            continue
        p, station = nr.weather(site, lat, lon, st)
        out[key] = {cid: replay_crop(p, spec, kc, cal) for cid, (spec, kc, cal) in cals.items()}
        pick = lambda cid: out[key][cid][len(out[key][cid]) // 2]
        print(f"{key:<16} sunflower {pick('sunflower')[0]} {pick('sunflower')[2]:>3} mm; potato {pick('potato')[2]:>3} mm; "
              f"maize {pick('maize')[2]:>3} mm, {pick('maize')[6]} hot; mungbean {pick('mungbean')[2]:>3} mm; "
              f"Aus {pick('aus')[2]:>4} mm; jute {pick('jute')[2]:>3} mm; soybean (monsoon) {pick('soybean_k2')[2]:>3} mm, "
              f"{pick('soybean_k2')[7]} heavy-rain days; station {station['name'] if station else '-'}")

    OUT.write_text(json.dumps({"generatedOn": f"{date.today()}",
                               "seasons": "monsoon 2001-2024; Rabi 2001-02 to 2024-25; Kharif-1 2002 to 2025",
                               "seasonCount": len(SEASONS),
                               "method": __doc__.split("\n\n")[1].strip(),
                               "columns": ["sowing", "harvest", "netIrrigationMm", "p10", "p90", "cropWaterUseMm", "hotDays", "heavyRainDays"],
                               "crops": crops, "places": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(crops)} crops x {len(out)} places")


if __name__ == "__main__":
    main()
