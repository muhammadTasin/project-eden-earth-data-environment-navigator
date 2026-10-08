"""District rice yields from NASA data: a model tested on seasons it never saw, and this season's forecast.

Target  : BBS district yield (t/ha, clean rice), Aman and Boro, 2012-13 to 2024-25 (research/bbs/crop_district_panel.csv,
          variant 'total'). BBS's 'YYYY-YY' Aman is the monsoon crop of YYYY; its Boro is harvested in spring YYYY+1.
Features: only what is known on the forecast day.
  Aman, forecast on 25 September (7-9 weeks before the harvest):
    - NASA MODIS NDVI (MOD13Q1 250 m, pixel reliability 0-1) at the district's upazila centres: the composites starting
      on day 225 and 241 (13 and 29 August), their mean and its departure from the district's 2001-2025 mean;
    - NASA POWER at the district point, rain from GPM IMERG: rain 15 June-25 September, the wettest 3 days, dry days
      (under 1 mm) 1 August-25 September, mean maximum and minimum temperature, sunshine and root-zone soil wetness
      1 August-25 September;
  Boro, forecast on 31 March (4-6 weeks before the harvest):
    - NDVI composites starting on day 49 and 65 (18 February and 6 March), mean and departure;
    - mean minimum temperature 15 December-31 January (cold), mean maximum and days at 35 C or more in March,
      sunshine 1 February-31 March, rain 1 January-31 March.
  Each weather feature also enters as its departure from the district's 2001-2025 mean for the same window.
Model   : the yield's departure from the district's own linear trend (fitted on the training seasons only) is predicted
          by LightGBM and by ridge regression; both are tested leave-one-season-out (every season predicted by a model
          that never saw it) against two baselines, the district mean and the district trend.
Output  : research/pilots/yield_model_cv.csv (every held-out prediction),
          research/pilots/yield_forecast.json (skill, and the forecast for each unpublished season)
Usage   : python research/explore/yield_model.py
"""
from __future__ import annotations

import csv
import json
import warnings
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=UserWarning)

ROOT = Path(__file__).resolve().parents[2]
PANEL = ROOT / "research" / "bbs" / "crop_district_panel.csv"
NDVI = ROOT / "research" / "data" / "appeears" / "ndvi_national" / "fieldshift-ndvi-national-20260927-MOD13Q1-061-results.csv"
POWER = ROOT / "research" / "data" / "power" / "daily"
UPAZILAS = ROOT / "research" / "sites" / "upazilas.csv"
NATIONAL = ROOT / "packages" / "rotation-engine" / "src" / "data" / "national_replay.json"
OUT_CV = ROOT / "research" / "pilots" / "yield_model_cv.csv"
OUT_JSON = ROOT / "research" / "pilots" / "yield_forecast.json"
CLIM = range(2001, 2026)
MIN_SKILL = 0.05  # a model must cut the trend's squared error by this much to be used

CROPS = {
    "aman": {"bbs": "Aman rice", "ndvi_doys": (225, 241), "forecast": "09-25",
             "windows": {"rain": ("06-15", "09-25"), "warm": ("08-01", "09-25")}},
    "boro": {"bbs": "Boro rice", "ndvi_doys": (49, 65), "forecast": "03-31",
             "windows": {"rain": ("01-01", "03-31"), "cold": ("12-15", "01-31"), "march": ("03-01", "03-31"), "sun": ("02-01", "03-31")}},
}


def crop_year(crop: str, fy: str) -> int:
    """The calendar year whose features belong to a BBS fiscal year: Aman YYYY, Boro YYYY+1 (harvest year)."""
    y = int(fy[:4])
    return y if crop == "aman" else y + 1


def fy_of(crop: str, year: int) -> str:
    y = year if crop == "aman" else year - 1
    return f"{y}-{str(y + 1)[2:]}"


def window(df: pd.DataFrame, year: int, start: str, end: str) -> pd.DataFrame:
    """Rows from MM-DD start to MM-DD end ending in `year` (a window across New Year starts the year before)."""
    s = pd.Timestamp(f"{year - 1 if start > end else year}-{start}")
    return df.loc[s:pd.Timestamp(f"{year}-{end}")]


def weather_features(crop: str, w: pd.DataFrame, year: int) -> dict:
    rain_col = "IMERG_PRECTOT" if "IMERG_PRECTOT" in w and w["IMERG_PRECTOT"].notna().any() else "PRECTOTCORR"
    rain = w[rain_col].where(w[rain_col].notna(), w["PRECTOTCORR"])
    w = w.assign(rain=rain)
    win = CROPS[crop]["windows"]
    if crop == "aman":
        r = window(w, year, *win["rain"])
        a = window(w, year, *win["warm"])
        if len(r) < 90 or len(a) < 50:
            return {}
        return {"rain": r.rain.sum(), "rain3max": r.rain.rolling(3).sum().max(), "dryDays": int((a.rain < 1).sum()),
                "tmax": a.T2M_MAX.mean(), "tmin": a.T2M_MIN.mean(), "sun": a.ALLSKY_SFC_SW_DWN.mean(), "soil": a.GWETROOT.mean()}
    r, c, m, s = (window(w, year, *win[k]) for k in ("rain", "cold", "march", "sun"))
    if len(r) < 80 or len(c) < 40 or len(m) < 28:
        return {}
    return {"rain": r.rain.sum(), "tminCold": c.T2M_MIN.mean(), "coldDays": int((c.T2M_MIN < 10).sum()),
            "tmaxMarch": m.T2M_MAX.mean(), "hotDays": int((m.T2M_MAX >= 35).sum()), "sun": s.ALLSKY_SFC_SW_DWN.mean()}


