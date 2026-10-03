"""Write the SRDI Soil Fertility Atlas classes for every upazila for the engine's soil-and-water tips.

The atlas (SRDI 2020, read from its upazila maps into soil/srdi_fertility_upazila.csv) gives each upazila a class for
pH, organic matter, phosphorus, potassium, sulphur, zinc and boron, with the share of the upazila in that class. The
engine turns low organic matter, strong acidity and low zinc or boron into tips beside the rotation.

Output: packages/rotation-engine/src/data/soil_atlas.json, keyed by upazila site id (ADM3_*)
Usage : python research/export/soil_atlas_export.py
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import pandas as pd

RESEARCH = Path(__file__).resolve().parents[1]
OUT = RESEARCH.parent / "packages" / "rotation-engine" / "src" / "data" / "soil_atlas.json"
COLUMNS = {"ph": "ph", "organic_matter": "organicMatter", "p_upland": "phosphorus", "k_upland": "potassium",
           "s_upland": "sulphur", "zn": "zinc", "b": "boron"}


def main() -> None:
    atlas = pd.read_csv(RESEARCH / "soil" / "srdi_fertility_upazila.csv")
    sites = pd.read_csv(RESEARCH / "sites" / "upazilas.csv")
    norm = lambda s: re.sub(r"[^a-z]", "", str(s).lower())
    by_name = {norm(r["upazila"]): r for _, r in atlas.iterrows()}
    out = {}
    for _, s in sites.iterrows():
        r = by_name.get(norm(s["name"]))
        if r is None:
            continue
        out[s["site_id"]] = {key: (None if pd.isna(r[col]) else str(r[col])) for col, key in COLUMNS.items()}
    OUT.write_text(json.dumps({"generatedOn": f"{date.today()}", "source": str(atlas["source"].iloc[0]),
                               "classes": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(RESEARCH.parent)}: {len(out)} upazilas")


if __name__ == "__main__":
    main()
