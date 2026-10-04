@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package org.projecteden.farmermobile.weather

import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.projecteden.farmermobile.data.remote.ApiErrorKind
import org.projecteden.farmermobile.data.remote.ApiException
import org.projecteden.farmermobile.location.LocationResult
import org.projecteden.farmermobile.location.StoredLocation
import org.projecteden.farmermobile.ui.screens.weather.CatalogState
import org.projecteden.farmermobile.ui.screens.weather.LocationNotice
import org.projecteden.farmermobile.ui.screens.weather.Section
import org.projecteden.farmermobile.ui.screens.weather.WeatherController
import org.projecteden.farmermobile.ui.screens.weather.WeatherTarget

class WeatherControllerTest {

    private fun TestScope.controller(api: FakeApi, loc: FakeLocations = FakeLocations(), store: MemoryStore = MemoryStore()) =
        WeatherController(api, loc, store, this)

    @Test
    fun noDefaultFarm_nothingIsFetchedUntilTheUserChoosesALocation() = runTest {
        val api = FakeApi()
        val c = controller(api)
        c.start(); advanceUntilIdle()
        assertTrue(c.state.value.catalog is CatalogState.Ready)
        assertNull(c.state.value.target)
        assertTrue(api.forecastCalls.isEmpty() && api.observationCalls.isEmpty())
        assertTrue(c.state.value.forecast is Section.Idle)
    }

    @Test
    fun selectingAnUpazilaSendsThatUpazilasOwnCoordinatesAndPersistsTheChoice() = runTest {
        val api = FakeApi(); val store = MemoryStore()
        val c = controller(api, store = store)
        c.start(); advanceUntilIdle()
        c.selectUpazila("D2", "U3"); advanceUntilIdle()

        assertEquals(listOf(24.89 to 91.87), api.forecastCalls)
        assertEquals(listOf(24.89 to 91.87), api.observationCalls)
        assertEquals(StoredLocation.UpazilaChoice("U3", 24.89, 91.87), store.value)
        val f = c.state.value.forecast as Section.Ready
        assertEquals(24.89, f.data.latitude, 0.0)
    }

    @Test
    fun storedChoiceIsRestoredOnStart() = runTest {
        val api = FakeApi()
        val c = controller(api, store = MemoryStore(StoredLocation.UpazilaChoice("U1", 23.84, 90.26)))
        c.start(); advanceUntilIdle()
        val target = c.state.value.target as WeatherTarget.Admin
        assertEquals("Savar", target.upazila.nameEn)
        assertEquals(listOf(23.84 to 90.26), api.forecastCalls)
    }

    @Test
    fun changingLocationClearsTheOldLocationsDataImmediately() = runTest {
        val api = FakeApi()
        val c = controller(api)
        c.start(); advanceUntilIdle()
        c.selectUpazila("D1", "U1"); advanceUntilIdle()
        assertTrue(c.state.value.forecast is Section.Ready)

        // The second location fails: the first location's forecast must NOT be shown for it.
        api.forecast = { _, _ -> Result.failure(ApiException(ApiErrorKind.PROVIDER_UNAVAILABLE, "down")) }
        c.selectUpazila("D2", "U3"); advanceUntilIdle()
        val failed = c.state.value.forecast as Section.Failed
        assertEquals(ApiErrorKind.PROVIDER_UNAVAILABLE, failed.kind)
        assertNull("stale data from another location must never be shown", failed.stale)
        // NASA is independent and still loaded for the new location.
        assertEquals(24.89, (c.state.value.observations as Section.Ready).data.latitude, 0.0)
    }

    @Test
    fun refreshFailureKeepsStaleDataOnlyForTheSameLocation() = runTest {
        val api = FakeApi()
        val c = controller(api)
        c.start(); advanceUntilIdle()
        c.selectUpazila("D1", "U1"); advanceUntilIdle()
        api.forecast = { _, _ -> Result.failure(ApiException(ApiErrorKind.OFFLINE, "no network")) }
        c.refresh(); advanceUntilIdle()
        val failed = c.state.value.forecast as Section.Failed
        assertEquals(ApiErrorKind.OFFLINE, failed.kind)
        assertNotNull(failed.stale)
        assertEquals(23.84, failed.stale!!.latitude, 0.0)
    }

