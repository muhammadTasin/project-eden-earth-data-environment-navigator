package org.projecteden.farmermobile.weather

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.projecteden.farmermobile.data.remote.ApiParsers
import org.projecteden.farmermobile.domain.CattleThi

/**
 * The fixtures in src/test/resources/contract are responses captured from the real Edith_Web_App_Connectivity API
 * (not hand-written), so these tests fail if the Android parsers drift from what the server really sends.
 * Re-capture them with the curl commands in docs/SETUP.md ("Refreshing contract fixtures") after an API change.
 */
class RealApiContractTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource("contract/$name")!!.readText()

    @Test fun realLocationsPayloadCoversAllDistrictsAndUpazilas() {
        val c = ApiParsers.locations(fixture("locations.json"))
        assertEquals(64, c.districts.size)
        assertTrue("expected 495+ upazilas, got ${c.upazilaCount}", c.upazilaCount >= 495)
        assertTrue(c.districts.all { d -> d.upazilas.isNotEmpty() && d.upazilas.all { it.lat in 20.0..27.0 && it.lon in 88.0..93.0 } })
    }

    @Test fun realForecastPayloadParsesWithHourlyHumidity() {
        val f = ApiParsers.forecast(fixture("forecast.json"))
        assertEquals(23.81, f.latitude, 1e-9)
        assertEquals("model_estimate", f.source.kind)
        assertTrue(f.hourly.size >= 24)
        assertTrue("hourly humidity must be present", f.hourly.any { it.humidityPct != null })
        assertTrue(f.daily.size >= 7)
        // Hourly THI computed from the real payload
        val nowMs = CattleThi.localEpochMillis(f.hourly.first().time)!! - f.utcOffsetSeconds * 1000L
        val thi = CattleThi.hourly(f, nowMs)
        assertEquals(24, thi.hours.size)
        assertTrue(thi.hours.map { it.humidityPct }.distinct().size > 1)
    }

    @Test fun realNasaPayloadIsDelayedAndHasNoSoilMoisture() {
        val o = ApiParsers.observations(fixture("observations.json"))
        assertFalse(o.source.live)
        assertEquals("satellite_delayed", o.source.kind)
        assertNotNull(o.soilMoistureUnavailableReason)
        assertTrue(o.daysWithData > 0)
    }

    @Test fun realCattlePayloadsParseAndShowUnavailableSatelliteData() {
        val aois = ApiParsers.cattleAois(fixture("cattle_aois.json"))
        assertTrue(aois.isNotEmpty())
        val a = ApiParsers.cattleAdvisory(fixture("cattle_advisory.json"))
        assertTrue(a.thiCurrent > 0)
        assertEquals("unavailable", a.satelliteStatus)   // Earth Engine is not configured where the fixture was captured
        assertEquals(null, a.ndvi)
        assertFalse(a.supervisedModelAvailable)
        assertTrue(a.hourly.isNotEmpty())
        val jobs = ApiParsers.cattleJobs(fixture("cattle_jobs.json"))
        assertTrue(jobs.isNotEmpty())
        assertTrue(jobs.first().status in setOf("succeeded", "partial", "failed", "blocked"))
        assertTrue("partial job must say what is missing", jobs.first().status != "partial" || jobs.first().missing.isNotEmpty())
    }
}
