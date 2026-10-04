package org.projecteden.farmermobile.ui.screens.weather

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.StateFlow
import org.projecteden.farmermobile.EdenFarmerApp
import org.projecteden.farmermobile.location.LocationHelper
import org.projecteden.farmermobile.location.PrefsLocationStore

class WeatherViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as EdenFarmerApp
    private val locationHelper = LocationHelper(application)

    private val controller = WeatherController(
        api = app.apiClient,
        locations = locationHelper,
        store = PrefsLocationStore(application),
        scope = viewModelScope,
    )

    val state: StateFlow<WeatherState> = controller.state

    init {
        controller.start()
    }

    fun hasLocationPermission() = locationHelper.hasLocationPermission()
    fun useGps() = controller.useGps()
    fun onPermissionDenied() = controller.onPermissionDenied()
    fun selectUpazila(districtId: String, upazilaId: String) = controller.selectUpazila(districtId, upazilaId)
    fun refresh() = controller.refresh()
    fun retryCatalog() = controller.retryCatalog()
    fun dismissNotice() = controller.dismissNotice()
}
