package org.projecteden.farmermobile.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class LocationHelper(private val context: Context) : LocationProvider {

    private val fusedClient = LocationServices.getFusedLocationProviderClient(context)

    override fun hasLocationPermission(): Boolean {
        val coarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val fine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return coarse || fine
    }

    fun isGpsEnabled(): Boolean {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    /**
     * One-time current location fetch while the app is in foreground.
     * Does NOT add continuous or background tracking.
     */
    override suspend fun getCurrentLocation(): LocationResult = withContext(Dispatchers.IO) {
        if (!hasLocationPermission()) {
            return@withContext LocationResult.PermissionDenied
        }

        if (!isGpsEnabled()) {
            return@withContext LocationResult.GpsDisabled
        }

        val hasFine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val priority = if (hasFine) {
            Priority.PRIORITY_HIGH_ACCURACY
        } else {
            Priority.PRIORITY_BALANCED_POWER_ACCURACY
        }

        val cts = CancellationTokenSource()

        try {
            // Attempt to get fresh location fix within 8 seconds
            val freshLocation = withTimeoutOrNull(8000L) {
                suspendCancellableCoroutine<Location?> { cont ->
                    fusedClient.getCurrentLocation(priority, cts.token)
                        .addOnSuccessListener { loc ->
                            if (cont.isActive) cont.resume(loc)
                        }
                        .addOnFailureListener { exc ->
                            if (cont.isActive) cont.resumeWithException(exc)
                        }
                        .addOnCanceledListener {
                            if (cont.isActive) cont.cancel()
                        }

                    cont.invokeOnCancellation {
                        cts.cancel()
                    }
                }
            }

            if (freshLocation != null) {
                return@withContext LocationResult.Success(
                    latitude = freshLocation.latitude,
                    longitude = freshLocation.longitude,
                    isApproximate = !hasFine
                )
            }

            // Fallback to last known location if fresh fix timed out
            val lastLoc = suspendCancellableCoroutine<Location?> { cont ->
                fusedClient.lastLocation
                    .addOnSuccessListener { loc ->
                        if (cont.isActive) cont.resume(loc)
                    }
                    .addOnFailureListener {
                        if (cont.isActive) cont.resume(null)
                    }
                    .addOnCanceledListener {
                        if (cont.isActive) cont.resume(null)
                    }
            }

            if (lastLoc != null) {
                return@withContext LocationResult.Success(
                    latitude = lastLoc.latitude,
                    longitude = lastLoc.longitude,
                    isApproximate = true
                )
            }

            LocationResult.Error("লোকেশন সংকেত পেতে বিলম্ব হচ্ছে (সময়সীমা অতিক্রান্ত)")
        } catch (e: SecurityException) {
            LocationResult.PermissionDenied
        } catch (e: Exception) {
            LocationResult.Error(e.message ?: "লোকেশন নির্ণয় করা যায়নি")
        }
    }
}
