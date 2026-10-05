"""Write each upazila's land type, current cropping and district yields for the engine's local advice.

The 5 October 2026 audit found the engine gave every upazila outside the Tanore pilot the same plan, although the
repo held local layers that differ from place to place. This brings three of them to the engine:

  * land type: NASA NASADEM elevation and JRC Global Surface Water (soil/landtype_proxy_upazila.csv) with BRRI's
    survey of what farmers grow. Water seen 3-6 months a year in 2021 is seasonal flooding (haor, beels); water seen
    longer is rivers, ponds and shrimp ghers, so it does not count. Landsat cannot see through monsoon cloud, so a
    Boro-Fallow-Fallow year (no crop while the land is under water) on much of the upazila counts as well.
        low         seasonal water on >= 35% of the upazila, or Boro-Fallow-Fallow on >= 50% of its cropped land
        medium_low  seasonal water on >= 20%, or Boro-Fallow-Fallow on >= 30%
        high        lowest tenth of the land >= 20 m above sea level, almost no seasonal water and >= 90% never
                    seen wet (Barind, the northern piedmont, the hills)
        medium_high everything else (land flooded shallowly in the monsoon, where T. Aman is grown)
  * what farmers grow now: BRRI's 2014-15 survey of every upazila (Bangladesh Rice Journal 21(2), 2017;
    crops/upazila_top_patterns.csv, crops/upazila_land_use.csv): the top patterns and cropping intensity. Upazila
    names that repeat across districts (Kaliganj, Durgapur, ...) are matched through the BRRI region.
  * district yields: BBS district tables 2022-23 to 2024-25 (bbs/crop_district.csv), area-weighted, against the
    national yield, with the national crop value per hectare (crops/crop_parameters.csv, crops/minor_crop_returns.csv,
    or the BBS 2024-25 harvest price times the national yield) so the engine can move income with the local yield.
    Each crop's worst BBS harvest price of 2021-22 to 2024-25 against 2024-25 (`priceLowRatio`) gives its return in
    a bad price year (potato's fell to 45%, rice's to 77-79%).
    Rice and potato use the HYV rows, as the engine's varieties are HYV (a district's total Aman can be mostly
    broadcast deep-water Aman). Where a district grows too little of a crop to say, the engine takes the lower tenth of
    district yields (`lowYield`): no local evidence that it does well there.
  * soil salinity: SRDI's May 2009 survey of the coastal belt (soil/srdi_salinity_upazila.csv, from Saline Soils of
    Bangladesh, 2010): the share of each saline upazila's cultivated land in each ECe class, with the FAO-61 salt
    tolerance of every crop the engine plans (crops/salt_tolerance.csv)
  * the haor's flash floods: the date of the first upstream burst (100 mm or more in 3 days, GPM IMERG over the
    Meghalaya hills at Sohra) each spring 2001-2025 (floods/flash_flood_hindcast.csv), which came before every
    flash flood FFWC reported (5 of 5 years), so the engine can say how often a crop's harvest date was too late.

Output: packages/rotation-engine/src/data/upazila_profile.json
Usage : python research/export/upazila_profile.py
"""
from __future__ import annotations

import difflib
import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

import pandas as pd

RESEARCH = Path(__file__).resolve().parents[1]
OUT = RESEARCH.parent / "packages" / "rotation-engine" / "src" / "data" / "upazila_profile.json"

# Engine crop id -> (BBS district table crop, variant)
BBS_CROPS = {
    "aman": ("Aman rice", "HYV"), "boro": ("Boro rice", "HYV"), "aus": ("Aus rice", "HYV"),
    "wheat": ("Wheat", "all"), "maize": ("Rabi Maize", "all"), "potato": ("Potato", "HYV"),
    "lentil": ("Lentil (Masur)", "all"), "mustard": ("Rape and Mustard (Local+HYV)", "all"),
    "chickpea": ("Gram", "all"), "grasspea": ("Kheshari", "all"), "mungbean": ("Green gram (Mug)", "all"),
    "sesame": ("Sesame Till (Rabi & Kharif)", "all"), "jute": ("Jute", "all"), "soybean": ("Soyabean", "all"),
    "sunflower": ("Sunflower (Surjamukhi)", "all"), "barley": ("Jab", "all"), "sweetpotato": ("Sweet Potato", "all"),
}
# National crop value per hectare: research tables first, else BBS 2024-25 harvest price x national yield
PARAM_ROWS = {"boro": "Boro rice", "aman": "T.Aman rice", "aus": "Aus rice", "wheat": "Wheat", "maize": "Maize",
              "potato": "Potato", "jute": "Jute"}
