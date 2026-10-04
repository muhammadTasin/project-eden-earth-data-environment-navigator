"""How much pesticide each crop gets, upazila by upazila: NASA SEDAC PEST-CHEMGRIDS v1.01 read for Bangladesh.

PEST-CHEMGRIDS (Maggi et al. 2019) maps the yearly application rate (kg of active ingredient per hectare of the crop)
of the 20 most used active ingredients on each of 6 dominant crops and 4 crop classes, 5 arc-minutes, 2015 with
projections to 2020 and 2025, low and high estimates.  Here, for 2020:

  1. the 20 rates of each crop class are summed per grid cell (low and high separately; ocean, no-data and
     not-approved cells are left out of the sum).  Soil fumigants (metam, metam potassium, 1,3-dichloropropene,
     chloropicrin, methyl bromide) are summed apart: they are 87% of the vegetable estimate at Tanore and come from
     the dataset's US-based model of high-input vegetable farming, so the advice uses the totals without them,
  2. each upazila takes the mean of the cells whose centres fall inside it, weighted by that crop's harvested area
     in the cell (the dataset's own crop map, after Monfreda et al. 2008); a small upazila with no cell centre
     inside takes the nearest cell,
  3. the national figure is the same weighted mean over all of Bangladesh, and the ingredients are ranked by it.

Bangladesh has no county-level pesticide survey in the dataset: its rates are a statistical re-analysis of US survey
data and FAOSTAT's national totals, so they are a model's estimate for comparing crops, not a measurement on a farm.

Input : research/data/sedac/pest_chemgrids/ferman-v1-pest-chemgrids-v1-01-netcdf.zip (research/acquire/pest_chemgrids.py)
        research/data/boundaries/BGD_ADM3_simplified.geojson + research/sites/adm3_centroids.csv (upazila ids)
Output: packages/rotation-engine/src/data/pesticide_load.json, research/pilots/pesticide_upazila.csv
Usage : python research/explore/pesticide_load.py
"""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from pathlib import Path

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ZIP = ROOT / "research" / "data" / "sedac" / "pest_chemgrids" / "ferman-v1-pest-chemgrids-v1-01-netcdf.zip"
BASE = "ferman-v1-pest-chemgrids-v1-01-netcdf/"
SHAPES = ROOT / "research" / "data" / "boundaries" / "BGD_ADM3_simplified.geojson"
IDS = ROOT / "research" / "sites" / "adm3_centroids.csv"
OUT_JSON = ROOT / "packages" / "rotation-engine" / "src" / "data" / "pesticide_load.json"
OUT_CSV = ROOT / "research" / "pilots" / "pesticide_upazila.csv"

BOX = (20.5, 26.75, 88.0, 92.75)  # lat_min, lat_max, lon_min, lon_max (Bangladesh)
# the dataset's crop classes that Bangladeshi farmers grow, and what the engine calls them
CLASSES = {"Rice": "rice", "Wheat": "wheat", "Corn": "maize", "Soybean": "soybean", "VegFru": "vegfruit",
           "Other": "other", "Cotton": "cotton"}
YEAR_INDEX = {"low": 1, "high": 4}  # APR layers: L2015, L2020, L2025, H2015, H2020, H2025
FUMIGANTS = {"Metam", "Metam potassium", "Dichloropropene", "Chloropicrin", "Methyl bromide"}


def window(lat: np.ndarray, lon: np.ndarray) -> tuple[slice, slice]:
    li = np.where((lat >= BOX[0]) & (lat <= BOX[1]))[0]
    lo = np.where((lon >= BOX[2]) & (lon <= BOX[3]))[0]
    return slice(li.min(), li.max() + 1), slice(lo.min(), lo.max() + 1)


def inside(px: np.ndarray, py: np.ndarray, ring: list) -> np.ndarray:
    """Even-odd ray casting for many points against one ring."""
    r = np.asarray(ring)
    x0, y0, x1, y1 = r[:-1, 0], r[:-1, 1], r[1:, 0], r[1:, 1]
    hit = np.zeros(px.shape, bool)
    for a, b, c, d in zip(x0, y0, x1, y1):
        crosses = ((b > py) != (d > py)) & (px < (c - a) * (py - b) / ((d - b) or 1e-12) + a)
        hit ^= crosses
    return hit


