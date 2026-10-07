"""Weather that favours the two diseases that draw the most fungicide in Bangladesh, from NASA POWER daily data.

The rules mark a day as disease weather; they do not say the disease is in the field. They are used two ways:
research/explore/disease_climatology.py counts such days in each crop's susceptible window over 25 seasons (the
pest score), and research/live/daily_update.py counts them in the last 7 days (this week's advice: scout, or skip a
precautionary spray).

Both diseases need the leaves to stay wet. NASA POWER gives the day's minimum and maximum temperature and its dew
point, so the hours at or above 90% humidity are estimated by letting the temperature follow a cosine between the
minimum and the maximum: humidity is 90% or more whenever the air is cooler than the temperature at which the day's
dew point gives 90%.

  Rice blast (Pyricularia oryzae): leaves wet for 10 hours or more at 15-26 C (Japan's BLASTAM model counts wet
    periods of 10 hours or more at 15-25 C; IRRI's Rice Knowledge Bank names humidity of 90% or more and
    17-28 C). Susceptible windows: Aman 15 Sep-15 Nov (booting to grain fill), Boro 1 Feb-15 Apr. Daily means under-
    read the dewy nights behind neck blast in Boro, so Boro counts are a lower bound.
  Potato late blight (Phytophthora infestans): the Hutton criteria used for blight warnings in the UK since 2017,
    two days running, each with a minimum of 10 C or more and at least 6 hours at 90% humidity; the second day of
    such a pair is a late-blight day. Window: 15 Nov-28 Feb.
"""
from __future__ import annotations

import math

RULES = {
    "riceBlast": {
        "host": "rice", "nameBn": "ধানের ব্লাস্ট রোগ", "nameEn": "Rice blast",
        "windows": {"aman": ("09-15", "11-15"), "boro": ("02-01", "04-15")},
        "basis": "leaves wet 10 hours or more at 15-26 C (BLASTAM; IRRI Rice Knowledge Bank)",
    },
    "lateBlight": {
        "host": "potato", "nameBn": "আলুর নাবি ধসা (লেট ব্লাইট)", "nameEn": "Potato late blight",
        "windows": {"potato": ("11-15", "02-28")},
        "basis": "Hutton criteria (AHDB, 2017): two days running with a minimum of 10 C or more and 6 hours at 90% humidity",
    },
}
BLAST_WET_HOURS, BLAST_TEMP = 10.0, (15.0, 26.0)
HUTTON_MIN_C, HUTTON_HOURS = 10.0, 6.0


def svp(t: float) -> float:
    """Saturation vapour pressure (hPa), Magnus formula over water."""
    return 6.112 * math.exp(17.62 * t / (243.12 + t))


def temp_at_rh(tdew: float, rh: float = 90.0) -> float:
    """The air temperature at which the humidity is `rh` for this dew point."""
    x = math.log(svp(tdew) * 100 / rh / 6.112)
    return 243.12 * x / (17.62 - x)


def humid_hours(tmin, tmax, tdew, rh: float = 90.0) -> tuple[float, float | None]:
    """Hours a day at or above `rh` humidity, and the mean temperature over them (None when there are none)."""
    if None in (tmin, tmax, tdew):
        return 0.0, None
    t90 = temp_at_rh(tdew, rh)
    if t90 <= tmin:
        return 0.0, None
    if t90 >= tmax or tmax <= tmin:
        return 24.0, (tmin + tmax) / 2
    mid, amp = (tmin + tmax) / 2, (tmax - tmin) / 2
    return 24 * math.acos(max(-1.0, min(1.0, (mid - t90) / amp))) / math.pi, (tmin + t90) / 2


def blast_day(tmin, tmax, tdew) -> bool:
    hours, wet_t = humid_hours(tmin, tmax, tdew)
    return hours >= BLAST_WET_HOURS and wet_t is not None and BLAST_TEMP[0] <= wet_t <= BLAST_TEMP[1]


def hutton_day(tmin, tmax, tdew) -> bool:
    return tmin is not None and tmin >= HUTTON_MIN_C and humid_hours(tmin, tmax, tdew)[0] >= HUTTON_HOURS


def in_window(mmdd: str, window: tuple[str, str]) -> bool:
    a, b = window
    return a <= mmdd <= b if a <= b else (mmdd >= a or mmdd <= b)


def season_of(rule: str, mmdd: str) -> str | None:
    """The susceptible window a day falls in for a rule, or None outside them."""
    return next((name for name, w in RULES[rule]["windows"].items() if in_window(mmdd, w)), None)


def flags(days: list[dict]) -> dict[str, list[bool]]:
    """Per day (oldest first; keys tmin, tmax, tdew) whether it is blast weather and a late-blight day."""
    blast = [blast_day(d.get("tmin"), d.get("tmax"), d.get("tdew")) for d in days]
    hutton = [hutton_day(d.get("tmin"), d.get("tmax"), d.get("tdew")) for d in days]
    late = [i > 0 and hutton[i] and hutton[i - 1] for i in range(len(days))]
    return {"riceBlast": blast, "lateBlight": late}


def status(days7: int) -> str:
    """Days of disease weather in the last 7: 3 or more is high, 1-2 is watch, none is low."""
    return "high" if days7 >= 3 else "watch" if days7 >= 1 else "low"
