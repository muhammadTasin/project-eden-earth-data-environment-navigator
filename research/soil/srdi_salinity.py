"""Read SRDI's upazila salinity table (Saline Soils of Bangladesh, 2010) into a table the engine can use.

SRDI surveyed the coastal belt's arable land in May 2009, when salt in the soil peaks before the monsoon rain
washes it out, and gives every saline upazila's area in five classes of soil-extract salinity (ECe): S1 2-4 dS/m,
S2 4.1-8, S3 8.1-12, S4 12.1-16 and S5 above 16 (Appendix 2, pages 38-43). Shares here are of the upazila's
cultivated area. Upazila names are matched to the geoBoundaries sites within SRDI's district ("S. Sadar" is the
district's Sadar upazila; close spellings within the district; a few aliases).

Input : research/data/soil/SRDI_Saline_Soils_of_Bangladesh_2010.pdf (the Internet Archive's copy of SRDI's file)
Output: research/soil/srdi_salinity_upazila.csv
Usage : python research/soil/srdi_salinity.py
"""
from __future__ import annotations

import difflib
import re
from pathlib import Path

import pandas as pd
import pdfplumber

RESEARCH = Path(__file__).resolve().parents[1]
PDF = RESEARCH / "data" / "soil" / "SRDI_Saline_Soils_of_Bangladesh_2010.pdf"
OUT = RESEARCH / "soil" / "srdi_salinity_upazila.csv"
PAGES = range(37, 43)  # Appendix 2, pages 38-43 of the PDF
CLASSES = ["s1", "s2", "s3", "s4", "s5"]
DISTRICTS = {"jhalakathi": "Jhalokati", "gopalgonj": "Gopalganj", "laxmipur": "Lakshmipur", "coxsbazar": "Cox's Bazar",
             "borguna": "Barguna"}
ALIASES = {"shudharam": "noakhalisadarsudharam", "charfeshion": "charfasson", "nesarabad": "nesarabadswarupkati", "raipur": "roypur",
           "metro": None, "zianagar": None}  # Khulna city and a renamed upazila (Indurkani) are not geoBoundaries units


def norm(s) -> str:
    return re.sub(r"[^a-z]", "", str(s).lower())


def num(cell) -> float:
    return float(str(cell).replace(",", "").strip() or 0)


def rows() -> list[dict]:
    out, district = [], None
    with pdfplumber.open(PDF) as pdf:
        for i in PAGES:
            for table in pdf.pages[i].extract_tables():
                for r in table:
                    if not r or len(r) < 11 or not r[1] or str(r[1]).startswith(("Upazila", "S1")):
                        continue
                    if r[0]:
                        district = str(r[0]).replace("\n", " ").strip()
                    name = str(r[1]).replace("\n", " ").strip()
                    if name.lower().startswith(("total", "g. total")):
                        continue
                    out.append({"srdi_district": district, "srdi_upazila": name, "total_ha": num(r[2]),
                                "uncultivated_ha": num(r[3]), "cultivated_ha": num(r[4]), "saline_ha": num(r[5]),
                                **{c: num(r[6 + k]) for k, c in enumerate(CLASSES)}})
    return out


def match(srdi: list[dict]) -> list[dict]:
    sites = pd.read_csv(RESEARCH / "sites" / "upazilas.csv")
    by_district = {norm(d): g for d, g in sites.groupby("district")}
    for r in srdi:
        dname = DISTRICTS.get(norm(r["srdi_district"]), r["srdi_district"])
        pool = by_district.get(norm(dname))
        r["district"] = dname
        r["site_id"] = None
        if pool is None:
            continue
        key = norm(r["srdi_upazila"])
        if key in ALIASES:
            if ALIASES[key] is None:
                continue
            key = ALIASES[key]
        names = {norm(n): sid for n, sid in zip(pool.name, pool.site_id)}
        if key in names:
            r["site_id"] = names[key]
        elif key.endswith("sadar") or key == "sadar":  # 'S. Sadar', 'B. Sadar', 'Sadar': the district's own upazila
            seat = [sid for n, sid in names.items() if "sadar" in n]
            r["site_id"] = seat[0] if len(seat) == 1 else None
        else:
            close = difflib.get_close_matches(key, names, n=1, cutoff=0.75)
            r["site_id"] = names[close[0]] if close else None
    return srdi


def main() -> None:
    df = pd.DataFrame(match(rows()))
    cult = df.cultivated_ha.where(df.cultivated_ha > 0)
    df["saline_share"] = (df.saline_ha / cult).clip(upper=1).round(3)
    for c in CLASSES:
        df[f"{c}_share"] = (df[c] / cult).clip(upper=1).round(3)
    df["strong_share"] = ((df.s3 + df.s4 + df.s5) / cult).clip(upper=1).round(3)  # above 8 dS/m
    df["source"] = "SRDI (2010) Saline Soils of Bangladesh, Appendix 2 (survey of May 2009)"
    df.to_csv(OUT, index=False)
    unmatched = df[df.site_id.isna()]
    print(f"wrote {OUT.relative_to(RESEARCH.parent)}: {len(df)} SRDI upazilas, {df.site_id.notna().sum()} matched; "
          f"unmatched: {', '.join(f'{a} ({b})' for a, b in zip(unmatched.srdi_upazila, unmatched.srdi_district))}")


if __name__ == "__main__":
    main()
