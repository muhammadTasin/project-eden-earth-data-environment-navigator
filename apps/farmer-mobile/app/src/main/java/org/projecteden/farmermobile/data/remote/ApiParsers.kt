package org.projecteden.farmermobile.data.remote

import org.json.JSONArray
import org.json.JSONObject
import org.projecteden.farmermobile.data.model.CattleAdvisory
import org.projecteden.farmermobile.data.model.CattleAoi
import org.projecteden.farmermobile.data.model.CattleJob
import org.projecteden.farmermobile.data.model.CattleThiHour
import org.projecteden.farmermobile.data.model.District
import org.projecteden.farmermobile.data.model.ForecastCurrent
import org.projecteden.farmermobile.data.model.ForecastDay
import org.projecteden.farmermobile.data.model.ForecastHour
import org.projecteden.farmermobile.data.model.ForecastResponse
import org.projecteden.farmermobile.data.model.LocationCatalog
import org.projecteden.farmermobile.data.model.ObservationDay
import org.projecteden.farmermobile.data.model.ObservationResponse
import org.projecteden.farmermobile.data.model.SourceInfo
import org.projecteden.farmermobile.data.model.Upazila

/**
 * Parsers for the shared API contract. Missing or null provider values stay null: nothing is defaulted to 0 or to a
 * fixed location. A payload that lacks a required field throws, which the client reports as MALFORMED.
 */
internal fun JSONObject.doubleOrNull(name: String): Double? {
    if (!has(name) || isNull(name)) return null
    val v = optDouble(name, Double.NaN)
    return if (v.isNaN() || v.isInfinite()) null else v
}

internal fun JSONObject.intOrNull(name: String): Int? = doubleOrNull(name)?.toInt()
internal fun JSONObject.stringOrNull(name: String): String? = if (!has(name) || isNull(name)) null else optString(name)

private inline fun <T> JSONArray?.mapObjects(transform: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    val out = ArrayList<T>(length())
    for (i in 0 until length()) out += transform(getJSONObject(i))
    return out
}

internal fun parseSource(json: JSONObject?, fallbackProvider: String): SourceInfo = SourceInfo(
    provider = json?.stringOrNull("provider") ?: fallbackProvider,
    kind = json?.stringOrNull("kind") ?: "unknown",
    live = json?.optBoolean("live", false) ?: false,
    fetchedAt = json?.stringOrNull("fetchedAt"),
    validAt = json?.stringOrNull("validAt"),
    note = json?.stringOrNull("note").orEmpty(),
)

object ApiParsers {
    fun locations(body: String): LocationCatalog {
        val json = JSONObject(body)
        val districts = json.getJSONArray("districts").mapObjects { d ->
            District(
                id = d.getString("id"),
                nameBn = d.getString("nameBn"),
                nameEn = d.getString("nameEn"),
                upazilas = d.getJSONArray("upazilas").mapObjects { u ->
                    Upazila(u.getString("id"), u.getString("nameBn"), u.getString("nameEn"), u.getDouble("lat"), u.getDouble("lon"))
                },
            )
        }
        return LocationCatalog(json.optString("version"), districts)
    }

    fun forecast(body: String): ForecastResponse {
        val json = JSONObject(body)
        val loc = json.getJSONObject("location")
        val f = json.getJSONObject("forecast")
        val c = f.getJSONObject("current")
        return ForecastResponse(
            latitude = loc.getDouble("lat"),
            longitude = loc.getDouble("lon"),
            source = parseSource(json.optJSONObject("source") ?: f.optJSONObject("source"), "Open-Meteo"),
            timezone = f.optString("timezone", ""),
            utcOffsetSeconds = f.getInt("utcOffsetSeconds"),
            current = ForecastCurrent(
                time = c.getString("time"),
                temperatureC = c.getDouble("temperatureC"),
                humidityPct = c.getDouble("relativeHumidityPct"),
                apparentTemperatureC = c.doubleOrNull("apparentTemperatureC"),
                precipitationMm = c.doubleOrNull("precipitationMm"),
                windSpeedMs = c.doubleOrNull("windSpeedMs"),
                weatherCode = c.intOrNull("weatherCode"),
            ),
            hourly = f.optJSONArray("hourly").mapObjects { h ->
                ForecastHour(
                    time = h.getString("time"),
                    temperatureC = h.doubleOrNull("temperatureC"),
                    humidityPct = h.doubleOrNull("relativeHumidityPct"),
                    precipitationMm = h.doubleOrNull("precipitationMm"),
                    precipitationProbabilityPct = h.doubleOrNull("precipitationProbabilityPct"),
                    weatherCode = h.intOrNull("weatherCode"),
                )
            },
            daily = f.optJSONArray("daily").mapObjects { d ->
                ForecastDay(
                    date = d.getString("date"),
                    weatherCode = d.intOrNull("weatherCode"),
                    tempMaxC = d.doubleOrNull("temperatureMaxC"),
                    tempMinC = d.doubleOrNull("temperatureMinC"),
                    precipitationMm = d.doubleOrNull("precipitationMm"),
                    precipitationProbabilityMaxPct = d.doubleOrNull("precipitationProbabilityMaxPct"),
                )
            },
        )
    }