def ndvi_table() -> pd.DataFrame:
    """District mean NDVI per composite (year, day of year), from good-quality pixels at the upazila centres."""
    d = pd.read_csv(NDVI, usecols=["ID", "Date", "MOD13Q1_061__250m_16_days_NDVI", "MOD13Q1_061__250m_16_days_pixel_reliability"])
    d = d[d["MOD13Q1_061__250m_16_days_pixel_reliability"].between(0, 1)]
    d["Date"] = pd.to_datetime(d["Date"])
    d["year"], d["doy"] = d.Date.dt.year, d.Date.dt.dayofyear
    district = {r["site_id"]: r["district"] for r in csv.DictReader(open(UPAZILAS, encoding="utf-8"))}
    d["district"] = d.ID.map(district)
    return d.groupby(["district", "year", "doy"])["MOD13Q1_061__250m_16_days_NDVI"].mean().rename("ndvi").reset_index()


def build(crop: str, ndvi: pd.DataFrame, ids: dict[str, str]) -> pd.DataFrame:
    """One row per district and crop year with every feature and its departure from the district's 2001-2025 mean."""
    doys = CROPS[crop]["ndvi_doys"]
    rows = []
    for district, pid in ids.items():
        f = POWER / f"{pid}.parquet"
        if not f.exists():
            continue
        w = pd.read_parquet(f)
        w.index = pd.to_datetime(w.index)
        nd = ndvi[ndvi.district == district]
        for year in range(2001, 2027):
            feats = weather_features(crop, w, year)
            if not feats:
                continue
            # MODIS dates in a leap year start a day earlier for the same composite: match within a day
            vals = [nd[(nd.year == year) & (nd.doy.between(dy - 1, dy))].ndvi.mean() for dy in doys]
            feats["ndvi"] = float(np.nanmean(vals)) if not all(np.isnan(vals)) else np.nan
            rows.append({"district": district, "year": year, **feats})
    df = pd.DataFrame(rows)
    feats = [c for c in df.columns if c not in ("district", "year")]
    clim = df[df.year.isin(CLIM)].groupby("district")[feats].mean()
    for c in feats:
        df[f"{c}Dep"] = df[c] - df.district.map(clim[c])
    return df


def trend_fit(train: pd.DataFrame) -> dict[str, tuple[float, float]]:
    """Each district's linear trend (intercept at 2018, slope a year) on the training seasons."""
    out = {}
    for d, g in train.groupby("district"):
        if len(g) >= 3:
            slope, inter = np.polyfit(g.year - 2018, g.yield_t_ha, 1)
            out[d] = (inter, slope)
        else:
            out[d] = (g.yield_t_ha.mean(), 0.0)
    return out


def models():
    from lightgbm import LGBMRegressor
    from sklearn.linear_model import RidgeCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    return {
        "lightgbm": lambda: LGBMRegressor(n_estimators=250, learning_rate=0.03, num_leaves=7, min_child_samples=20,
                                          subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1, random_state=7),
        "ridge": lambda: make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 30))),
    }