    @Test
    fun catalogFailureIsReportedAndCanBeRetried() = runTest {
        val api = FakeApi().also { it.locations = Result.failure(ApiException(ApiErrorKind.OFFLINE, "x")) }
        val c = controller(api)
        c.start(); advanceUntilIdle()
        assertEquals(CatalogState.Failed(ApiErrorKind.OFFLINE), c.state.value.catalog)
        api.locations = Result.success(catalog)
        c.retryCatalog(); advanceUntilIdle()
        assertTrue(c.state.value.catalog is CatalogState.Ready)
    }

    @Test
    fun gpsWithoutPermissionShowsNoticeAndFetchesNothing() = runTest {
        val api = FakeApi()
        val c = controller(api, FakeLocations(permission = false))
        c.start(); advanceUntilIdle()
        c.useGps(); advanceUntilIdle()
        assertEquals(LocationNotice.PERMISSION_DENIED, c.state.value.notice)
        assertNull(c.state.value.target)
        assertTrue(api.forecastCalls.isEmpty())
    }

    @Test
    fun gpsDisabledAndGpsErrorHaveTheirOwnNotices() = runTest {
        val loc = FakeLocations(result = LocationResult.GpsDisabled)
        val c = controller(FakeApi(), loc)
        c.start(); advanceUntilIdle()
        c.useGps(); advanceUntilIdle()
        assertEquals(LocationNotice.GPS_DISABLED, c.state.value.notice)
        loc.result = LocationResult.Error("timeout")
        c.useGps(); advanceUntilIdle()
        assertEquals(LocationNotice.GPS_UNAVAILABLE, c.state.value.notice)
    }

    @Test
    fun gpsOutsideBangladeshIsRejectedWithoutCallingTheApi() = runTest {
        val api = FakeApi()
        val c = controller(api, FakeLocations(result = LocationResult.Success(51.5, -0.12)))
        c.start(); advanceUntilIdle()
        c.useGps(); advanceUntilIdle()
        assertEquals(LocationNotice.OUTSIDE_BANGLADESH, c.state.value.notice)
        assertTrue(api.forecastCalls.isEmpty())
    }

    @Test
    fun gpsInsideBangladeshUsesTheRoundedDeviceCoordinatesAndPersistsThem() = runTest {
        val api = FakeApi(); val store = MemoryStore()
        val c = controller(api, FakeLocations(result = LocationResult.Success(23.81234, 90.41567)), store)
        c.start(); advanceUntilIdle()
        c.useGps(); advanceUntilIdle()
        val target = c.state.value.target as WeatherTarget.Gps
        assertEquals(23.81, target.latitude, 1e-9)
        assertEquals(90.42, target.longitude, 1e-9)
        assertEquals(listOf(23.81 to 90.42), api.forecastCalls)
        assertEquals(StoredLocation.GpsChoice(23.81, 90.42), store.value)
    }

    @Test
    fun aLateResponseForAnOldLocationDoesNotOverwriteTheNewOne() = runTest {
        val api = FakeApi().also { it.gateLat = 23.84 } // first location's forecast is slow
        val c = controller(api)
        c.start(); advanceUntilIdle()
        c.selectUpazila("D1", "U1"); advanceUntilIdle()   // suspended on the gate
        assertTrue(c.state.value.forecast is Section.Loading)
        c.selectUpazila("D2", "U3"); advanceUntilIdle()   // second location answers immediately
        assertEquals(24.89, (c.state.value.forecast as Section.Ready).data.latitude, 0.0)

        api.gate.complete(Unit)                            // the old, slow response finally arrives
        advanceUntilIdle()
        assertEquals("old location's late response must be ignored", 24.89, (c.state.value.forecast as Section.Ready).data.latitude, 0.0)
        assertEquals((c.state.value.target as WeatherTarget.Admin).upazila.id, "U3")
    }
}
