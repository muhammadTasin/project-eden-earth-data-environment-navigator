package org.projecteden.farmermobile.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.projecteden.farmermobile.data.local.FarmDao
import org.projecteden.farmermobile.data.model.AdviceEntity
import org.projecteden.farmermobile.data.model.AdviceHistoryEntity
import org.projecteden.farmermobile.data.model.FarmProfileEntity
import org.projecteden.farmermobile.data.remote.EdenApiClient
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Offline-first repository coordinating Room database cache and remote API.
 * Room remains the primary read source.
 *
 * Backend Contract Note:
 * The current server API (services/api/src/server.ts) supports:
 * - GET /api/v1/overview
 * - POST /api/v1/advice (its farmer_card fills the cached advice)
 * Endpoint gaps:
 * - /api/v1/farmer-profile (Profile persistence is not yet provided by API; maintained in local Room)
 * - /api/v1/advice-history (History persistence is not yet provided by API; maintained in local Room)
 */
class FarmerRepository(
    private val farmDao: FarmDao,
    private val apiClient: EdenApiClient
) {

    val farmProfile: Flow<FarmProfileEntity> = farmDao.getFarmProfile().map {
        it ?: FarmProfileEntity()
    }

    val currentAdvice: Flow<AdviceEntity> = farmDao.getAdvice().map {
        it ?: AdviceEntity()
    }

    val adviceHistory: Flow<List<AdviceHistoryEntity>> = farmDao.getAdviceHistory().map { list ->
        if (list.isEmpty()) listOf(AdviceHistoryEntity()) else list
    }

    /**
     * Fetches the server's advice tailored to the farmer's profile and stores it in Room.
     * On failure the cached advice and its last successful sync time are kept; only the offline flag changes.
     */
    suspend fun refreshAdvice(): Result<Boolean> {
        val cached = farmDao.getAdvice().first() ?: AdviceEntity()
        val profile = farmDao.getFarmProfile().first() ?: FarmProfileEntity()
        val now = "আজ " + SimpleDateFormat("h:mm a", Locale("bn", "BD")).format(Date())

        val apiLandType = when {
            profile.landType.contains("মাঝারি উঁচু") || profile.landType.contains("medium_high", ignoreCase = true) -> "medium_high"
            profile.landType.contains("উঁচু") || profile.landType.contains("high", ignoreCase = true) -> "high"
            profile.landType.contains("মাঝারি নিচু") || profile.landType.contains("medium_low", ignoreCase = true) -> "medium_low"
            profile.landType.contains("নিচু") || profile.landType.contains("low", ignoreCase = true) -> "low"
            else -> "medium_high"
        }

        val p = profile.priorities
        val (wWater, wIncome, wSoil) = when {
            p.contains("পানি") || p.contains("water", ignoreCase = true) -> Triple(0.6, 0.2, 0.2)
            p.contains("মুনাফা") || p.contains("income", ignoreCase = true) -> Triple(0.2, 0.6, 0.2)
            p.contains("মাটি") || p.contains("soil", ignoreCase = true) -> Triple(0.2, 0.2, 0.6)
            else -> Triple(0.5, 0.3, 0.2)
        }

        return apiClient.fetchAdvice(
            landType = apiLandType,
            waterWeight = wWater,
            incomeWeight = wIncome,
            soilWeight = wSoil
        ).fold(
            onSuccess = { remote ->
                farmDao.insertOrUpdateAdvice(
                    cached.copy(
                        plotName = if (profile.plotDescription.isNotBlank()) "${profile.farmName} – ${profile.plotDescription}" else cached.plotName,
                        rotationTitle = remote.rotationTitle,
                        rotationSubtitle = remote.rotationSubtitle,
                        season1Name = remote.season1Name,
                        season1Variety = remote.season1Variety,
                        season1Window = remote.season1Window,
                        season1Stage = remote.season1Stage,
                        season1IrrigationStatus = remote.season1Irrigation,
                        season2Name = remote.season2Name,
                        season2Variety = remote.season2Variety,
                        season2Window = remote.season2Window,
                        season2Notes = remote.season2Notes,
                        season2FertilizerRecommendation = remote.season2Fertilizer,
                        narrativeAdvice = remote.narrative,
                        alternativeCropName = remote.alternativeName,
                        alternativeCropCategory = remote.alternativeCategory,
                        alternativeCropSowing = remote.alternativeSowing,
                        alternativeCropYield = remote.alternativeYield,
                        alternativeCropMarketPrice = remote.alternativeMarketPrice,
                        provenanceNotice = remote.provenance,
                        audioScriptBangla = remote.audioScript,
                        audioDurationSeconds = remote.audioDurationSeconds,
                        isOffline = false,
                        lastSyncFormatted = now,
                        cacheTimeString = "$now সিঙ্ক",
                        updatedAt = System.currentTimeMillis()
                    )
                )
                val historyId = "sync_${System.currentTimeMillis()}"
                farmDao.insertHistoryItem(
                    AdviceHistoryEntity(
                        id = historyId,
                        rotationTitle = "আমন ধান (${remote.season1Variety}) → ${remote.season2Name}",
                        adviceSummary = remote.narrative,
                        syncTimestamp = now,
                        createdAt = System.currentTimeMillis()
                    )
                )
                Result.success(true)
            },
            onFailure = { error ->
                farmDao.insertOrUpdateAdvice(cached.copy(isOffline = true, cacheTimeString = "অফলাইন ক্যাশ"))
                Result.failure(error)
            }
        )
    }

    suspend fun saveProfile(profile: FarmProfileEntity) {
        val updated = profile.copy(
            lastUpdatedFormatted = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date()),
            lastUpdatedTimestamp = System.currentTimeMillis()
        )
        farmDao.insertOrUpdateProfile(updated)
    }

    suspend fun markAudioListened(historyId: String) {
        farmDao.markHistoryItemListened(historyId)
    }

    suspend fun recordPlanConfirmation(advice: AdviceEntity) {
        val timestamp = System.currentTimeMillis()
        val confirmedAt = SimpleDateFormat("h:mm a", Locale("bn", "BD")).format(Date(timestamp))
        farmDao.insertHistoryItem(
            AdviceHistoryEntity(
                id = "confirmed_$timestamp",
                seasonTag = "নিশ্চিত পরিকল্পনা",
                rotationTitle = advice.rotationTitle,
                adviceSummary = advice.narrativeAdvice,
                syncTimestamp = "ডিভাইসে নিশ্চিত • $confirmedAt",
                createdAt = timestamp
            )
        )
    }
}
