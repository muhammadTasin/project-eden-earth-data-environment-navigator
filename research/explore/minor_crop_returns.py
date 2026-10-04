"""Estimated net return for the crops the Agriculture Census cost table leaves out (pulses, sesame, sweet potato).

The research net returns (research/crops/crop_parameters.csv) need a cost per hectare, which BBS prints only for rice,
wheat, maize, jute, potato and onion (Agriculture Census 2019, research/bbs/census_costs.csv).  For the other crops a
farmer can ask for, this estimates:

  crop value  = BBS 2024-25 harvest-time price (research/bbs/harvest_prices.csv, DAM)
                x BBS 2024-25 national yield (research/bbs/crop_district.csv, all 64 districts)
  cost        = 65% of the crop value: the census crops spend 51-66% of their crop value (maize 51%, HYV Aman and Boro
                ~60%, wheat 66%), and farm surveys of lentil (Sultana et al. 2025, Food and Energy Security: benefit-cost
                ratio 1.43, cost 70% of value) and mungbean (cost 62% of value) sit in the same band
  net return  = crop value - cost

Soybean, sunflower and barley have no harvest price in the yearbook, so they stay without an income estimate.
Output: research/crops/minor_crop_returns.csv.  Usage: python research/explore/minor_crop_returns.py
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

R = Path(__file__).resolve().parents[1]
COST_SHARE = 0.65
YEAR = "2024-25"
# engine crop id: (BBS district-table crop, BBS harvest-price item)
CROPS = {
    "chickpea": ("Gram", "Gram"),
    "grasspea": ("Kheshari", "Grass pea (Kheshari)"),
    "mungbean": ("Green gram (Mug)", "Green Gram (Mug)"),
    "sesame": ("Sesame Till (Rabi & Kharif)", "Til"),
    "sweetpotato": ("Sweet Potato", "Sweet.Potato"),
    "soybean": ("Soyabean", None),
    "sunflower": ("Sunflower (Surjamukhi)", None),
    "barley": ("Jab", None),
}


def main() -> None:
    prices = pd.read_csv(R / "bbs" / "harvest_prices.csv").set_index("item")
    district = pd.read_csv(R / "bbs" / "crop_district.csv")
    rows = []
    for cid, (bbs_crop, price_item) in CROPS.items():
        d = district[(district["crop"] == bbs_crop) & (district["year"] == YEAR)]
        yield_t_ha = d["production_t"].sum() / d["area_ha"].sum()
        price = float(prices.loc[price_item, YEAR]) / 100 if price_item else None  # Tk per quintal -> Tk per kg
        value = price * yield_t_ha * 1000 if price else None
        rows.append({"crop": cid, "bbs_crop": bbs_crop, "year": YEAR, "area_ha": round(d["area_ha"].sum()),
                     "yield_t_ha": round(yield_t_ha, 2), "price_tk_kg": round(price, 2) if price else None,
                     "crop_value_tk_ha": round(value) if value else None,
                     "cost_tk_ha": round(value * COST_SHARE) if value else None,
                     "net_return_tk_ha": round(value * (1 - COST_SHARE)) if value else None,
                     "note": "estimate: cost at 65% of crop value" if value else "no BBS harvest price"})
    out = pd.DataFrame(rows)
    out.to_csv(R / "crops" / "minor_crop_returns.csv", index=False)
    print(out.to_string(index=False))


if __name__ == "__main__":
    main()
