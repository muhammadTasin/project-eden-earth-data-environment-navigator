package org.projecteden.farmermobile.weather

import org.projecteden.farmermobile.data.model.CattleAdvisory
import org.projecteden.farmermobile.data.model.CattleAoi
import org.projecteden.farmermobile.data.model.CattleJob
import org.projecteden.farmermobile.data.model.District
import org.projecteden.farmermobile.data.model.ForecastCurrent
import org.projecteden.farmermobile.data.model.ForecastHour
import org.projecteden.farmermobile.data.model.ForecastResponse
import org.projecteden.farmermobile.data.model.LocationCatalog
import org.projecteden.farmermobile.data.model.ObservationDay
import org.projecteden.farmermobile.data.model.ObservationResponse
import org.projecteden.farmermobile.data.model.SourceInfo
import org.projecteden.farmermobile.data.model.Upazila
import org.projecteden.farmermobile.data.remote.EdenApi
import org.projecteden.farmermobile.location.LocationProvider
import org.projecteden.farmermobile.location.LocationResult
import org.projecteden.farmermobile.location.LocationStore
import org.projecteden.farmermobile.location.StoredLocation

val catalog = LocationCatalog(
    version = "test",
    districts = listOf(
        District("D1", "ঢাকা", "Dhaka", listOf(Upazila("U1", "সাভার", "Savar", 23.84, 90.26), Upazila("U2", "ধামরাই", "Dhamrai", 23.91, 90.20))),
        District("D2", "সিলেট", "Sylhet", listOf(Upazila("U3", "সিলেট সদর", "Sylhet Sadar", 24.89, 91.87))),
    ),
)

val source = SourceInfo("Open-Meteo", "model_estimate", true, "2026-10-03T10:00:00Z", "2026-10-03T16:00", "model")

fun forecastFor(lat: Double, lon: Double, tempC: Double = 30.0) = ForecastResponse(
    latitude = lat, longitude = lon, source = source, timezone = "Asia/Dhaka", utcOffsetSeconds = 21600,
    current = ForecastCurrent("2026-10-03T16:00", tempC, 60.0, null, null, null, 1),
    hourly = emptyList<ForecastHour>(), daily = emptyList(),
)

fun observationsFor(lat: Double, lon: Double) = ObservationResponse(
    latitude = lat, longitude = lon,
    source = SourceInfo("NASA POWER", "satellite_delayed", false, null, "2026-09-30", "delayed"),
    latestObservationDate = "2026-09-30", windowStart = "2026-09-01", windowEnd = "2026-09-30", daysWithData = 30,
    latest = ObservationDay("2026-09-30", 28.0, 32.0, 24.0, 80.0, 1.0, 2.0),
    meanT2mWindow = 28.0, rainWindowMm = 100.0, rainDaysWithData = 30, soilMoistureUnavailableReason = "n/a", recentDays = emptyList(),
)

class FakeApi : EdenApi {
    var locations: Result<LocationCatalog> = Result.success(catalog)
    var forecast: (Double, Double) -> Result<ForecastResponse> = { lat, lon -> Result.success(forecastFor(lat, lon)) }
    var observations: (Double, Double) -> Result<ObservationResponse> = { lat, lon -> Result.success(observationsFor(lat, lon)) }
    /** When set, fetchForecast for this latitude suspends until [gate] completes (simulates a slow response). */
    var gateLat: Double? = null
    val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
    val forecastCalls = mutableListOf<Pair<Double, Double>>()
    val observationCalls = mutableListOf<Pair<Double, Double>>()

    override suspend fun fetchLocations() = locations
    override suspend fun fetchForecast(lat: Double, lon: Double): Result<ForecastResponse> {
        forecastCalls += lat to lon
        if (lat == gateLat) gate.await()
        return forecast(lat, lon)
    }
    override suspend fun fetchObservations(lat: Double, lon: Double): Result<ObservationResponse> { observationCalls += lat to lon; return observations(lat, lon) }
    override suspend fun fetchCattleAois(): Result<List<CattleAoi>> = Result.success(emptyList())
    override suspend fun fetchCattleAdvisory(aoiId: String): Result<CattleAdvisory> = Result.failure(IllegalStateException())
    override suspend fun fetchCattleJobs(aoiId: String): Result<List<CattleJob>> = Result.success(emptyList())
}

class FakeLocations(var permission: Boolean = true, var result: LocationResult = LocationResult.Error("none")) : LocationProvider {
    override fun hasLocationPermission() = permission
    override suspend fun getCurrentLocation() = result
}

class MemoryStore(var value: StoredLocation? = null) : LocationStore {
    override fun load() = value
    override fun save(value: StoredLocation?) { this.value = value }
}