PRICE_ITEMS = {"lentil": "Lentil (Masur)", "mustard": "Mustard"}
# Engine crop id -> BBS harvest price item, for the price swing over the four years in the table
PRICE_SWING = {"aman": "Aman Paddy (Coarse)", "boro": "Boro Paddy (Coarse)", "aus": "Aus Paddy (Coarse)", "wheat": "Wheat",
               "lentil": "Lentil (Masur)", "mustard": "Mustard", "grasspea": "Grass pea (Kheshari)", "chickpea": "Gram",
               "mungbean": "Green Gram (Mug)", "sesame": "Til", "jute": "Jute (tossa)", "potato": "Potato (Holand)",
               "sweetpotato": "Sweet.Potato"}
PRICE_YEARS = ["2021-22", "2022-23", "2023-24", "2024-25"]
MIN_AREA_HA = 100  # a district yield from fewer hectares than this is too thin to use
# BRRI spellings that neither the exact nor the close match finds (normalised name -> normalised site name)
ALIASES = {"comillaadorshosadar": "comillaadarshasadar", "comillasouth": "comillasadardakshin",
           "comillasadarsouth": "comillasadardakshin", "matlabnorth": "matlabuttar", "matlabsouth": "matlabdakshin",
           "sunamganjsouth": "dakshinsunamganj", "surma": "dakshinsurma", "bbaria": "brahmanbariasadar",
           "lalsadar": "lalmonirhatsadar", "khagrasadar": "khagrachharisadar", "goalanda": "goalandaghat",
           "nesarabad": "nesarabadswarupkati", "barisalsadar": "barisalsadarkotwali", "chapaisadar": "nawabganjsadar",
           "chapainawabganj": "nawabganjsadar", "chowhali": "chauhali", "comadarsha": "comillaadarshasadar",
           "comsouth": "comillasadardakshin", "coxbazar": "coxsbazarsadar", "jhalakati": "jhalokatisadar",
           "joyprhat": "joypurhatsadar", "kahalu": "kahaloo", "matlabn": "matlabuttar", "matlabs": "matlabdakshin",
           "munsiganj": "munshiganjsadar", "raiganj": "royganj", "raipur|Chittagong": "roypur", "raipur|Dhaka": "roypura",
           "razibpur": "charrajibpur", "rowmari": "raumari"}


def norm(s) -> str:
    return re.sub(r"[^a-z]", "", str(s).lower())


def land_types(sites: pd.DataFrame, bff: dict[str, float]) -> dict[str, dict]:
    lt = pd.read_csv(RESEARCH / "soil" / "landtype_proxy_upazila.csv")
    shape = pd.read_csv(RESEARCH / "sites" / "adm3_centroids.csv")[["shape_id", "site_id"]]
    lt = lt.merge(shape, on="shape_id", how="inner")
    out = {}
    for r in lt.itertuples():
        seasonal = max(0.0, r.share_water_ge3months_2021 - r.share_water_ge6months_2021)
        b = bff.get(r.site_id)
        basis = []
        if seasonal >= 0.35 or (b is not None and b >= 50):
            kind = "low"
        elif seasonal >= 0.20 or (b is not None and b >= 30):
            kind = "medium_low"
        elif r.elev_p10_m >= 20 and seasonal < 0.03 and r.share_never_water >= 0.9:
            kind = "high"
        else:
            kind = "medium_high"
        if seasonal >= 0.20:
            basis.append("water")
        if b is not None and b >= 30:
            basis.append("pattern")
        if kind == "high":
            basis.append("elevation")
        out[r.site_id] = {
            "type": kind,
            "seasonalWater": round(seasonal, 2),
            "wetAllYear": round(float(r.share_water_ge6months_2021), 2),
            "neverWet": round(float(r.share_never_water), 2),
            "elevP10M": int(r.elev_p10_m),
            "elevMedianM": int(r.elev_median_m),
            "basis": basis,
        }
    return out


