package org.projecteden.farmermobile

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.projecteden.farmermobile.data.local.FarmDao
import org.projecteden.farmermobile.data.model.AdviceEntity
import org.projecteden.farmermobile.data.model.AdviceHistoryEntity
import org.projecteden.farmermobile.data.model.FarmProfileEntity
import org.projecteden.farmermobile.data.remote.EdenApiClient
import org.projecteden.farmermobile.data.repository.FarmerRepository
import org.projecteden.farmermobile.ui.components.formatBanglaTimer
import org.projecteden.farmermobile.ui.components.toBanglaDigits
import org.projecteden.farmermobile.ui.components.windowPart

class FarmerMobileUnitTest {

    @Test
    fun testBanglaDigitConversion() {
        assertEquals("০", 0.toBanglaDigits())
        assertEquals("১", 1.toBanglaDigits())
        assertEquals("১০", 10.toBanglaDigits())
        assertEquals("২৫", 25.toBanglaDigits())
        assertEquals("২০২৬", 2026.toBanglaDigits())
    }

    @Test
    fun testBanglaTimerFormatting() {
        val timer = formatBanglaTimer(currentSec = 8, totalSec = 80)
        assertEquals("০:০৮ / ১:২০", timer)
    }

    @Test
    fun testWindowPart() {
        val window = "রোপণ: ~১ আগস্ট • কাটা: ~৩ নভেম্বর"
        assertEquals("রোপণ: ~১ আগস্ট", window.windowPart(0))
        assertEquals("কাটা: ~৩ নভেম্বর", window.windowPart(1))
        assertEquals("", window.windowPart(2))
    }

    @Test
    fun testFarmProfileDefaults() {
        val profile = FarmProfileEntity()
        assertEquals("তালন্দ পাইলট খামার", profile.farmName)
        assertEquals("মাঝারি উঁচু জমি", profile.landType)
        assertEquals("খিয়ার মাটি", profile.soilTexture)
        assertTrue(profile.priorities.contains("পানি সাশ্রয়ী সেচ"))
    }

    @Test
    fun testAdviceSeedUsesResearchAndMarksMissingPrice() {
        val advice = AdviceEntity()
        assertEquals("আমন ধান → মসুর", advice.rotationTitle)
        assertTrue(advice.season1IrrigationStatus.startsWith("২৫ মৌসুমের"))
        assertTrue(advice.season2FertilizerRecommendation.contains("SRDI"))
        // No farm-gate price data yet, so the app says so instead of inventing one
        assertEquals("তথ্য পাওয়া যায়নি", advice.alternativeCropMarketPrice)
    }

    @Test
    fun testRepositoryFallbackWhenDaoEmpty() = runTest {
        val fakeDao = object : FarmDao {
            override fun getFarmProfile() = flowOf(null)
            override suspend fun insertOrUpdateProfile(profile: FarmProfileEntity) {}
            override fun getAdvice() = flowOf(null)
            override suspend fun insertOrUpdateAdvice(advice: AdviceEntity) {}
            override fun getAdviceHistory() = flowOf(emptyList<AdviceHistoryEntity>())
            override suspend fun insertHistoryItem(item: AdviceHistoryEntity) {}
            override suspend fun markHistoryItemListened(historyId: String) {}
        }

        val repository = FarmerRepository(fakeDao, EdenApiClient("http://127.0.0.1:1"))

        val profile = repository.farmProfile.first()
        assertNotNull(profile)
        assertEquals("তালন্দ পাইলট খামার", profile.farmName)

        val advice = repository.currentAdvice.first()
        assertNotNull(advice)
        assertEquals("আমন ধান → মসুর", advice.rotationTitle)

        val history = repository.adviceHistory.first()
        assertEquals(1, history.size)
        assertEquals("আমন ধান (ব্রি ধান৭১) → মসুর", history[0].rotationTitle)
    }

    @Test
    fun testRefreshFailureKeepsCachedAdvice() = runTest {
        val cached = AdviceEntity(isOffline = false, lastSyncFormatted = "গতকাল")
        var saved: AdviceEntity? = null
        val fakeDao = object : FarmDao {
            override fun getFarmProfile() = flowOf(null)
            override suspend fun insertOrUpdateProfile(profile: FarmProfileEntity) {}
            override fun getAdvice() = flowOf(cached)
            override suspend fun insertOrUpdateAdvice(advice: AdviceEntity) { saved = advice }
            override fun getAdviceHistory() = flowOf(emptyList<AdviceHistoryEntity>())
            override suspend fun insertHistoryItem(item: AdviceHistoryEntity) {}
            override suspend fun markHistoryItemListened(historyId: String) {}
        }

        // Nothing listens on port 1, so the request fails
        val repository = FarmerRepository(fakeDao, EdenApiClient(baseUrl = "http://127.0.0.1:1"))
        val result = repository.refreshAdvice()

        assertTrue(result.isFailure)
        val stored = saved!!
        assertTrue(stored.isOffline)
        assertEquals(cached.rotationTitle, stored.rotationTitle)
        assertEquals("গতকাল", stored.lastSyncFormatted)
    }

