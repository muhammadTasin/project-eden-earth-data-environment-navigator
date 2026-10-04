#!/usr/bin/env python3
"""
Project EDEN - Earth Engine extraction worker.

Invoked by the Node API (cattle/adapters/earth_engine.ts) as a child process. It prints exactly one JSON
object on stdout and exits 0 for every expected outcome, so the API can map it to an honest status.

  --check-readiness        initialise Earth Engine and report readiness (a real ee.Initialize, not a file check)
  --geojson '<geometry>'   extract MODIS NDVI, SMAP root-zone moisture and IMERG rain for the geometry

Requirements: pip install earthengine-api
Auth (server-side only, never committed):
  - service account: GOOGLE_APPLICATION_CREDENTIALS=/path/key.json (type=service_account), or
  - user credentials from `earthengine authenticate`
Project: EE_PROJECT=<google-cloud-project-with-earth-engine-enabled>
Optional: EE_IMERG_COLLECTION (default NASA/GPM_L3/IMERG_V07)

Honesty rules implemented here:
  * values are only reported when an unmasked pixel exists; otherwise the dataset is reported as no_data
  * validPixelCoveragePct is computed from the actual mask over the AOI, never a constant
  * no date window is silently widened; the observation date of the image used is returned
"""

import argparse
import datetime as dt
import json
import os
import sys

IMERG_DEFAULT = "NASA/GPM_L3/IMERG_V07"


def emit(obj):
    print(json.dumps(obj))
    sys.exit(0)


def load_ee():
    try:
        import ee  # type: ignore
        return ee
    except ImportError:
        emit({
            "status": "missing_dependencies",
            "ready": False,
            "message": "Python package 'earthengine-api' is not installed. Run: pip install earthengine-api",
        })


def initialise(ee):
    project = os.environ.get("EE_PROJECT") or None
    key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    try:
        if key_path and os.path.isfile(key_path):
            with open(key_path) as fh:
                info = json.load(fh)
            if info.get("type") == "service_account":
                creds = ee.ServiceAccountCredentials(info["client_email"], key_path)
                ee.Initialize(creds, project=project or info.get("project_id"))
                return
        ee.Initialize(project=project)
    except Exception as exc:  # noqa: BLE001 - report any init failure as auth_error
        emit({
            "status": "auth_error",
            "ready": False,
            "message": "Earth Engine initialisation failed: %s" % exc,
        })


def reduce_mean(ee, image, band, geom, scale):
    """Mean of `band` over geom plus the fraction of AOI pixels that are unmasked.

    Returns (value, coverage_pct, aggregation). Falls back to a centroid sample when the polygon is smaller than
    a pixel and the area reducer finds no pixel centre inside it; the aggregation field says which was used.
    """
    img = image.select(band)
    reducers = ee.Reducer.mean().combine(ee.Reducer.count(), sharedInputs=True)
    stats = img.reduceRegion(reducer=reducers, geometry=geom, scale=scale, maxPixels=1e8).getInfo() or {}
    value = stats.get(band + "_mean")
    count = stats.get(band + "_count") or 0
    if value is not None and count > 0:
        total = ee.Image.constant(1).rename("one").reduceRegion(
            reducer=ee.Reducer.count(), geometry=geom, scale=scale, maxPixels=1e8
        ).getInfo().get("one") or count
        return value, round(100.0 * count / max(total, count), 1), "mean"

    centroid = geom.centroid(1)
    sample = img.reduceRegion(reducer=ee.Reducer.first(), geometry=centroid, scale=scale).getInfo() or {}
    v = sample.get(band)
    if v is None:
        return None, 0.0, "centroid_sample"
    return v, 100.0, "centroid_sample"


def latest_image(ee, collection_id, geom, days, band):
    end = dt.datetime.utcnow()
    start = end - dt.timedelta(days=days)
    col = (
        ee.ImageCollection(collection_id)
        .filterBounds(geom)
        .filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        .filter(ee.Filter.listContains("system:band_names", band))
    )
    size = col.size().getInfo()
    return col, size


def date_of(ee, image):
    ms = image.get("system:time_start").getInfo()
    return dt.datetime.utcfromtimestamp(ms / 1000.0).strftime("%Y-%m-%d")