def patterns(sites: pd.DataFrame) -> tuple[dict[str, list], dict[str, float], dict[str, float], dict]:
    """Top BRRI patterns per upazila; repeated names resolved through the districts each BRRI region covers."""
    pat = pd.read_csv(RESEARCH / "crops" / "upazila_top_patterns.csv")
    use = pd.read_csv(RESEARCH / "crops" / "upazila_land_use.csv")
    by_name = defaultdict(list)
    for s in sites.itertuples():
        by_name[norm(s.name)].append(s)
    # Districts each region covers, learnt from names that occur once in the country
    region_districts = defaultdict(set)
    for df in (pat, use):
        for r in df.itertuples():
            cands = by_name.get(norm(r.upazila), [])
            if len(cands) == 1:
                region_districts[r.region].add(cands[0].district)

    def site_of(name: str, region: str):
        key = ALIASES.get(f"{norm(name)}|{region}", ALIASES.get(norm(name), norm(name)))
        if key in ("", "sadar"):  # a bare 'sadar' row cannot be placed
            report["unmatched"].add(f"{name} ({region})")
            return None
        cands = by_name.get(key, [])
        if len(cands) == 1:
            return cands[0].site_id
        allowed = region_districts[region]
        inside = [c for c in cands if c.district in allowed]
        if cands:
            return inside[0].site_id if len(inside) == 1 else None
        # A district's own name ('Barguna', 'Jessore sadar'): its Sadar upazila
        base = key.replace("sadar", "")
        for d in allowed:
            if norm(d) == base:
                seat = [s for s in sites.itertuples() if s.district == d and "sadar" in norm(s.name)]
                return seat[0].site_id if len(seat) == 1 else None
        # A spelling variant ('Tanor', 'Nachol', 'Astogram'): the closest name among the region's upazilas
        pool = {norm(s.name): s.site_id for s in sites.itertuples() if s.district in allowed}
        close = difflib.get_close_matches(key, pool, n=2, cutoff=0.8)
        if len(close) == 1 or (len(close) == 2 and difflib.SequenceMatcher(None, key, close[0]).ratio()
                                > difflib.SequenceMatcher(None, key, close[1]).ratio() + 0.05):
            report["close"][f"{name} ({region})"] = pool[close[0]]
            return pool[close[0]]
        report["unmatched"].add(f"{name} ({region})")
        return None

    report = {"close": {}, "unmatched": set()}

    rows = defaultdict(dict)
    for r in pat.itertuples():
        sid = site_of(r.upazila, r.region)
        if sid is None or pd.isna(r.pct_upazila_nca):
            continue
        rows[sid][r.pattern] = max(rows[sid].get(r.pattern, 0.0), float(r.pct_upazila_nca))
    top, bff = {}, {}
    for sid, pats in rows.items():
        if sum(pats.values()) > 105:  # rows of two upazilas got merged; do not trust them
            continue
        ranked = sorted(pats.items(), key=lambda kv: -kv[1])[:3]
        top[sid] = [[p, round(v, 1)] for p, v in ranked]
        bff[sid] = round(sum(v for p, v in pats.items() if norm(p) == "borofallowfallow"), 1)
    intensity = {}
    for r in use.itertuples():
        sid = site_of(r.upazila, r.region)
        if sid is not None and not pd.isna(r.cropping_intensity_pct):
            intensity[sid] = float(r.cropping_intensity_pct)
    return top, bff, intensity, report