def run(crop: str, ndvi: pd.DataFrame, ids: dict[str, str]) -> tuple[pd.DataFrame, dict]:
    panel = pd.read_csv(PANEL)
    y = panel[(panel.crop == CROPS[crop]["bbs"]) & (panel.variant == "total")][["district", "year", "yield_t_ha"]].copy()
    y["fy"] = y.year
    y["year"] = y.fy.map(lambda fy: crop_year(crop, fy))
    feats = build(crop, ndvi, ids)
    data = y.merge(feats, on=["district", "year"], how="inner").dropna(subset=["ndvi"])
    xcols = [c for c in feats.columns if c.endswith("Dep")]
    mk = models()
    preds = []
    for held in sorted(data.year.unique()):
        train, test = data[data.year != held].copy(), data[data.year == held].copy()
        tr = trend_fit(train)
        for df in (train, test):
            df["trend"] = [tr[d][0] + tr[d][1] * (yr - 2018) for d, yr in zip(df.district, df.year)]
            df["dmean"] = df.district.map(train.groupby("district").yield_t_ha.mean())
        train["dep"] = train.yield_t_ha - train.trend
        out = test[["district", "fy", "year", "yield_t_ha", "trend", "dmean"]].copy()
        for name, make in mk.items():
            m = make().fit(train[xcols], train.dep)
            out[name] = test.trend + m.predict(test[xcols])
        preds.append(out)
    cv = pd.concat(preds, ignore_index=True)

    def score(col: str) -> dict:
        err = cv[col] - cv.yield_t_ha
        return {"maeTPerHa": round(float(err.abs().mean()), 3), "rmseTPerHa": round(float(np.sqrt((err ** 2).mean())), 3)}
    skill = {"districtMean": score("dmean"), "districtTrend": score("trend"), **{n: score(n) for n in mk}}
    mse_trend = float(((cv.trend - cv.yield_t_ha) ** 2).mean())
    for n in mk:
        skill[n]["skillVsTrend"] = round(1 - float(((cv[n] - cv.yield_t_ha) ** 2).mean()) / mse_trend, 3)
    best = max(mk, key=lambda n: skill[n]["skillVsTrend"])
    use = best if skill[best]["skillVsTrend"] >= MIN_SKILL else "districtTrend"

    # Forecast every crop year with features but no published yield, from a model trained on every season
    tr = trend_fit(data)
    data["trend"] = [tr[d][0] + tr[d][1] * (yr - 2018) for d, yr in zip(data.district, data.year)]
    data["dep"] = data.yield_t_ha - data.trend
    final = mk[best]().fit(data[xcols], data.dep) if use != "districtTrend" else None
    published = set(zip(y.district, y.year))
    todo = feats[[(d, yr) not in published and yr > data.year.max() - 1 for d, yr in zip(feats.district, feats.year)]].dropna(subset=["ndvi"]).copy()
    todo = todo[todo.district.isin(tr)]
    todo["trend"] = [tr[d][0] + tr[d][1] * (yr - 2018) for d, yr in zip(todo.district, todo.year)]
    todo["forecast"] = todo.trend + (final.predict(todo[xcols]) if final is not None else 0.0)
    last = y[y.year == y.year.max()].set_index("district").yield_t_ha
    forecasts = {}
    for yr, g in todo.groupby("year"):
        forecasts[fy_of(crop, int(yr))] = {
            d: {"forecastTPerHa": round(float(f), 2), "trendTPerHa": round(float(t), 2), "lastPublishedTPerHa": round(float(last.get(d, np.nan)), 2) if d in last else None,
                "ndviDep": round(float(n), 3) if not np.isnan(n) else None}
            for d, f, t, n in zip(g.district, g.forecast, g.trend, g.ndviDep)}
    cv.insert(0, "crop", crop)
    dep = cv.yield_t_ha - cv.trend
    shared = float(cv.assign(dep=dep).groupby("fy").dep.mean().var() / dep.var())
    return cv, {"skill": skill, "model": use, "sharedVarianceAcrossDistricts": round(shared, 2), "features": xcols, "seasons": [str(s) for s in sorted(data.fy.unique())],
                "rows": int(len(data)), "forecastDay": CROPS[crop]["forecast"], "forecasts": forecasts}


def main() -> None:
    national = json.loads(NATIONAL.read_text(encoding="utf-8"))
    ids = {name: d["id"] for name, d in national["districts"].items()}
    ndvi = ndvi_table()
    out, cvs = {}, []
    for crop in CROPS:
        cv, res = run(crop, ndvi, ids)
        cvs.append(cv)
        out[crop] = res
        s = res["skill"]
        print(f"{crop}: {res['rows']} district-seasons; MAE t/ha mean {s['districtMean']['maeTPerHa']}, trend {s['districtTrend']['maeTPerHa']}, "
              f"lightgbm {s['lightgbm']['maeTPerHa']} (skill {s['lightgbm']['skillVsTrend']}), ridge {s['ridge']['maeTPerHa']} "
              f"(skill {s['ridge']['skillVsTrend']}); using {res['model']}; forecasts for {', '.join(res['forecasts'])}")
    pd.concat(cvs).to_csv(OUT_CV, index=False)
    OUT_JSON.write_text(json.dumps({
        "generatedOn": f"{date.today()}",
        "source": ("BBS district yields 2012-13 to 2024-25; NASA MODIS NDVI (MOD13Q1) at the upazila centres; NASA POWER "
                   "weather and GPM IMERG rain at the district point"),
        "method": ("The yield's departure from the district's own trend, from NDVI and weather departures known on the "
                   "forecast day; tested leave-one-season-out against the district mean and the district trend. "
                   "skillVsTrend = 1 - MSE(model) / MSE(trend): above 0 the model beats the trend."),
        "caution": ("Neither model beats the district trend by 5% on seasons it never saw, so the forecast is the trend. "
                    "BBS yield is per harvested hectare, so a disaster barely moves it (Sunamganj Boro 2016-17: 3.61 t/ha "
                    "as in other years, while production fell from 685,226 t to 196,500 t after the April flash flood), "
                    "and only 12-16% of the departures are shared across districts in a season, so most of it is "
                    "reporting noise. One MODIS pixel per upazila centre is too coarse; rice-masked HLS greenness, "
                    "production as the target and flood extent as a feature are the next tests."),
        "crops": out,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} and {OUT_CV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
