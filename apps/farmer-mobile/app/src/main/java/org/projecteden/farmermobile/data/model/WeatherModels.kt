package org.projecteden.farmermobile.data.model

/** Source labelling exactly as the API sends it (see docs/api-contract.md "Source labelling"). */
data class SourceInfo(
    val provider: String,
    /** observed | model_estimate | satellite_delayed | derived | heuristic */
    val kind: String,
    val live: Boolean,
    val fetchedAt: String?,
    val validAt: String?,
    val note: String,
)

data class Upazila(val id: String, val nameBn: String, val nameEn: String, val lat: Double, val lon: Double)
data class District(val id: String, val nameBn: String, val nameEn: String, val upazilas: List<Upazila>)
data class LocationCatalog(val version: String, val districts: List<District>) {
    val upazilaCount: Int get() = districts.sumOf { it.upazilas.size }
    fun findUpazila(id: String): Pair<District, Upazila>? {
        for (d in districts) d.upazilas.firstOrNull { it.id == id }?.let { return d to it }
        return null
    }
}

data class ForecastCurrent(
    /** Zone-naive local time, e.g. 2026-10-03T22:00 */
    val time: String,
    val temperatureC: Double,
    val humidityPct: Double,
    val apparentTemperatureC: Double?,
    val precipitationMm: Double?,
    val windSpeedMs: Double?,
    val weatherCode: Int?,
)

data class ForecastHour(
    val time: String,
    val temperatureC: Double?,
    val humidityPct: Double?,
    val precipitationMm: Double?,
    val precipitationProbabilityPct: Double?,
    val weatherCode: Int?,
)

data class ForecastDay(
    val date: String,
    val weatherCode: Int?,
    val tempMaxC: Double?,
    val tempMinC: Double?,
    val precipitationMm: Double?,
    val precipitationProbabilityMaxPct: Double?,
)

/** Open-Meteo numerical weather-model estimate for exactly the requested coordinates. */
data class ForecastResponse(
    val latitude: Double,
    val longitude: Double,
    val source: SourceInfo,
    val timezone: String,
    val utcOffsetSeconds: Int,
    val current: ForecastCurrent,
    val hourly: List<ForecastHour>,
    val daily: List<ForecastDay>,
)

data class ObservationDay(
    val date: String,
    val t2m: Double?,
    val t2mMax: Double?,
    val t2mMin: Double?,
    val rh2m: Double?,
    val rainMm: Double?,
    val windSpeedMs: Double?,
)

/** NASA POWER delayed observations. Never live, never a forecast, no soil moisture. */
data class ObservationResponse(
    val latitude: Double,
    val longitude: Double,
    val source: SourceInfo,
    val latestObservationDate: String,
    val windowStart: String,
    val windowEnd: String,
    val daysWithData: Int,
    val latest: ObservationDay,
    val meanT2mWindow: Double?,
    val rainWindowMm: Double?,
    val rainDaysWithData: Int,
    val soilMoistureUnavailableReason: String?,
    val recentDays: List<ObservationDay>,
)

// ---- Cattle AOI advisory (read-only view of what the website created) --------------------------------

data class CattleAoi(val id: String, val label: String, val areaHectares: Double, val demo: Boolean)

data class CattleJob(
    val jobId: String,
    val jobType: String,
    /** queued | running | succeeded | partial | failed | blocked */
    val status: String,
    val errorCode: String?,
    val stageMessage: String,
    val stageMessageBangla: String,
    val missing: List<Pair<String, String>>,
    val errors: List<String>,
)

data class CattleThiHour(val time: String, val temperatureC: Double, val humidityPct: Double, val thi: Double, val category: String)

data class CattleAdvisory(
    val aoiId: String,
    val farmLabel: String,
    val generatedAt: String,
    // measured
    val forecastSource: SourceInfo,
    val nasaStatus: String,
    val satelliteStatus: String,
    val satelliteReason: String?,
    val ndvi: Double?,
    // derived
    val thiCurrent: Double,
    val thiCategory: String,
    val thiFormula: String,
    val thiThresholdNote: String,
    val hourly: List<CattleThiHour>,
    val hoursMissingInputs: Int,
    val lowestThiHours: List<String>?,
    // heuristic
    val heuristicBasis: String,
    val summaryBangla: String,
    val summaryEnglish: String,
    val bulletsBangla: List<String>,
    val bulletsEnglish: List<String>,
    val waterDemandLabelBangla: String,
    val supervisedModelAvailable: Boolean,
)
