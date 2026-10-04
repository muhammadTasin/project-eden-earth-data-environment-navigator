package org.projecteden.farmermobile.ui.screens.weather

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.StateFlow
import org.projecteden.farmermobile.EdenFarmerApp

class CattleAdvisoryViewModel(application: Application) : AndroidViewModel(application) {
    private val controller = CattleAdvisoryController((application as EdenFarmerApp).apiClient, viewModelScope)
    val state: StateFlow<CattleState> = controller.state
    fun loadFarms() = controller.loadFarms()
    fun select(aoiId: String) = controller.select(aoiId)
}