def polygon_mask(geom: dict, glat: np.ndarray, glon: np.ndarray) -> np.ndarray:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    gx, gy = np.meshgrid(glon, glat)
    mask = np.zeros(gx.shape, bool)
    for poly in polys:
        xs = [p[0] for p in poly[0]]
        ys = [p[1] for p in poly[0]]
        sel = (gx >= min(xs)) & (gx <= max(xs)) & (gy >= min(ys)) & (gy <= max(ys))
        if not sel.any():
            continue
        m = inside(gx[sel], gy[sel], poly[0])
        for hole in poly[1:]:
            m &= ~inside(gx[sel], gy[sel], hole)
        mask[sel] |= m
    return mask


def main() -> None:
    z = zipfile.ZipFile(ZIP)
    names = z.namelist()

    def h5(member: str) -> h5py.File:
        return h5py.File(io.BytesIO(z.read(BASE + member)), "r")

    with h5("APR/NC/APR_Rice_Propanil_H_L.nc") as f:
        lat, lon = f["lat"][:], f["lon"][:]
    ws = window(lat, lon)
    glat, glon = lat[ws[0]], lon[ws[1]]

    # every upazila's cells, once
    shape_to_id = {r["shape_id"]: r["site_id"] for r in csv.DictReader(open(IDS, encoding="utf-8"))}
    shapes = json.loads(SHAPES.read_text(encoding="utf-8"))["features"]
    cells: dict[str, np.ndarray] = {}
    for feat in shapes:
        uid = shape_to_id[feat["properties"]["shapeID"]]
        m = polygon_mask(feat["geometry"], glat, glon)
        if not m.any():  # smaller than a cell: the nearest cell to its centre
            ring = np.asarray((feat["geometry"]["coordinates"][0] if feat["geometry"]["type"] == "Polygon"
                               else feat["geometry"]["coordinates"][0][0]))
            cy, cx = ring[:, 1].mean(), ring[:, 0].mean()
            m = np.zeros((glat.size, glon.size), bool)
            m[np.abs(glat - cy).argmin(), np.abs(glon - cx).argmin()] = True
        cells[uid] = m
    print(f"{len(cells)} upazilas on a {glat.size} x {glon.size} grid of 5 arc-minute cells")

    result = {"classes": {}, "upazilas": {uid: {} for uid in sorted(cells)}}
    rows = {uid: {"upazila": uid} for uid in sorted(cells)}
    for cls, key in CLASSES.items():
        with h5(f"CROPS/NC/{cls}_HarvestedArea.nc") as f:
            alat, alon = f["lat"][:], f["lon"][:]
            area_full = f["Harvest_Area"]
            ai = [np.abs(alat - y).argmin() for y in glat]
            oi = [np.abs(alon - x).argmin() for x in glon]
            area = area_full[min(ai):max(ai) + 1, min(oi):max(oi) + 1]
            area = area[np.ix_(np.array(ai) - min(ai), np.array(oi) - min(oi))]
        area = np.where(area > 0.1, area, 0.0)  # 1e-2 ocean, 1e-1 no data

        totals = {k: np.zeros((glat.size, glon.size)) for k in YEAR_INDEX}      # without soil fumigants
        fumigant = {k: np.zeros((glat.size, glon.size)) for k in YEAR_INDEX}
        seen = {k: np.zeros((glat.size, glon.size), bool) for k in YEAR_INDEX}
        per_ai = []
        files = sorted(n for n in names if re.search(rf"/APR_{cls}_.+_H_L\.nc$", n))
        for member in files:
            name = re.search(rf"/APR_{cls}_(.+)_H_L\.nc$", member).group(1)
            with h5(member[len(BASE):]) as f:
                apr = f["APR"][:, ws[0], ws[1]]
            ai_stats = {"name": name}
            for k, idx in YEAR_INDEX.items():
                v = apr[idx]
                ok = v > 0
                (fumigant if name in FUMIGANTS else totals)[k] += np.where(ok, v, 0.0)
                seen[k] |= ok
                w = area * ok
                ai_stats[k] = round(float((v * w).sum() / w.sum()), 4) if w.sum() else 0.0
            ai_stats["notApproved"] = bool((apr[YEAR_INDEX["low"]] == -1).any())
            ai_stats["soilFumigant"] = name in FUMIGANTS
            per_ai.append(ai_stats)
        wnat = area * seen["low"]
        national = {k: round(float((totals[k] * wnat).sum() / wnat.sum()), 3) for k in YEAR_INDEX}
        with_fum = {k: round(float(((totals[k] + fumigant[k]) * wnat).sum() / wnat.sum()), 3) for k in YEAR_INDEX}
        per_ai.sort(key=lambda a: -(a["low"] + a["high"]))
        result["classes"][key] = {
            "dataset": cls, "harvestedHa": round(float(area.sum())), "national": national,
            "nationalWithFumigants": with_fum,
            "topIngredients": [a for a in per_ai if not a["soilFumigant"]][:5], "ingredients": len(per_ai),
            "soilFumigants": [a["name"] for a in per_ai if a["soilFumigant"]],
            "notApproved": [a["name"] for a in per_ai if a["notApproved"]],
        }
        for uid, m in cells.items():
            w = area * m * seen["low"]
            if w.sum() <= 0:  # no mapped area of this crop: the plain mean of the upazila's cells
                w = (m & seen["low"]).astype(float)
            if w.sum() <= 0:
                continue
            lo_v = float((totals["low"] * w).sum() / w.sum())
            hi_v = float((totals["high"] * w).sum() / w.sum())
            result["upazilas"][uid][key] = [round(lo_v, 3), round(hi_v, 3)]
            rows[uid][f"{key}_low"], rows[uid][f"{key}_high"] = round(lo_v, 3), round(hi_v, 3)
            rows[uid][f"{key}_fumigant_low"] = round(float((fumigant["low"] * w).sum() / w.sum()), 3)
            rows[uid][f"{key}_fumigant_high"] = round(float((fumigant["high"] * w).sum() / w.sum()), 3)
        print(f"{cls:8s} ({key}): Bangladesh {national['low']:.2f}-{national['high']:.2f} kg/ha a year without soil "
              f"fumigants ({with_fum['low']:.2f}-{with_fum['high']:.2f} with them) on {area.sum() / 1e6:.2f} Mha; top: "
              + ", ".join(a['name'] for a in per_ai if not a['soilFumigant'])[:60]
              + (f"; not approved: {result['classes'][key]['notApproved']}" if result['classes'][key]['notApproved'] else ""))

    result["source"] = {
        "name": "NASA SEDAC Global Pesticide Grids (PEST-CHEMGRIDS) v1.01",
        "citation": ("Maggi, Tang, la Cecilia & McBratney (2019), Scientific Data 6:170; distributed by NASA SEDAC, "
                     "doi:10.7927/weq9-pv30"),
        "year": 2020,
        "units": ("kg of active ingredient per hectare of the crop per year: the sum of its top 20 ingredients, "
                  "soil fumigants left out"),
        "method": ("area-weighted mean of the 5 arc-minute cells inside each upazila; low and high are the dataset's "
                   "two estimates; soil fumigants (metam, metam potassium, 1,3-dichloropropene, chloropicrin, methyl "
                   "bromide) come from the dataset's US-based model of vegetable farming and are left out"),
        "caution": ("For Bangladesh the rates are a statistical re-analysis of US surveys and FAOSTAT national totals: "
                    "an estimate for comparing crops, not a measurement on any farm."),
    }
    OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fields = ["upazila"] + [f"{k}_{e}" for k in CLASSES.values() for e in ("low", "high", "fumigant_low", "fumigant_high")]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows.values())
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({OUT_JSON.stat().st_size // 1024} kB) and {OUT_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
