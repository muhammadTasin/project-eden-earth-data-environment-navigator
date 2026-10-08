"""This week's field water and weather for every upazila: the numbers behind the crop-stage alerts (a dry spell at
Aman flowering, AWD in Boro, cold on Boro seedbeds, heat at rice flowering and wheat grain filling). The rules that
read them are in packages/rotation-engine/src/field_alerts.ts; research/live/daily_update.py calls this.

Observed, NASA:
  - reference evapotranspiration, FAO-56 Penman-Monteith from POWER's temperature, dew point, wind, pressure and
    sunshine; Hargreaves (FAO-56 eq. 52) from temperature alone on days POWER's sunshine has not arrived yet;
  - rain from GPM IMERG at 0.1 degree where the parquet covers the day, divided by the median Late/Final ratio
    (the near-real-time runs read drier than the Final run the replay used), and from NASA POWER otherwise.
Forecast, not NASA: Open-Meteo's weather model for the next 7 days (maximum and minimum temperature, rain and its
FAO-56 reference evapotranspiration), and for the days between POWER's latest day and today.

A rainfed bunded paddy's standing water is run through all of it with the replay's water balance
(research/explore/connect_check.py): crop use at Kc 1.2, 2 mm/day seepage while water stands, 10 cm bunds, a floor
of -60 mm, from 40 days back with 50 mm standing. A day ending with no standing water is a dry day; 5 or more from
20 days before to 10 days after flowering is the replay's rescue-irrigation season.
"""
from __future__ import annotations

import math
import sys
import time
from datetime import date, timedelta

import requests

SEEPAGE, BUND, START_WATER, FLOOR = 2.0, 100.0, 50.0, -60.0  # as in research/explore/connect_check.py
KC_RICE = 1.2  # FAO-56 Table 12, rice mid-season (research/crops/crop_parameters.csv)
SPIN_DAYS = 40
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
FORECAST_DAYS = 7
GAP_DAYS = 5  # Open-Meteo's past days asked for, to cover POWER's lag
BATCH = 50  # locations per Open-Meteo request
POWER_EXTRA = ["ALLSKY_SFC_SW_DWN", "WS2M", "PS"]  # for Penman-Monteith, on top of temperature and dew point
METHOD = ("Observed: FAO-56 Penman-Monteith reference ET from NASA POWER (Hargreaves on days without POWER sunshine), "
          "rain from GPM IMERG at 0.1 degree divided by the median Late/Final ratio, NASA POWER where IMERG is missing. "
          "Forecast: Open-Meteo's weather model (not NASA), 7 days, and the 1-3 days between POWER's latest day and "
          "today. Paddy: the replay's rainfed water balance (Kc 1.2, 2 mm/day seepage, 10 cm bunds) from 40 days "
          "back; a dry day ends with no standing water.")


def svp(t: float) -> float:
    return 0.6108 * math.exp(17.27 * t / (t + 237.3))


def ra_mj(lat: float, doy: int) -> float:
    """Extraterrestrial radiation (MJ/m2/day), FAO-56 eq. 21."""
    phi = math.radians(lat)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365)
    dec = 0.409 * math.sin(2 * math.pi * doy / 365 - 1.39)
    ws = math.acos(-math.tan(phi) * math.tan(dec))
    return 24 * 60 / math.pi * 0.0820 * dr * (ws * math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.sin(ws))


def et0(day: date, lat: float, tmax, tmin, tdew=None, rs=None, u2=None, ps=None) -> float | None:
    """Reference evapotranspiration (mm/day): Penman-Monteith with the full set, Hargreaves from temperature alone."""
    if tmax is None or tmin is None:
        return None
    ra = ra_mj(lat, day.timetuple().tm_yday)
    tmean = (tmax + tmin) / 2
    if None not in (tdew, rs, u2, ps):
        es, ea = (svp(tmax) + svp(tmin)) / 2, svp(tdew)
        delta = 4098 * svp(tmean) / (tmean + 237.3) ** 2
        gamma = 0.000665 * ps
        rso = 0.75 * ra
        rnl = 4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * math.sqrt(ea)) * \
            (1.35 * min(max(rs / rso, 0.3), 1.0) - 0.35)
        rn = 0.77 * rs - rnl
        v = (0.408 * delta * rn + gamma * 900 / (tmean + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))
    else:
        v = 0.0023 * (tmean + 17.8) * math.sqrt(max(tmax - tmin, 0.0)) * 0.408 * ra
    return round(max(v, 0.0), 2)


def paddy(rain: list[float], etc: list[float], start: float = START_WATER) -> list[float]:
    """Standing water (mm) at the end of each day in a rainfed bunded paddy; below 0 the soil is drying."""
    s, out = start, []
    for p, e in zip(rain, etc):
        s = min(s + p - e - (SEEPAGE if s > 0 else 0.0), BUND)
        s = max(s, FLOOR)
        out.append(round(s, 1))
    return out


