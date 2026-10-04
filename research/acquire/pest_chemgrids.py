"""NASA SEDAC Global Pesticide Grids (PEST-CHEMGRIDS; Maggi et al. 2019, Scientific Data 6:170) -> one
archive, cached once.  Needs an Earthdata Login (EARTHDATA_USERNAME / EARTHDATA_PASSWORD in .env).

Version 1.01: yearly application rates (kg of active ingredient per hectare of the crop) of the 20 most used
pesticide active ingredients on 6 dominant crops and 4 crop classes, at 5 arc-minutes (~9 km), estimated for 2015
and projected to 2020 and 2025, each with a low and a high estimate.  The estimates re-analyse USGS county data and
FAOSTAT national totals, so for Bangladesh they are a model's estimate, not a field measurement.  The netCDF
archive is ~2.1 GB; research/explore/pesticide_load.py reads only Bangladesh out of it.

NASA's catalogue (CMR) points at a 'sedac-beta' address that answers 404 (October 2026); the files live under
'sedac-root', which is used below.

Usage: python research/acquire/pest_chemgrids.py [--format netcdf|geotiff]   (run again to resume)
"""
from __future__ import annotations

import argparse
import time

from _common import load_dotenv, out_dir, write_provenance

CONCEPT_ID = "C3540928619-ESDIS"  # CIESIN_SEDAC_FERMANv1_PESTG in NASA's CMR
BASE = ("https://data.earthdata.nasa.gov/nasa-earth/human-dimensions/sedac-root/downloads/data/ferman-v1/"
        "ferman-v1-pest-chemgrids-v1-01/ferman-v1-pest-chemgrids-v1-01-{fmt}.zip")
DOI = "https://doi.org/10.7927/weq9-pv30"
CITATION = ("Maggi, F., Tang, F. H. M., la Cecilia, D. & McBratney, A. (2019). PEST-CHEMGRIDS, global gridded maps "
            "of the top 20 crop-specific pesticide application rates from 2015 to 2025. Scientific Data 6, 170. "
            "Distributed by NASA SEDAC.")


def main() -> None:
    import earthaccess

    ap = argparse.ArgumentParser()
    ap.add_argument("--format", choices=("netcdf", "geotiff"), default="netcdf")
    url = BASE.format(fmt=ap.parse_args().format)
    load_dotenv()
    earthaccess.login(strategy="environment")
    dest = out_dir("sedac", "pest_chemgrids") / url.rsplit("/", 1)[1]
    if dest.exists():
        print("already cached:", dest)
        return
    part = dest.with_name(dest.name + ".part")
    s = earthaccess.get_requests_https_session()
    for attempt in range(1, 31):
        have = part.stat().st_size if part.exists() else 0
        try:
            with s.get(url, stream=True, timeout=120, headers={"Range": f"bytes={have}-"} if have else {}) as r:
                r.raise_for_status()
                if have and r.status_code != 206:  # the server ignored the range: start again
                    have = 0
                total = have + int(r.headers.get("Content-Length", 0))
                t0, got, shown = time.time(), 0, 0
                with open(part, "ab" if have else "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
                        got += len(chunk)
                        if got - shown >= 100 << 20:
                            shown = got
                            rate = got / max(time.time() - t0, 1e-6) / 1e6
                            print(f"{(have + got) / 1e9:.2f} / {total / 1e9:.2f} GB  ({rate:.1f} MB/s)", flush=True)
            if part.stat().st_size >= total > 0:
                break
        except Exception as e:  # dropped connection: resume from what is on disk
            print(f"attempt {attempt}: {type(e).__name__}: {e}; resuming in 10 s", flush=True)
            time.sleep(10)
    else:
        raise SystemExit("download did not finish; run the script again to resume")
    part.rename(dest)
    write_provenance(dest, source="NASA SEDAC Global Pesticide Grids (PEST-CHEMGRIDS) v1.01",
                     cmr_concept_id=CONCEPT_ID, url=url, doi=DOI, citation=CITATION,
                     bytes=dest.stat().st_size)
    print("saved", dest, f"{dest.stat().st_size / 1e9:.2f} GB")


if __name__ == "__main__":
    main()
