package org.projecteden.farmermobile.weather

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.projecteden.farmermobile.data.model.ForecastHour
import org.projecteden.farmermobile.domain.CattleThi
import org.projecteden.farmermobile.domain.ThiCategory

class CattleThiTest {
    @Test
    fun benchmarksMatchTheApiAndWebsite() {
        assertEquals(71.8, CattleThi.thi(25.0, 50.0), 0.05)
        assertEquals(77.7, CattleThi.thi(28.0, 65.0), 0.05)
        assertEquals(79.8, CattleThi.thi(30.0, 60.0), 0.05)
        assertEquals(84.4, CattleThi.thi(32.0, 70.0), 0.05)
        assertEquals(ThiCategory.NORMAL, CattleThi.category(71.8))
        assertEquals(ThiCategory.ALERT, CattleThi.category(77.7))
        assertEquals(ThiCategory.DANGER, CattleThi.category(79.8))
        assertEquals(ThiCategory.EMERGENCY, CattleThi.category(84.4))
    }

    private fun hour(i: Int, t: Double?, rh: Double?): ForecastHour {
        val time = "2026-10-04T%02d:00".format(i % 24).let { if (i >= 24) it.replace("10-04", "10-05") else it }
        return ForecastHour(time, t, rh, null, null, null)
    }

    @Test
    fun hourlyThiUsesEachHoursOwnHumidityFromTheCurrentLocalHour() {
        val hours = (0 until 48).map { i -> hour(i, if (i % 24 in 11..16) 34.0 else 25.0, if (i % 24 in 11..16) 55.0 else 92.0) }
        // 14:20 local (UTC+6) on 2026-10-04 == 08:20 UTC
        val nowMs = java.time.Instant.parse("2026-10-04T08:20:00Z").toEpochMilli()
        val forecast = forecastFor(23.8, 90.4).copy(hourly = hours, utcOffsetSeconds = 21600)
        val result = CattleThi.hourly(forecast, nowMs)

        assertEquals("starts at the current local hour, not at midnight", "2026-10-04T14:00", result.hours.first().time)
        assertEquals(24, result.hours.size)
        val noon = result.hours.first { it.time.endsWith("T14:00") }
        assertEquals(CattleThi.thi(34.0, 55.0), noon.thi, 1e-9)
        assertNotEquals("must not reuse the current humidity (60%)", CattleThi.thi(34.0, 60.0), noon.thi, 1e-9)
        val night = result.hours.first { it.time.endsWith("T22:00") }
        assertEquals(CattleThi.thi(25.0, 92.0), night.thi, 1e-9)
    }

    @Test
    fun hoursMissingTemperatureOrHumidityAreSkippedAndCountedNeverFilledIn() {
        val hours = listOf(hour(14, 30.0, 70.0), hour(15, null, 70.0), hour(16, 30.0, null), hour(17, 31.0, 65.0))
        val nowMs = java.time.Instant.parse("2026-10-04T08:20:00Z").toEpochMilli()
        val result = CattleThi.hourly(forecastFor(23.8, 90.4).copy(hourly = hours), nowMs)
        assertEquals(2, result.hours.size)
        assertEquals(2, result.hoursMissingInputs)
        assertTrue(result.hours.none { it.time.endsWith("T15:00") || it.time.endsWith("T16:00") })
    }
}
