package org.projecteden.farmermobile.ui.screens.weather

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.projecteden.farmermobile.data.model.District
import org.projecteden.farmermobile.data.model.ForecastResponse
import org.projecteden.farmermobile.data.model.LocationCatalog
import org.projecteden.farmermobile.data.model.ObservationResponse
import org.projecteden.farmermobile.data.model.Upazila
import org.projecteden.farmermobile.data.remote.ApiErrorKind
import org.projecteden.farmermobile.data.remote.EdenApi
import org.projecteden.farmermobile.data.remote.apiErrorKind
import org.projecteden.farmermobile.location.BangladeshBounds
import org.projecteden.farmermobile.location.LocationProvider
import org.projecteden.farmermobile.location.LocationResult
import org.projecteden.farmermobile.location.LocationStore
import org.projecteden.farmermobile.location.StoredLocation
import kotlin.math.round

/** A location the weather is requested for. The coordinates here are exactly what is sent to the API. */
sealed class WeatherTarget {
    abstract val latitude: Double
    abstract val longitude: Double
    abstract val key: String

    data class Admin(val district: District, val upazila: Upazila) : WeatherTarget() {
        override val latitude get() = upazila.lat
        override val longitude get() = upazila.lon
        override val key get() = "upazila:${upazila.id}"
    }

    data class Gps(override val latitude: Double, override val longitude: Double, val approximate: Boolean) : WeatherTarget() {
        override val key get() = "gps:$latitude,$longitude"
    }
}

sealed interface CatalogState {
    data object Loading : CatalogState
    data class Ready(val catalog: LocationCatalog) : CatalogState
    data class Failed(val kind: ApiErrorKind) : CatalogState
}

/**
 * One independently loaded piece of data. [Failed.stale] holds the previous result ONLY for the same location, so data
 * for another location is never shown.
 */
sealed interface Section<out T> {
    data object Idle : Section<Nothing>
    data class Loading<T>(val stale: T? = null) : Section<T>
    data class Ready<T>(val data: T) : Section<T>
    data class Failed<T>(val kind: ApiErrorKind, val stale: T? = null) : Section<T>
}

enum class LocationNotice { PERMISSION_DENIED, GPS_DISABLED, GPS_UNAVAILABLE, OUTSIDE_BANGLADESH, LOCATING }

data class WeatherState(
    val catalog: CatalogState = CatalogState.Loading,
    val target: WeatherTarget? = null,
    val forecast: Section<ForecastResponse> = Section.Idle,
    val observations: Section<ObservationResponse> = Section.Idle,
    val notice: LocationNotice? = null,
)

/**
 * All weather/location logic, free of Android classes so it is unit-tested on the JVM. WeatherViewModel wraps it.
 *  - there is no default farm: with no stored choice the user is asked to pick a district/upazila or use GPS
 *  - the forecast (Open-Meteo model estimate) and NASA POWER (delayed observations) load independently
 *  - a failure keeps stale data only for the same location; switching location clears everything first
 */