def open_meteo(points: list[tuple[float, float]], past_days: int = GAP_DAYS) -> list[dict | None]:
    """Daily forecast for many points, in their order; None where a batch failed."""
    out: list[dict | None] = []
    for i in range(0, len(points), BATCH):
        chunk = points[i:i + BATCH]
        q = {"latitude": ",".join(f"{la:.3f}" for la, _ in chunk), "longitude": ",".join(f"{lo:.3f}" for _, lo in chunk),
             "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration",
             "past_days": past_days, "forecast_days": FORECAST_DAYS, "timezone": "Asia/Dhaka"}
        got = None
        for attempt in range(3):
            try:
                r = requests.get(OPEN_METEO, params=q, timeout=60)
                r.raise_for_status()
                js = r.json()
                got = js if isinstance(js, list) else [js]
                break
            except (requests.RequestException, ValueError) as e:
                print(f"  Open-Meteo batch {i // BATCH + 1} retry after: {e}", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        out.extend(got if got and len(got) == len(chunk) else [None] * len(chunk))
        time.sleep(1)
    return out


def _om_days(om: dict | None) -> dict[date, dict]:
    if not om or "daily" not in om:
        return {}
    d = om["daily"]
    return {date.fromisoformat(t): {"tmax": d["temperature_2m_max"][k], "tmin": d["temperature_2m_min"][k],
                                    "rain": d["precipitation_sum"][k], "et0": d["et0_fao_evapotranspiration"][k]}
            for k, t in enumerate(d["time"])}


def field_block(lat: float, latest_d: date, today: date, power: dict[str, dict], imerg_rain, om: dict | None) -> dict:
    """The field record for one upazila.

    power: {param: {YYYYMMDD: value}} at the upazila's POWER point; imerg_rain(day) -> scaled IMERG rain or None;
    om: this point's Open-Meteo answer (past days and forecast) or None.
    """
    def pv(param: str, d: date):
        v = power.get(param, {}).get(f"{d:%Y%m%d}")
        return None if v is None or v <= -998 else v

    om_days = _om_days(om)
    days, rain, et, tmax, tmin, sources = [], [], [], [], [], set()
    end = today - timedelta(days=1) if om_days else latest_d
    d = latest_d - timedelta(days=SPIN_DAYS - 1)
    while d <= end:
        if d <= latest_d:
            e = et0(d, lat, pv("T2M_MAX", d), pv("T2M_MIN", d), pv("T2MDEW", d), pv("ALLSKY_SFC_SW_DWN", d), pv("WS2M", d), pv("PS", d))
            hi, lo, fallback_rain = pv("T2M_MAX", d), pv("T2M_MIN", d), pv("PRECTOTCORR", d)
        else:
            m = om_days.get(d, {})
            e, hi, lo, fallback_rain = m.get("et0"), m.get("tmax"), m.get("tmin"), m.get("rain")
        r = imerg_rain(d)
        if r is not None:
            sources.add("IMERG")
        elif fallback_rain is not None:
            r = fallback_rain
            sources.add("POWER" if d <= latest_d else "Open-Meteo")
        days.append(d)
        rain.append(r if r is not None else 0.0)
        et.append(e)
        tmax.append(hi)
        tmin.append(lo)
        d += timedelta(days=1)
    known = [x for x in et if x is not None]
    fill = sum(known) / len(known) if known else 4.0
    etc = [KC_RICE * (x if x is not None else fill) for x in et]
    water = paddy(rain, etc)

    rec = {
        "through": f"{end}", "observedTo": f"{latest_d}",
        "rainSource": "+".join(sorted(sources)) or None,
        "rain7": round(sum(rain[-7:]), 1), "rain14": round(sum(rain[-14:]), 1),
        "et0Mm7": round(sum((x if x is not None else fill) for x in et[-7:]) / 7, 1),
        "tmax3": max((x for x in tmax[-3:] if x is not None), default=None),
        "tmin3": min((x for x in tmin[-3:] if x is not None), default=None),
        "paddyWaterMm": water[-1],
        "paddyDry14": "".join("1" if s <= 0 else "0" for s in water[-14:]),
        "forecast": None, "paddyDryNext7": None,
    }
    ahead = [om_days[today + timedelta(days=k)] for k in range(FORECAST_DAYS) if today + timedelta(days=k) in om_days]
    if len(ahead) == FORECAST_DAYS:
        rec["forecast"] = {"from": f"{today}", **{k: [a[k] for a in ahead] for k in ("tmax", "tmin", "rain", "et0")}}
        nxt = paddy([a["rain"] or 0.0 for a in ahead], [KC_RICE * (a["et0"] if a["et0"] is not None else fill) for a in ahead], start=water[-1])
        rec["paddyDryNext7"] = "".join("1" if s <= 0 else "0" for s in nxt)
    return rec
