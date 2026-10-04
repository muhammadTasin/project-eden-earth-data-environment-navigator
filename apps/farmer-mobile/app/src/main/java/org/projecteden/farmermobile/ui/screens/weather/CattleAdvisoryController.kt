package org.projecteden.farmermobile.ui.screens.weather

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.projecteden.farmermobile.data.model.CattleAdvisory
import org.projecteden.farmermobile.data.model.CattleAoi
import org.projecteden.farmermobile.data.model.CattleJob
import org.projecteden.farmermobile.data.remote.EdenApi
import org.projecteden.farmermobile.data.remote.apiErrorKind

data class CattleState(
    val aois: Section<List<CattleAoi>> = Section.Idle,
    val selectedAoiId: String? = null,
    val advisory: Section<CattleAdvisory> = Section.Idle,
    /** Most recent job for the selected farm, so a partial/failed/blocked run is visible next to the advisory. */
    val latestJob: CattleJob? = null,
)

/**
 * Read-only view of the farm advisories created on the website. Farms are drawn there; this app only shows what the
 * shared API returns, with the same measured / derived / heuristic split and job status.
 */
class CattleAdvisoryController(private val api: EdenApi, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(CattleState())
    val state: StateFlow<CattleState> = _state.asStateFlow()

    fun loadFarms() {
        _state.update { it.copy(aois = Section.Loading(it.aois.staleOrNull())) }
        scope.launch {
            api.fetchCattleAois().fold(
                onSuccess = { list ->
                    _state.update { it.copy(aois = Section.Ready(list)) }
                    val keep = _state.value.selectedAoiId?.takeIf { id -> list.any { it.id == id } }
                    (keep ?: list.firstOrNull()?.id)?.let { select(it) }
                },
                onFailure = { e -> _state.update { it.copy(aois = Section.Failed(e.apiErrorKind(), it.aois.staleOrNull())) } },
            )
        }
    }

    fun select(aoiId: String) {
        _state.update { it.copy(selectedAoiId = aoiId, advisory = Section.Loading(), latestJob = null) }
        scope.launch {
            val advisory = async { api.fetchCattleAdvisory(aoiId) }
            val jobs = async { api.fetchCattleJobs(aoiId) }
            val a = advisory.await()
            val j = jobs.await()
            if (_state.value.selectedAoiId != aoiId) return@launch
            _state.update {
                it.copy(
                    advisory = a.fold({ data -> Section.Ready(data) }, { e -> Section.Failed(e.apiErrorKind()) }),
                    latestJob = j.getOrNull()?.firstOrNull(),
                )
            }
        }
    }

    private fun <T> Section<List<T>>.staleOrNull(): List<T>? = (this as? Section.Ready)?.data
}