class WeatherController(
    private val api: EdenApi,
    private val locations: LocationProvider,
    private val store: LocationStore,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(WeatherState())
    val state: StateFlow<WeatherState> = _state.asStateFlow()

    private var loadJob: Job? = null

    fun start() {
        loadCatalog()
    }

    fun retryCatalog() = loadCatalog()

    private fun loadCatalog() {
        _state.update { it.copy(catalog = CatalogState.Loading) }
        scope.launch {
            api.fetchLocations().fold(
                onSuccess = { catalog ->
                    _state.update { it.copy(catalog = CatalogState.Ready(catalog)) }
                    restoreStoredTarget(catalog)
                },
                onFailure = { err -> _state.update { it.copy(catalog = CatalogState.Failed(err.apiErrorKind())) } },
            )
        }
    }

    private fun restoreStoredTarget(catalog: LocationCatalog) {
        if (_state.value.target != null) return
        when (val saved = store.load()) {
            is StoredLocation.UpazilaChoice -> catalog.findUpazila(saved.upazilaId)?.let { (d, u) -> setTarget(WeatherTarget.Admin(d, u), persist = false) }
            is StoredLocation.GpsChoice -> if (BangladeshBounds.contains(saved.latitude, saved.longitude)) {
                setTarget(WeatherTarget.Gps(saved.latitude, saved.longitude, approximate = true), persist = false)
            }
            null -> {}
        }
    }

    fun selectUpazila(districtId: String, upazilaId: String) {
        val catalog = (_state.value.catalog as? CatalogState.Ready)?.catalog ?: return
        val district = catalog.districts.firstOrNull { it.id == districtId } ?: return
        val upazila = district.upazilas.firstOrNull { it.id == upazilaId } ?: return
        setTarget(WeatherTarget.Admin(district, upazila), persist = true)
    }

    /** Call with the outcome of the device location request. */
    fun useGps() {
        if (!locations.hasLocationPermission()) {
            _state.update { it.copy(notice = LocationNotice.PERMISSION_DENIED) }
            return
        }
        _state.update { it.copy(notice = LocationNotice.LOCATING) }
        scope.launch {
            when (val result = locations.getCurrentLocation()) {
                is LocationResult.Success -> {
                    if (!BangladeshBounds.contains(result.latitude, result.longitude)) {
                        _state.update { it.copy(notice = LocationNotice.OUTSIDE_BANGLADESH) }
                    } else {
                        // Round to ~1 km before use and storage; weather is area-scale data anyway.
                        val lat = round(result.latitude * 100) / 100
                        val lon = round(result.longitude * 100) / 100
                        setTarget(WeatherTarget.Gps(lat, lon, result.isApproximate), persist = true)
                    }
                }
                LocationResult.PermissionDenied -> _state.update { it.copy(notice = LocationNotice.PERMISSION_DENIED) }
                LocationResult.GpsDisabled -> _state.update { it.copy(notice = LocationNotice.GPS_DISABLED) }
                is LocationResult.Error -> _state.update { it.copy(notice = LocationNotice.GPS_UNAVAILABLE) }
            }
        }
    }

    fun onPermissionDenied() {
        _state.update { it.copy(notice = LocationNotice.PERMISSION_DENIED) }
    }

    fun dismissNotice() {
        _state.update { it.copy(notice = null) }
    }

    fun refresh() {
        val target = _state.value.target ?: return
        load(target, keepStaleForSameTarget = true)
    }

    private fun setTarget(target: WeatherTarget, persist: Boolean) {
        if (persist) {
            store.save(
                when (target) {
                    is WeatherTarget.Admin -> StoredLocation.UpazilaChoice(target.upazila.id, target.upazila.lat, target.upazila.lon)
                    is WeatherTarget.Gps -> StoredLocation.GpsChoice(target.latitude, target.longitude)
                }
            )
        }
        // New location: drop everything that belonged to the previous one.
        _state.update { it.copy(target = target, forecast = Section.Idle, observations = Section.Idle, notice = null) }
        load(target, keepStaleForSameTarget = false)
    }

    private fun load(target: WeatherTarget, keepStaleForSameTarget: Boolean) {
        loadJob?.cancel()
        val previous = _state.value
        // Preserve the last successful response across retries too. A prior failed refresh can still
        // carry useful same-location data in Failed.stale (or Loading.stale).
        val staleForecast = previous.forecast.cachedOrNull()?.takeIf { keepStaleForSameTarget && sameLocation(it.latitude, it.longitude, target) }
        val staleObs = previous.observations.cachedOrNull()?.takeIf { keepStaleForSameTarget && sameLocation(it.latitude, it.longitude, target) }
        _state.update { it.copy(forecast = Section.Loading(staleForecast), observations = Section.Loading(staleObs)) }

        loadJob = scope.launch {
            val forecast = async { api.fetchForecast(target.latitude, target.longitude) }
            val observations = async { api.fetchObservations(target.latitude, target.longitude) }
            val f = forecast.await()
            val o = observations.await()
            // Ignore results that arrive after the user picked a different location.
            if (_state.value.target?.key != target.key) return@launch
            _state.update {
                it.copy(
                    forecast = f.fold({ data -> Section.Ready(data) }, { e -> Section.Failed(e.apiErrorKind(), staleForecast) }),
                    observations = o.fold({ data -> Section.Ready(data) }, { e -> Section.Failed(e.apiErrorKind(), staleObs) }),
                )
            }
        }
    }

    private fun sameLocation(lat: Double, lon: Double, target: WeatherTarget) =
        kotlin.math.abs(lat - target.latitude) < 1e-4 && kotlin.math.abs(lon - target.longitude) < 1e-4
}

private fun <T> Section<T>.cachedOrNull(): T? = when (this) {
    Section.Idle -> null
    is Section.Loading -> stale
    is Section.Ready -> data
    is Section.Failed -> stale
}
