"""How much Boro land each district would move to a water-saving winter crop to stop its groundwater falling.

Inputs:
  - NASA GLDAS-2.2 groundwater storage (GRACE-assimilated), the trend per district point, 2003-07 to 2021-25, in mm
    of water a year over the district (packages/rotation-engine/src/data/national_replay.json);
  - Boro area per district, BBS 2024-25 (research/bbs/crop_district_panel.csv, variant 'total');
  - the district replay's net irrigation for Boro (BRRI dhan28) and for lentil (BARI Masur-8) and mustard
    (BARI Sarisha-14), NASA POWER + GPM IMERG, FAO-56 (national_replay.json);
  - each district's area from the upazila outlines (geoBoundaries ADM3, simplified; sinusoidal projection).
Method: the yearly fall (mm x area) is the extra water pumped beyond what the aquifer gets back. Each hectare of
Boro moved to lentil saves (Boro - lentil) net irrigation; the hectares to move = fall / saving, as a share of the
district's Boro land (mustard alongside). Where Boro covers less than a tenth of the district (the hill districts),
pumping for Boro is not the main draw, and where the fall is under 4 mm a year (the east and south, where much Boro
is watered from rivers and beels) the budget would mostly measure surface water: both are marked as not applying.
GRACE averages over hundreds of kilometres and GLDAS downscales it, so a
district's trend is smooth: wells in the Barind tract fall faster, and this is a floor, not a well-by-well budget.
Output: packages/rotation-engine/src/data/groundwater_budget.json, research/pilots/groundwater_budget.csv
Usage : python research/explore/groundwater_budget.py
"""
from __future__ import annotations

import csv
import json
import math
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
NATIONAL = ROOT / "packages" / "rotation-engine" / "src" / "data" / "national_replay.json"
PANEL = ROOT / "research" / "bbs" / "crop_district_panel.csv"
OUTLINES = ROOT / "research" / "data" / "boundaries" / "BGD_ADM3_simplified.geojson"
CENTROIDS = ROOT / "research" / "sites" / "adm3_centroids.csv"
UPAZILAS = ROOT / "research" / "sites" / "upazilas.csv"
OUT_JSON = ROOT / "packages" / "rotation-engine" / "src" / "data" / "groundwater_budget.json"
OUT_CSV = ROOT / "research" / "pilots" / "groundwater_budget.csv"
BBS_YEAR = "2024-25"
MIN_BORO_SHARE = 0.10  # Boro on less of the district's area: the budget does not apply
MIN_FALL_MM = 4.0  # a slower fall: much of the Boro may be watered from rivers and beels
R = 6_371_008.8  # mean Earth radius, m


def ring_area(ring: list) -> float:
    """Area (m2) of a lon/lat ring in the sinusoidal projection (equal-area), by the shoelace formula."""
    pts = [(math.radians(lon) * R * math.cos(math.radians(lat)), math.radians(lat) * R) for lon, lat in ring]
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))) / 2


def poly_area(geom: dict) -> float:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return sum(ring_area(p[0]) - sum(ring_area(h) for h in p[1:]) for p in polys)


def district_areas_ha() -> dict[str, float]:
    sid = pd.read_csv(CENTROIDS).set_index("shape_id")["site_id"].to_dict()
    district = {r["site_id"]: r["district"] for r in csv.DictReader(open(UPAZILAS, encoding="utf-8"))}
    out: dict[str, float] = {}
    for f in json.loads(OUTLINES.read_text(encoding="utf-8"))["features"]:
        d = district.get(sid.get(f["properties"]["shapeID"], ""))
        if d:
            out[d] = out.get(d, 0.0) + poly_area(f["geometry"]) / 1e4
    return out