    private fun observationDay(d: JSONObject) = ObservationDay(
        date = d.getString("date"),
        t2m = d.doubleOrNull("t2m"),
        t2mMax = d.doubleOrNull("t2mMax"),
        t2mMin = d.doubleOrNull("t2mMin"),
        rh2m = d.doubleOrNull("rh2m"),
        rainMm = d.doubleOrNull("rainMm"),
        windSpeedMs = d.doubleOrNull("windSpeedMs"),
    )

    fun observations(body: String): ObservationResponse {
        val json = JSONObject(body)
        val loc = json.getJSONObject("location")
        return ObservationResponse(
            latitude = loc.getDouble("lat"),
            longitude = loc.getDouble("lon"),
            source = parseSource(json.optJSONObject("source"), "NASA POWER"),
            latestObservationDate = json.getString("latestObservationDate"),
            windowStart = json.optString("windowStart"),
            windowEnd = json.optString("windowEnd"),
            daysWithData = json.optInt("daysWithData", 0),
            latest = observationDay(json.getJSONObject("latest")),
            meanT2mWindow = json.doubleOrNull("meanT2mWindow"),
            rainWindowMm = json.doubleOrNull("rainWindowMm"),
            rainDaysWithData = json.optInt("rainDaysWithData", 0),
            soilMoistureUnavailableReason = json.optJSONObject("soilMoisture")?.stringOrNull("reason"),
            recentDays = json.optJSONArray("recentDays").mapObjects { observationDay(it) },
        )
    }

    fun cattleAois(body: String): List<CattleAoi> =
        JSONObject(body).getJSONArray("aois").mapObjects { a ->
            CattleAoi(a.getString("aoiId"), a.getString("farmLabel"), a.optDouble("areaHectares", 0.0), a.optBoolean("demo", false))
        }

    fun cattleJobs(body: String): List<CattleJob> =
        JSONObject(body).getJSONArray("jobs").mapObjects { j ->
            val missing = j.optJSONArray("missing").mapObjects { m -> m.optString("input") to m.optString("reason") }
            val errors = j.optJSONArray("errors")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList()
            CattleJob(
                jobId = j.getString("jobId"),
                jobType = j.optString("jobType"),
                status = j.getString("status"),
                errorCode = j.stringOrNull("errorCode"),
                stageMessage = j.optString("stageMessage"),
                stageMessageBangla = j.optString("stageMessageBangla"),
                missing = missing,
                errors = errors,
            )
        }

    fun cattleAdvisory(body: String): CattleAdvisory {
        val a = JSONObject(body).getJSONObject("advisory")
        val measured = a.getJSONObject("measured")
        val thi = a.getJSONObject("derived").getJSONObject("thi")
        val heuristic = a.getJSONObject("heuristic")
        val sat = measured.getJSONObject("satellite")
        val nasa = measured.getJSONObject("nasaPower")
        val forage = a.optJSONObject("forageStatus")
        fun strings(arr: JSONArray?) = if (arr == null) emptyList() else (0 until arr.length()).map { arr.getString(it) }
        return CattleAdvisory(
            aoiId = a.getString("aoiId"),
            farmLabel = a.optString("farmLabel"),
            generatedAt = a.optString("generatedAt"),
            forecastSource = parseSource(measured.getJSONObject("forecast").optJSONObject("source"), "Open-Meteo"),
            nasaStatus = if (nasa.optString("status") == "unavailable") "unavailable" else "ok",
            satelliteStatus = sat.optString("status", "unavailable"),
            satelliteReason = sat.stringOrNull("reason"),
            ndvi = forage?.doubleOrNull("ndviProxy"),
            thiCurrent = thi.getDouble("current"),
            thiCategory = thi.getString("category"),
            thiFormula = thi.optString("formula"),
            thiThresholdNote = thi.optString("thresholdNote"),
            hourly = thi.optJSONArray("hourly").mapObjects { h ->
                CattleThiHour(h.getString("time"), h.getDouble("temperatureC"), h.getDouble("relativeHumidityPct"), h.getDouble("thi"), h.getString("category"))
            },
            hoursMissingInputs = thi.optInt("hoursMissingInputs", 0),
            lowestThiHours = thi.optJSONArray("lowestThiHours")?.let { strings(it) },
            heuristicBasis = heuristic.optString("basis"),
            summaryBangla = heuristic.optString("summaryBangla"),
            summaryEnglish = heuristic.optString("summaryEnglish"),
            bulletsBangla = strings(heuristic.optJSONArray("bulletsBangla")),
            bulletsEnglish = strings(heuristic.optJSONArray("bulletsEnglish")),
            waterDemandLabelBangla = heuristic.optJSONObject("waterDemand")?.optString("labelBangla").orEmpty(),
            supervisedModelAvailable = a.optJSONObject("modelStatus")?.optBoolean("supervisedModelAvailable", false) ?: false,
        )
    }
}
