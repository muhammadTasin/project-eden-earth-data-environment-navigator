package org.projecteden.farmermobile.location

sealed class LocationResult {
    data class Success(
        val latitude: Double,
        val longitude: Double,
        val isApproximate: Boolean = false
    ) : LocationResult()

    object PermissionDenied : LocationResult()
    object GpsDisabled : LocationResult()
    data class Error(val message: String) : LocationResult()
}

/** Device location, abstracted so the weather logic can be unit-tested without Android. */
interface LocationProvider {
    fun hasLocationPermission(): Boolean
    suspend fun getCurrentLocation(): LocationResult
}

/** The API only serves Bangladesh coordinates (lat 20.4–26.8, lon 88.0–92.8); outside it answers invalid_input. */
object BangladeshBounds {
    const val MIN_LAT = 20.4
    const val MAX_LAT = 26.8
    const val MIN_LON = 88.0
    const val MAX_LON = 92.8
    fun contains(lat: Double, lon: Double) = lat in MIN_LAT..MAX_LAT && lon in MIN_LON..MAX_LON
}