def main() -> None:
    national = json.loads(NATIONAL.read_text(encoding="utf-8"))
    panel = pd.read_csv(PANEL)
    boro = panel[(panel.crop == "Boro rice") & (panel.variant == "total") & (panel.year == BBS_YEAR)].set_index("district")["area_ha"]
    areas = district_areas_ha()
    rows = []
    for name, d in sorted(national["districts"].items()):
        gw = d["conditions"].get("groundwater") or {}
        trend = gw.get("trendMmPerYear")
        rabi = d.get("rabi", {})
        b, lentil, mustard = (rabi.get(k, {}).get("netIrrigationMm") for k in ("BRRI dhan28", "BARI Masur-8", "BARI Sarisha-14"))
        area, boro_ha = areas.get(name), boro.get(name)
        if trend is None or None in (b, lentil, mustard) or not area or pd.isna(boro_ha):
            continue
        fall_m3 = max(0.0, -trend) / 1000 * area * 1e4  # m3 a year
        save_lentil, save_mustard = (b - lentil) * 10, (b - mustard) * 10  # m3 per hectare moved
        ha_lentil = fall_m3 / save_lentil if save_lentil > 0 else None
        ha_mustard = fall_m3 / save_mustard if save_mustard > 0 else None
        pumped_m3 = boro_ha * b * 10
        rows.append({
            "district": name, "trendMmPerYear": trend, "period": gw.get("period"), "areaHa": round(area),
            "boroHa": int(boro_ha), "boroYear": BBS_YEAR, "boroShareOfArea": round(boro_ha / area, 3),
            "applies": bool(boro_ha / area >= MIN_BORO_SHARE and trend <= -MIN_FALL_MM),
            "boroNetIrrigationMm": b, "lentilNetIrrigationMm": lentil, "mustardNetIrrigationMm": mustard,
            "fallM3PerYear": round(fall_m3), "boroPumpedM3PerYear": round(pumped_m3),
            "fallShareOfBoroPumping": round(fall_m3 / pumped_m3, 3) if pumped_m3 else None,
            "moveHaToLentil": round(ha_lentil) if ha_lentil is not None else None,
            "moveShareToLentil": round(ha_lentil / boro_ha, 3) if ha_lentil is not None and boro_ha else None,
            "moveHaToMustard": round(ha_mustard) if ha_mustard is not None else None,
            "moveShareToMustard": round(ha_mustard / boro_ha, 3) if ha_mustard is not None and boro_ha else None,
        })
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(OUT_CSV, index=False)
    out = {
        "generatedOn": f"{date.today()}",
        "source": ("NASA GLDAS-2.2 groundwater storage (GRACE-assimilated) trend per district point; BBS Boro area "
                   f"{BBS_YEAR}; net irrigation from the district's NASA POWER + GPM IMERG replay (FAO-56)"),
        "method": ("The yearly fall in groundwater storage (mm of water over the district's area) is the water pumped "
                   "beyond what the aquifer gets back. Each hectare of Boro moved to lentil saves Boro's net "
                   "irrigation minus lentil's; hectares to move = the fall / that saving."),
        "caution": ("GRACE sees hundreds of kilometres and GLDAS downscales it to 0.25 degree, so the trend is a "
                    "smooth district average; Barind wells fall faster, so the area to move is a floor. Net "
                    "irrigation leaves out canal and surface-water Boro and the water that seeps back."),
        "districts": {r["district"]: {k: v for k, v in r.items() if k != "district"} for r in rows},
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=0, separators=(",", ":")), encoding="utf-8")
    top = sorted((r for r in rows if r["applies"]), key=lambda r: -(r["moveShareToLentil"] or 0))[:6]
    print(f"wrote {OUT_JSON.relative_to(ROOT)}: {len(rows)} districts")
    for r in top:
        print(f"  {r['district']:<12} falls {r['trendMmPerYear']} mm/yr = {r['fallM3PerYear'] / 1e6:.1f} Mm3; Boro {r['boroHa']} ha; "
              f"move {r['moveHaToLentil']} ha ({r['moveShareToLentil']:.0%}) to lentil, {r['moveShareToMustard']:.0%} to mustard")


if __name__ == "__main__":
    main()