def yields() -> tuple[dict[str, dict], dict[str, dict]]:
    bbs = pd.read_csv(RESEARCH / "bbs" / "crop_district.csv")
    params = pd.read_csv(RESEARCH / "crops" / "crop_parameters.csv").set_index("crop")
    minor = pd.read_csv(RESEARCH / "crops" / "minor_crop_returns.csv").set_index("crop")
    prices = pd.read_csv(RESEARCH / "bbs" / "harvest_prices.csv").set_index("item")
    districts = defaultdict(dict)
    national = {}
    for cid, (crop, variant) in BBS_CROPS.items():
        rows = bbs[(bbs.crop == crop) & (bbs.variant == variant) & (bbs.area_ha > 0)]
        if rows.empty:
            continue
        latest = rows.year.max()
        prod = rows.groupby("district").production_t.sum()
        area = rows.groupby("district").area_ha.sum()
        area_latest = rows[rows.year == latest].groupby("district").area_ha.sum()
        for d in area.index:
            a = float(area_latest.get(d, 0.0))
            y = float(prod[d] / area[d]) if area[d] > 0 else None
            if y and a >= MIN_AREA_HA:
                districts[d][cid] = [round(y, 2), int(round(a))]
            elif a > 0:
                districts[d][cid] = [None, int(round(a))]
        nat_yield = float(prod.sum() / area.sum())
        thick = [prod[d] / area[d] for d in area.index if area_latest.get(d, 0.0) >= MIN_AREA_HA and area[d] > 0]
        low_yield = float(pd.Series(thick).quantile(0.1)) if len(thick) >= 5 else None
        value, source = None, None
        if cid in PARAM_ROWS and not pd.isna(params.loc[PARAM_ROWS[cid], "crop_value_bdt_ha"]):
            value = float(params.loc[PARAM_ROWS[cid], "crop_value_bdt_ha"])
            source = "crop value, Agriculture Census 2019 (crops/crop_parameters.csv)"
        elif cid in minor.index and not pd.isna(minor.loc[cid, "crop_value_tk_ha"]):
            value = float(minor.loc[cid, "crop_value_tk_ha"])
            source = "crop value, crops/minor_crop_returns.csv (BBS 2024-25 price x yield)"
        elif cid in PRICE_ITEMS:
            price = float(prices.loc[PRICE_ITEMS[cid], "2024-25"]) / 100  # Tk per kg
            value = price * nat_yield * 1000
            source = f"BBS 2024-25 harvest price ({price:.2f} Tk/kg) x national yield"
        swing = None
        if cid in PRICE_SWING:
            series = prices.loc[PRICE_SWING[cid], PRICE_YEARS].astype(float).dropna()
            if len(series) >= 3 and series.iloc[-1] > 0:
                swing = round(float(series.min() / prices.loc[PRICE_SWING[cid], "2024-25"]), 2)
        national[cid] = {"yield": round(nat_yield, 2), "lowYield": None if low_yield is None else round(low_yield, 2),
                         "priceLowRatio": swing,
                         "value": None if value is None else int(round(value)),
                         "valueSource": source, "years": f"{rows.year.min()} to {latest}", "areaHa": int(area_latest.sum())}
    return dict(districts), national


def flash_floods() -> dict:
    hind = pd.read_csv(RESEARCH / "floods" / "flash_flood_hindcast.csv")
    skill = pd.read_csv(RESEARCH / "floods" / "flash_flood_thresholds.csv").set_index("threshold_mm").loc[100]
    first = {int(r.year): (None if pd.isna(r.first_burst_100mm) else str(r.first_burst_100mm)[5:10]) for r in hind.itertuples()}
    return {
        "burstMm": 100,
        "firstBurst": first,
        "floodYears": [int(y) for y in hind.loc[hind.flash_flood == 1, "year"]],
        "noFloodYears": [int(y) for y in hind.loc[hind.flash_flood == 0, "year"]],
        "floodYearsCaught": str(skill["flood_years_caught"]),
        "source": ("GPM IMERG Final 3-day rain at Sohra (Meghalaya), 15 Mar-15 May 2001-2025, against FFWC's Annual "
                   "Flood Reports (research/explore/flash_flood_hindcast.py)"),
    }