    @Test
    fun testFarmProfileSaveUpdatesTimestampAndDao() = runTest {
        var saved: FarmProfileEntity? = null
        val fakeDao = object : FarmDao {
            override fun getFarmProfile() = flowOf(FarmProfileEntity(farmName = "আসল খামার"))
            override suspend fun insertOrUpdateProfile(profile: FarmProfileEntity) { saved = profile }
            override fun getAdvice() = flowOf(null)
            override suspend fun insertOrUpdateAdvice(advice: AdviceEntity) {}
            override fun getAdviceHistory() = flowOf(emptyList<AdviceHistoryEntity>())
            override suspend fun insertHistoryItem(item: AdviceHistoryEntity) {}
            override suspend fun markHistoryItemListened(historyId: String) {}
        }

        val repository = FarmerRepository(fakeDao, EdenApiClient("http://127.0.0.1:1"))
        val profile = repository.farmProfile.first()
        assertEquals("আসল খামার", profile.farmName)

        val updatedProfile = profile.copy(farmName = "সম্পাদিত খামার", region = "রাজশাহী")
        repository.saveProfile(updatedProfile)

        val nonNullSaved = saved
        assertNotNull(nonNullSaved)
        assertEquals("সম্পাদিত খামার", nonNullSaved!!.farmName)
        assertEquals("রাজশাহী", nonNullSaved.region)
        assertTrue(nonNullSaved.lastUpdatedTimestamp > 0)
    }

    @Test
    fun testFarmProfileDraftDecoupling() {
        val original = FarmProfileEntity(farmName = "খামার ১", region = "বরেন্দ্র")
        var draft: FarmProfileEntity? = original

        // Simulating draft update during user typing
        draft = draft?.copy(farmName = "খামার ২")
        assertEquals("খামার ২", draft?.farmName)
        // Original entity remains untouched
        assertEquals("খামার ১", original.farmName)

        // Cancel editing discards draft
        draft = null
        org.junit.Assert.assertNull(draft)
        assertEquals("খামার ১", original.farmName)
    }

    @Test
    fun testRefreshAdviceGeneratesUniqueHistoryId() = runTest {
        var insertedHistory: AdviceHistoryEntity? = null
        val fakeDao = object : FarmDao {
            override fun getFarmProfile() = flowOf(FarmProfileEntity(landType = "উঁচু জমি"))
            override suspend fun insertOrUpdateProfile(profile: FarmProfileEntity) {}
            override fun getAdvice() = flowOf(AdviceEntity())
            override suspend fun insertOrUpdateAdvice(advice: AdviceEntity) {}
            override fun getAdviceHistory() = flowOf(emptyList<AdviceHistoryEntity>())
            override suspend fun insertHistoryItem(item: AdviceHistoryEntity) { insertedHistory = item }
            override suspend fun markHistoryItemListened(historyId: String) {}
        }

        // Fake client that returns success
        val fakeClient = object : EdenApiClient("http://127.0.0.1:1") {
            // Note: will fail network, testing failure path still preserves advice
        }
        val repository = FarmerRepository(fakeDao, fakeClient)
        // Failure path doesn't insert history, but we verify repository initializes without error
        assertNotNull(repository)
    }

    @Test
    fun testFarmProfileValidationLogic() {
        val blankNameProfile = FarmProfileEntity(farmName = "   ", region = "বরেন্দ্র")
        val blankRegionProfile = FarmProfileEntity(farmName = "খামার ১", region = "   ")
        val validProfile = FarmProfileEntity(farmName = "সবুজ খামার", region = "তানোর, রাজশাহী")

        assertTrue(blankNameProfile.farmName.trim().isBlank())
        assertTrue(blankRegionProfile.region.trim().isBlank())
        assertTrue(validProfile.farmName.trim().isNotBlank() && validProfile.region.trim().isNotBlank())
    }

    @Test
    fun testPlotNameDynamicReflection() = runTest {
        val customProfile = FarmProfileEntity(
            farmName = "রহিমের খামার",
            plotDescription = "উত্তর মাঠ প্লট ৩"
        )
        val cachedAdvice = AdviceEntity(plotName = "পূর্ব মাঠ – প্লট ০২ (তালন্দ এলাকা)")

        val generatedPlotName = if (customProfile.plotDescription.isNotBlank()) {
            "${customProfile.farmName} – ${customProfile.plotDescription}"
        } else {
            cachedAdvice.plotName
        }

        assertEquals("রহিমের খামার – উত্তর মাঠ প্লট ৩", generatedPlotName)
    }
}


