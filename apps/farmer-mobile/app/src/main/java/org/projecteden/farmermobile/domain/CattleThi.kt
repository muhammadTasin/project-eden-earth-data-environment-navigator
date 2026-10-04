package org.projecteden.farmermobile.domain

import org.projecteden.farmermobile.data.model.ForecastResponse
import java.time.LocalDateTime
import java.time.ZoneOffset

enum class ThiCategory(val labelBangla: String, val labelEnglish: String) {
    NORMAL("স্বাভাবিক", "Normal"),
    ALERT("সতর্কতা", "Alert"),
    DANGER("বিপজ্জনক", "Danger"),
    EMERGENCY("জরুরি", "Emergency");

    companion object {
        fun fromApi(value: String?): ThiCategory = entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: NORMAL
    }
}

data class HourThi(val time: String, val temperatureC: Double, val humidityPct: Double, val thi: Double, val category: ThiCategory)

data class HourlyThi(val hours: List<HourThi>, val hoursMissingInputs: Int, val horizonHours: Int)

/**
 * Cattle temperature-humidity index, same formula and generic cut-offs as the API (NRC 1971):
 * THI = (1.8T + 32) - (0.55 - 0.0055 RH)(1.8T - 26). Categories are generic dairy-cattle cut-offs and are not
 * validated for Bangladeshi breeds.
 */
object CattleThi {
    fun thi(temperatureC: Double, humidityPct: Double): Double {
        val rh = humidityPct.coerceIn(0.0, 100.0)
        return (1.8 * temperatureC + 32) - (0.55 - 0.0055 * rh) * (1.8 * temperatureC - 26)
    }

    fun category(thi: Double): ThiCategory = when {
        thi < 72 -> ThiCategory.NORMAL
        thi < 79 -> ThiCategory.ALERT
        thi < 84 -> ThiCategory.DANGER
        else -> ThiCategory.EMERGENCY
    }

    /** Epoch millis of a zone-naive provider time such as 2026-10-03T22:00, read as if it were UTC. */
    fun localEpochMillis(time: String): Long? = try {
        LocalDateTime.parse(time).toEpochSecond(ZoneOffset.UTC) * 1000
    } catch (_: Exception) {
        null
    }

    /**
     * Hourly THI for the next [horizon] hours starting at the current local hour. Each hour uses its own forecast
     * temperature AND humidity; hours missing either are skipped and counted, never filled in.
     */
    fun hourly(forecast: ForecastResponse, nowMs: Long = System.currentTimeMillis(), horizon: Int = 24): HourlyThi {
        val localNowHour = Math.floorDiv(nowMs + forecast.utcOffsetSeconds * 1000L, 3_600_000L) * 3_600_000L
        val window = forecast.hourly
            .filter { h -> (localEpochMillis(h.time) ?: Long.MIN_VALUE) >= localNowHour }
            .take(horizon)
        var missing = 0
        val out = ArrayList<HourThi>()
        for (h in window) {
            val t = h.temperatureC
            val rh = h.humidityPct
            if (t == null || rh == null) {
                missing++
                continue
            }
            val value = thi(t, rh)
            out += HourThi(h.time, t, rh, value, category(value))
        }
        return HourlyThi(out, missing, horizon)
    }
}

/** WMO weather codes used by Open-Meteo. */
object WeatherCodes {
    fun labelBangla(code: Int?): String = when (code) {
        null -> "অজানা"
        0 -> "পরিষ্কার আকাশ"
        1 -> "প্রধানত পরিষ্কার"
        2 -> "আংশিক মেঘলা"
        3 -> "মেঘলা"
        45, 48 -> "কুয়াশা"
        51, 53, 55 -> "গুঁড়ি গুঁড়ি বৃষ্টি"
        56, 57 -> "জমাট গুঁড়ি বৃষ্টি"
        61 -> "হালকা বৃষ্টি"
        63 -> "মাঝারি বৃষ্টি"
        65 -> "ভারী বৃষ্টি"
        66, 67 -> "জমাট বৃষ্টি"
        71, 73, 75, 77 -> "তুষারপাত"
        80 -> "হালকা বৃষ্টির ঝাপটা"
        81 -> "মাঝারি বৃষ্টির ঝাপটা"
        82 -> "প্রবল বৃষ্টির ঝাপটা"
        85, 86 -> "তুষারের ঝাপটা"
        95 -> "বজ্রসহ বৃষ্টি"
        96, 99 -> "শিলাবৃষ্টিসহ বজ্রঝড়"
        else -> "অজানা"
    }
}