def salinity() -> tuple[dict, dict]:
    sal = pd.read_csv(RESEARCH / "soil" / "srdi_salinity_upazila.csv").dropna(subset=["site_id"])
    per = {r.site_id: {"cultivatedHa": int(r.cultivated_ha), "salineShare": float(r.saline_share),
                       "strongShare": float(r.strong_share),
                       "classShares": [float(getattr(r, f"s{k}_share")) for k in range(1, 6)]}
           for r in sal.itertuples()}
    tol = pd.read_csv(RESEARCH / "crops" / "salt_tolerance.csv")
    crops = {r.crop_id: {"threshold": float(r.threshold_ds_m), "slope": float(r.slope_pct_per_ds_m), "rating": r.rating,
                         "basis": r.basis, "note": "" if pd.isna(r.note) else r.note} for r in tol.itertuples()}
    return per, crops


def main() -> None:
    sites = pd.read_csv(RESEARCH / "sites" / "upazilas.csv")
    top, bff, intensity, report = patterns(sites)
    land = land_types(sites, bff)
    district_yields, national = yields()
    saline, tolerance = salinity()
    ups = {}
    for s in sites.itertuples():
        entry = {"land": land.get(s.site_id)}
        if s.site_id in saline:
            entry["salinity"] = saline[s.site_id]
        if s.site_id in top:
            entry["patterns"] = top[s.site_id]
            entry["boroFallowFallowPct"] = bff[s.site_id]
        if s.site_id in intensity:
            entry["intensityPct"] = intensity[s.site_id]
        ups[s.site_id] = entry
    out = {
        "generatedOn": f"{date.today()}",
        "sources": {
            "land": "NASA NASADEM elevation and JRC Global Surface Water 1984-2021 at 90 m (research/acquire/landtype_proxy.py)",
            "patterns": "BRRI cropping-pattern survey of every upazila, 2014-15 (Bangladesh Rice Journal 21(2), 2017)",
            "yields": "BBS district crop tables 2022-23 to 2024-25 (Yearbook of Agricultural Statistics 2025)",
            "salinity": "SRDI (2010) Saline Soils of Bangladesh, Appendix 2: soil salinity classes surveyed in May 2009",
            "saltTolerance": "FAO Irrigation and Drainage Paper 61 (2002), Annex 1 Table A1.1 (Maas and Grattan 1999)",
        },
        "salinityClassesDsM": [3.0, 6.0, 10.0, 14.0, 18.0],  # S1-S5: 2-4, 4.1-8, 8.1-12, 12.1-16, above 16 dS/m
        "saltTolerance": tolerance,
        "landRule": ("low: water 3-6 months a year on >= 35% of the upazila (Landsat, 2021) or Boro-Fallow-Fallow on "
                     ">= 50% of its cropped land (BRRI 2014-15); medium_low: >= 20% or >= 30%; high: lowest tenth of "
                     "the land >= 20 m (NASADEM), almost no seasonal water, >= 90% never seen wet; else medium_high"),
        "minAreaHa": MIN_AREA_HA,
        "upazilas": ups,
        "districts": district_yields,
        "national": national,
        "haorFlashFlood": flash_floods(),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kinds = pd.Series([v["land"]["type"] for v in ups.values() if v["land"]]).value_counts().to_dict()
    print(f"wrote {OUT.relative_to(RESEARCH.parent)}: {len(ups)} upazilas (land {kinds}), "
          f"{len(top)} with patterns, {len(district_yields)} districts, {len(national)} crops")
    print(f"BRRI names matched by close spelling ({len(report['close'])}): "
          + ", ".join(f"{k} -> {v}" for k, v in sorted(report["close"].items())))
    print(f"BRRI names left unmatched ({len(report['unmatched'])}): " + ", ".join(sorted(report["unmatched"])))


if __name__ == "__main__":
    main()