def extract_modis(ee, geom):
    cid = "MODIS/061/MOD13A1"
    out = {"key": "MODIS_NDVI", "dataset": cid, "band": "NDVI", "units": "index", "pixelSizeMeters": 500,
           "sourceVersion": "061"}
    col, size = latest_image(ee, cid, geom, 48, "NDVI")
    if size == 0:
        return dict(out, status="no_data", reason="No MOD13A1 composite in the last 48 days over this AOI")

    def mask_q(img):
        # SummaryQA: 0 good, 1 marginal. 2 snow/ice and 3 cloudy are masked out.
        qa = img.select("SummaryQA")
        return img.select("NDVI").multiply(0.0001).updateMask(qa.lte(1)).copyProperties(img, ["system:time_start"])

    imgs = col.sort("system:time_start", False).toList(size)
    for i in range(size):
        img = ee.Image(imgs.get(i))
        masked = mask_q(img)
        value, cov, agg = reduce_mean(ee, masked, "NDVI", geom, 500)
        if value is not None:
            return dict(out, status="ok", value=value, validPixelCoveragePct=cov, aggregationMethod=agg,
                        observationDate=date_of(ee, img))
    return dict(out, status="no_data", reason="All recent MOD13A1 composites are cloud/snow masked over this AOI")


def extract_smap(ee, geom):
    cid = "NASA/SMAP/SPL4SMGP/008"
    out = {"key": "SMAP_ROOTZONE", "dataset": cid, "band": "sm_rootzone", "units": "m3/m3",
           "pixelSizeMeters": 11000, "sourceVersion": "008"}
    col, size = latest_image(ee, cid, geom, 10, "sm_rootzone")
    if size == 0:
        return dict(out, status="no_data", reason="No SMAP L4 image in the last 10 days over this AOI")
    img = ee.Image(col.sort("system:time_start", False).first())
    value, cov, agg = reduce_mean(ee, img, "sm_rootzone", geom, 11000)
    if value is None:
        return dict(out, status="no_data", reason="SMAP root-zone moisture is masked over this AOI")
    return dict(out, status="ok", value=value, validPixelCoveragePct=cov, aggregationMethod=agg,
                observationDate=date_of(ee, img))


def extract_imerg(ee, geom):
    cid = os.environ.get("EE_IMERG_COLLECTION", IMERG_DEFAULT)
    out = {"key": "IMERG_RAIN_30D", "dataset": cid, "band": "precipitation", "units": "mm (30-day total)",
           "pixelSizeMeters": 11132, "sourceVersion": cid.rsplit("_", 1)[-1]}
    col, size = latest_image(ee, cid, geom, 30, "precipitation")
    if size == 0:
        return dict(out, status="no_data",
                    reason="No images in the last 30 days (IMERG Final lags by months; set EE_IMERG_COLLECTION to a Late/Early run)")
    # Each image is a mm/hr rate over 30 minutes.
    total = col.select("precipitation").sum().multiply(0.5)
    value, cov, agg = reduce_mean(ee, total, "precipitation", geom, 11132)
    if value is None:
        return dict(out, status="no_data", reason="IMERG precipitation is masked over this AOI")
    last = ee.Image(col.sort("system:time_start", False).first())
    return dict(out, status="ok", value=value, validPixelCoveragePct=cov, aggregationMethod=agg,
                observationDate=date_of(ee, last), imageCount=size)


def main():
    parser = argparse.ArgumentParser(description="EDEN Earth Engine worker")
    parser.add_argument("--check-readiness", action="store_true")
    parser.add_argument("--geojson", type=str)
    args = parser.parse_args()

    ee = load_ee()
    initialise(ee)

    if args.check_readiness:
        emit({"status": "ready", "ready": True, "message": "Earth Engine initialised"})

    if args.geojson:
        try:
            geom = ee.Geometry(json.loads(args.geojson))
            datasets = []
            for fn in (extract_modis, extract_smap, extract_imerg):
                try:
                    datasets.append(fn(ee, geom))
                except Exception as exc:  # noqa: BLE001 - one failing dataset must not hide the others
                    datasets.append({"key": fn.__name__, "status": "error", "reason": str(exc)})
            emit({"status": "success", "datasets": datasets})
        except Exception as exc:  # noqa: BLE001
            emit({"status": "error", "message": str(exc)})

    emit({"status": "no_action_specified"})


if __name__ == "__main__":
    main()
