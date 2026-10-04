package org.projecteden.farmermobile.location

import android.content.Context

/**
 * The user's chosen weather location. Stored on the device only. GPS positions are rounded to two decimals
 * (about 1 km) before they are saved, so a precise position is never persisted.
 */
sealed class StoredLocation {
    abstract val latitude: Double
    abstract val longitude: Double

    /** [latitude]/[longitude] are the upazila's reference point, kept so other screens (AI assistant) need no catalog. */
    data class UpazilaChoice(val upazilaId: String, override val latitude: Double, override val longitude: Double) : StoredLocation()
    data class GpsChoice(override val latitude: Double, override val longitude: Double) : StoredLocation()
}

interface LocationStore {
    fun load(): StoredLocation?
    fun save(value: StoredLocation?)
}

class PrefsLocationStore(context: Context) : LocationStore {
    private val prefs = context.getSharedPreferences("eden_weather_location", Context.MODE_PRIVATE)

    override fun load(): StoredLocation? {
        if (!prefs.contains(KEY_LAT) || !prefs.contains(KEY_LON)) return null
        val lat = java.lang.Double.longBitsToDouble(prefs.getLong(KEY_LAT, 0))
        val lon = java.lang.Double.longBitsToDouble(prefs.getLong(KEY_LON, 0))
        return when (prefs.getString(KEY_TYPE, null)) {
            "upazila" -> prefs.getString(KEY_ID, null)?.let { StoredLocation.UpazilaChoice(it, lat, lon) }
            "gps" -> StoredLocation.GpsChoice(lat, lon)
            else -> null
        }
    }

    override fun save(value: StoredLocation?) {
        prefs.edit().apply {
            clear()
            if (value != null) {
                // Doubles are stored as raw bits so the value round-trips exactly (SharedPreferences has no double).
                putLong(KEY_LAT, java.lang.Double.doubleToRawLongBits(value.latitude))
                putLong(KEY_LON, java.lang.Double.doubleToRawLongBits(value.longitude))
                when (value) {
                    is StoredLocation.UpazilaChoice -> putString(KEY_TYPE, "upazila").putString(KEY_ID, value.upazilaId)
                    is StoredLocation.GpsChoice -> putString(KEY_TYPE, "gps")
                }
            }
        }.apply()
    }

    private companion object {
        const val KEY_TYPE = "type"
        const val KEY_ID = "upazilaId"
        const val KEY_LAT = "lat"
        const val KEY_LON = "lon"
    }
}
