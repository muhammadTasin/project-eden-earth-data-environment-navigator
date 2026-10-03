package org.projecteden.farmermobile.data.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/** The server's farmer card for the top-ranked rotation (see FarmerCard in packages/contracts). */
data class RemoteAdviceResponse(
    val unionId: String,
    val unionNameBangla: String,
    val releaseId: String,
    val rotationTitle: String,
    val rotationSubtitle: String,
    val season1Name: String,
    val season1Variety: String,
    val season1Window: String,
    val season1Stage: String,
    val season1Irrigation: String,
    val season2Name: String,
    val season2Variety: String,
    val season2Window: String,
    val season2Notes: String,
    val season2Fertilizer: String,
    val alternativeName: String,
    val alternativeCategory: String,
    val alternativeSowing: String,
    val alternativeYield: String,
    val alternativeMarketPrice: String,
    val narrative: String,
    val provenance: String,
    val audioScript: String,
    val audioDurationSeconds: Int,
    val rawJson: String
)

data class RemoteOverviewResponse(
    val district: String,
    val upazila: String,
    val union: String,
    val season: String,
    val rainLast30dMm: Double,
    val rootzoneMoisture: Double,
    val rootzoneMoistureDate: String,
    val activeAlertBangla: String?
)

data class RemoteWeatherDay(
    val date: String,
    val t2m: Double,
    val t2mMax: Double,
    val t2mMin: Double,
    val rh2m: Double,
    val rainMm: Double,
    val windSpeedMs: Double
)

data class RemoteWeatherResponse(
    val locationTitle: String,
    val latitude: Double,
    val longitude: Double,
    val dataSource: String,
    val observationNotice: String,
    val observationDate: String,
    val latencyNotice: String,
    val isLive: Boolean,
    val currentTempAvgC: Double,
    val currentTempMaxC: Double,
    val currentTempMinC: Double,
    val currentHumidityPct: Double,
    val currentRainMm: Double,
    val currentWindSpeedMs: Double,
    val rootZoneSoilMoisture: Double,
    val rootZoneStatus: String,
    val rainLast30DaysMm: Double,
    val rainVerdict: String,
    val history: List<RemoteWeatherDay>
)

data class RemoteRiverStation(
    val stationId: String,
    val stationName: String,
    val district: String,
    val dangerLevelM: Double,
    val highestPeakM: Double,
    val recentPeakM: Double,
    val daysAboveDangerLevel: Int,
    val riskLevel: String,
    val bankShiftEstimate: String,
    val morphologyStatus: String,
    val dataStatus: String
)

data class RemoteRiverErosionResponse(
    val summaryDate: String,
    val activeRiverId: String,
    val riverName: String,
    val basinName: String,
    val overallRisk: String,
    val primaryCause: String,
    val basin30dRainMm: Double,
    val upstreamRainStatus: String,
    val monitoringStretches: String,
    val stations: List<RemoteRiverStation>,
    val guidelines: List<String>,
    val caveat: String
)

data class RemoteAuthResponse(
    val token: String,
    val userId: String,
    val role: String,
    val nameBangla: String,
    val nameEnglish: String,
    val titleBangla: String,
    val blockOrVillage: String,
    val landType: String?,
    val currentAmanCrop: String?
)

data class RemoteAiResponse(
    val answer: String,
    val sources: List<String>,
    val evidenceLevel: String,
    val suggestions: List<String>,
    val timestamp: String
)

/** A farmer's sentence read by the server (crops, main crop, crops to avoid) and the plan's Bangla reply. */
data class RemoteVoiceAnswer(
    val crops: List<String>,
    val heroCrop: String?,
    val excluded: List<String>,
    val speechBangla: String,
    val smsBangla: String,
    val topOptionBangla: String,
    val tipsBangla: List<String>
) {
    /** True when the sentence named a crop to grow or to avoid, so the plan answers it. */
    val namedCrops: Boolean get() = crops.isNotEmpty() || heroCrop != null || excluded.isNotEmpty()
}

/**
 * Lightweight HTTP client with adaptive multi-host connectivity.
 * Supports USB reverse tethering (127.0.0.1:4000 via adb reverse),
 * local LAN Wi-Fi (192.168.0.244:4000), and Android emulator (10.0.2.2:4000).
 */
open class EdenApiClient(
    val baseUrl: String? = null
) {
    private val candidateUrls: List<String> = if (!baseUrl.isNullOrBlank()) {
        listOf(baseUrl)
    } else {
        listOf(
            "http://127.0.0.1:4000",   // Physical phone via adb reverse tcp:4000 tcp:4000
            "http://192.168.0.244:4000", // Physical phone on host LAN Wi-Fi
            "http://10.0.2.2:4000"      // Android emulator loopback
        )
    }

    @Volatile
    private var workingBaseUrl: String? = null

    private fun getCandidates(): List<String> {
        val currentWorking = workingBaseUrl
        return if (currentWorking != null) {
            listOf(currentWorking) + candidateUrls.filter { it != currentWorking }
        } else {
            candidateUrls
        }
    }

    private fun escapeJson(value: String): String {
        return value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private suspend fun sendRequest(
        path: String,
        method: String = "GET",
        authToken: String? = null,
        bodyJson: String? = null
    ): Result<String> = withContext(Dispatchers.IO) {
        var lastException: Exception? = null

        for (host in getCandidates()) {
            var conn: HttpURLConnection? = null
            try {
                val fullUrl = "$host$path"
                conn = (URL(fullUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = method
                    connectTimeout = 3000
                    readTimeout = 4500
                    setRequestProperty("Accept", "application/json")
                    if (authToken != null) {
                        setRequestProperty("Authorization", "Bearer $authToken")
                    }
                    if (bodyJson != null) {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                    }
                }

                if (bodyJson != null) {
                    val writer = OutputStreamWriter(conn.outputStream)
                    writer.write(bodyJson)
                    writer.flush()
                    writer.close()
                }

                val code = conn.responseCode
                if (code in 200..299) {
                    val reader = BufferedReader(InputStreamReader(conn.inputStream))
                    val body = reader.readText()
                    reader.close()
                    workingBaseUrl = host
                    return@withContext Result.success(body)
                } else {
                    val errorStream = conn.errorStream
                    val errorMsg = if (errorStream != null) {
                        BufferedReader(InputStreamReader(errorStream)).readText()
                    } else "HTTP error $code"
                    lastException = Exception("Server returned $code: $errorMsg")
                }
            } catch (e: Exception) {
                lastException = e
            } finally {
                conn?.disconnect()
            }
        }

        Result.failure(lastException ?: Exception("Network request failed on all hosts"))
    }

    suspend fun fetchOverview(): Result<RemoteOverviewResponse> = withContext(Dispatchers.IO) {
        val res = sendRequest("/api/v1/overview")
        res.mapCatching { body ->
            val json = JSONObject(body)
            val scope = json.optJSONObject("scope")
            val seasonSummary = json.optJSONObject("season_summary")
            val satellite = json.optJSONObject("local_satellite_conditions")
            val smap = satellite?.optJSONObject("smap")
            val rain = satellite?.optJSONObject("rain_last_30_days")
            val alerts = json.optJSONArray("active_alerts")
            val firstAlert = alerts?.optJSONObject(0)?.optString("titleBangla")

            RemoteOverviewResponse(
                district = scope?.optString("district") ?: "Rajshahi",
                upazila = scope?.optString("upazila") ?: "Tanore",
                union = scope?.optString("union") ?: "Talanda",
                season = seasonSummary?.optString("season") ?: "Aman 2026",
                rainLast30dMm = rain?.optDouble("imergLateMm") ?: Double.NaN,
                rootzoneMoisture = smap?.optDouble("rootZoneM3M3") ?: Double.NaN,
                rootzoneMoistureDate = smap?.optString("date").orEmpty(),
                activeAlertBangla = firstAlert
            )
        }
    }

    suspend fun fetchAdvice(
        landType: String = "medium_high",
        waterWeight: Double = 0.5,
        incomeWeight: Double = 0.3,
        soilWeight: Double = 0.2
    ): Result<RemoteAdviceResponse> = withContext(Dispatchers.IO) {
        val payload = """{"unionId":"talanda_tanore","landType":"${escapeJson(landType)}","farmerPriorities":{"water":$waterWeight,"income":$incomeWeight,"soil":$soilWeight}}"""
        val res = sendRequest("/api/v1/advice", method = "POST", bodyJson = payload)
        res.mapCatching { body ->
            val json = JSONObject(body)
            val scope = json.optJSONObject("scope")
            val card = json.getJSONObject("farmer_card")
            val season1 = card.getJSONObject("season1")
            val season2 = card.getJSONObject("season2")
            val alternative = card.getJSONObject("alternative")

            RemoteAdviceResponse(
                unionId = scope?.optString("union_id") ?: "talanda_tanore",
                unionNameBangla = scope?.optString("union_name_bangla") ?: "তালন্দ ইউনিয়ন",
                releaseId = json.optString("data_release"),
                rotationTitle = card.getString("rotationTitleBangla"),
                rotationSubtitle = card.getString("rotationSubtitleBangla"),
                season1Name = season1.getString("name"),
                season1Variety = season1.getString("variety"),
                season1Window = season1.getString("windowBangla"),
                season1Stage = season1.getString("stageBangla"),
                season1Irrigation = season1.getString("irrigationBangla"),
                season2Name = season2.getString("name"),
                season2Variety = season2.getString("variety"),
                season2Window = season2.getString("windowBangla"),
                season2Notes = season2.getString("notesBangla"),
                season2Fertilizer = season2.getString("fertilizerBangla"),
                alternativeName = alternative.getString("name"),
                alternativeCategory = alternative.getString("categoryBangla"),
                alternativeSowing = alternative.getString("sowingBangla"),
                alternativeYield = alternative.getString("yieldBangla"),
                alternativeMarketPrice = alternative.getString("marketPriceBangla"),
                narrative = card.getString("narrativeBangla"),
                provenance = card.getString("provenanceBangla"),
                audioScript = card.getString("audioScriptBangla"),
                audioDurationSeconds = card.optInt("audioDurationSeconds", 30),
                rawJson = body
            )
        }
    }

    suspend fun fetchWeather(lat: Double = 24.62, lon: Double = 88.56): Result<RemoteWeatherResponse> = withContext(Dispatchers.IO) {
        val res = sendRequest("/api/v1/weather?lat=$lat&lon=$lon")
        res.mapCatching { body ->
            val json = JSONObject(body)
            val loc = json.getJSONObject("location")
            val latest = json.getJSONObject("latest")
            val recentArray = json.optJSONArray("recentDays") ?: JSONArray()

            val history = mutableListOf<RemoteWeatherDay>()
            for (i in 0 until recentArray.length()) {
                val d = recentArray.getJSONObject(i)
                history.add(
                    RemoteWeatherDay(
                        date = d.optString("date"),
                        t2m = d.optDouble("t2m", 0.0),
                        t2mMax = d.optDouble("t2mMax", 0.0),
                        t2mMin = d.optDouble("t2mMin", 0.0),
                        rh2m = d.optDouble("rh2m", 0.0),
                        rainMm = d.optDouble("rainMm", 0.0),
                        windSpeedMs = d.optDouble("windSpeedMs", 0.0)
                    )
                )
            }

            RemoteWeatherResponse(
                locationTitle = "${loc.optString("unionBangla", "তালন্দ")}, ${loc.optString("upazilaBangla", "তানোর")}, ${loc.optString("districtBangla", "রাজশাহী")}",
                latitude = loc.optDouble("lat", lat),
                longitude = loc.optDouble("lon", lon),
                dataSource = json.optString("dataSource", "NASA POWER & SMAP L4"),
                observationNotice = json.optString("dataTypeNoticeBangla", "উপগ্রহ ও বায়ুমণ্ডলীয় পর্যবেক্ষণ উপাত্ত (পূর্বাভাস নয়)"),
                observationDate = json.optString("latestObservationDate", ""),
                latencyNotice = json.optString("latencyNoticeBangla", ""),
                isLive = json.optBoolean("isLive", false),
                currentTempAvgC = latest.optDouble("t2m", 26.0),
                currentTempMaxC = latest.optDouble("t2mMax", 28.0),
                currentTempMinC = latest.optDouble("t2mMin", 24.0),
                currentHumidityPct = latest.optDouble("rh2m", 80.0),
                currentRainMm = latest.optDouble("rainMm", 0.0),
                currentWindSpeedMs = latest.optDouble("windSpeedMs", 2.0),
                rootZoneSoilMoisture = latest.optDouble("rootZoneMoistureM3M3", 0.311),
                rootZoneStatus = latest.optString("rootZoneMoistureStatusBangla", "মাটির আর্দ্রতা স্বাভাবিক"),
                rainLast30DaysMm = latest.optDouble("rainLast30DaysMm", 0.0),
                rainVerdict = latest.optString("rainVerdictBangla", "স্বাভাবিক"),
                history = history
            )
        }
    }

    suspend fun fetchRiverErosion(riverId: String = "jamuna"): Result<RemoteRiverErosionResponse> = withContext(Dispatchers.IO) {
        val res = sendRequest("/api/v1/erosion?river=$riverId")
        res.mapCatching { body ->
            val json = JSONObject(body)
            val corridor = json.getJSONObject("corridor")
            val stationsArray = corridor.optJSONArray("stations") ?: JSONArray()
            val guidelinesArray = json.optJSONArray("guidelinesBangla") ?: JSONArray()

            val stations = mutableListOf<RemoteRiverStation>()
            for (i in 0 until stationsArray.length()) {
                val s = stationsArray.getJSONObject(i)
                stations.add(
                    RemoteRiverStation(
                        stationId = s.optString("stationId"),
                        stationName = s.optString("stationNameBangla"),
                        district = s.optString("districtBangla"),
                        dangerLevelM = s.optDouble("dangerLevelM", 0.0),
                        highestPeakM = s.optDouble("highestRecordedPeakM", 0.0),
                        recentPeakM = s.optDouble("recentPeakM", 0.0),
                        daysAboveDangerLevel = s.optInt("daysAboveDangerLevelPeakYear", 0),
                        riskLevel = s.optString("riskLevelBangla", "মাঝারি ঝুঁকি"),
                        bankShiftEstimate = s.optString("annualBankShiftEstimateBangla", ""),
                        morphologyStatus = s.optString("morphologyStatusBangla", ""),
                        dataStatus = s.optString("dataStatusBangla", "")
                    )
                )
            }

            val guidelines = mutableListOf<String>()
            for (i in 0 until guidelinesArray.length()) {
                guidelines.add(guidelinesArray.getString(i))
            }

            RemoteRiverErosionResponse(
                summaryDate = json.optString("summaryDate", ""),
                activeRiverId = json.optString("activeRiverId", riverId),
                riverName = corridor.optString("riverNameBangla", "যমুনা নদী"),
                basinName = corridor.optString("basinNameBangla", ""),
                overallRisk = corridor.optString("overallRiskBangla", "উচ্চ ঝুঁকি"),
                primaryCause = corridor.optString("primaryCauseBangla", ""),
                basin30dRainMm = corridor.optDouble("basin30dRainMm", 0.0),
                upstreamRainStatus = corridor.optString("upstreamRainStatusBangla", ""),
                monitoringStretches = corridor.optString("monitoringStretchesBangla", ""),
                stations = stations,
                guidelines = guidelines,
                caveat = json.optString("caveatBangla", "")
            )
        }
    }

    suspend fun login(role: String, id: String, codeOrPin: String): Result<RemoteAuthResponse> = withContext(Dispatchers.IO) {
        val payload = if (role == "officer") {
            """{"role":"${escapeJson(role)}","officerId":"${escapeJson(id)}","accessCode":"${escapeJson(codeOrPin)}"}"""
        } else {
            """{"role":"${escapeJson(role)}","farmerId":"${escapeJson(id)}","pin":"${escapeJson(codeOrPin)}"}"""
        }

        val res = sendRequest("/api/v1/auth/login", method = "POST", bodyJson = payload)
        res.mapCatching { body ->
            val json = JSONObject(body)
            val user = json.getJSONObject("user")
            RemoteAuthResponse(
                token = json.getString("token"),
                userId = user.getString("id"),
                role = user.getString("role"),
                nameBangla = user.getString("nameBangla"),
                nameEnglish = user.optString("nameEnglish", ""),
                titleBangla = user.optString("titleBangla", if (role == "officer") "কৃষি কর্মকর্তা" else "কৃষক"),
                blockOrVillage = user.optString("blockOrVillageBangla", ""),
                landType = if (user.isNull("landType")) null else user.optString("landType"),
                currentAmanCrop = if (user.isNull("currentAmanCrop")) null else user.optString("currentAmanCrop")
            )
        }
    }

    suspend fun fetchSession(token: String): Result<RemoteAuthResponse> = withContext(Dispatchers.IO) {
        val res = sendRequest("/api/v1/auth/session", method = "GET", authToken = token)
        res.mapCatching { body ->
            val json = JSONObject(body)
            val user = json.getJSONObject("user")
            RemoteAuthResponse(
                token = token,
                userId = user.getString("id"),
                role = user.getString("role"),
                nameBangla = user.getString("nameBangla"),
                nameEnglish = user.optString("nameEnglish", ""),
                titleBangla = user.optString("titleBangla", ""),
                blockOrVillage = user.optString("blockOrVillageBangla", ""),
                landType = if (user.isNull("landType")) null else user.optString("landType"),
                currentAmanCrop = if (user.isNull("currentAmanCrop")) null else user.optString("currentAmanCrop")
            )
        }
    }

    suspend fun logout(token: String): Result<Boolean> = withContext(Dispatchers.IO) {
        val res = sendRequest("/api/v1/auth/logout", method = "POST", authToken = token)
        res.mapCatching { true }
    }

    /** POST /api/v1/voice/answer: the crops in a spoken or typed sentence, the year's plan and its Bangla reply. */
    suspend fun voiceAnswer(text: String, unionId: String = "talanda_tanore"): Result<RemoteVoiceAnswer> = withContext(Dispatchers.IO) {
        val payload = """{"text":"${escapeJson(text)}","unionId":"${escapeJson(unionId)}"}"""
        sendRequest("/api/v1/voice/answer", method = "POST", bodyJson = payload).mapCatching { body ->
            val json = JSONObject(body)
            val understood = json.getJSONObject("understood")
            val reply = json.getJSONObject("reply")
            val top = json.getJSONObject("advice").getJSONArray("options").getJSONObject(0)
            val strings = { arr: JSONArray? -> (0 until (arr?.length() ?: 0)).map { arr!!.getString(it) } }
            val tips = top.optJSONArray("stewardship")
            RemoteVoiceAnswer(
                crops = strings(understood.optJSONArray("crops")),
                heroCrop = understood.optString("hero").takeIf { it.isNotBlank() && it != "null" },
                excluded = strings(understood.optJSONArray("excluded")),
                speechBangla = reply.getString("speechBangla"),
                smsBangla = reply.optString("smsBangla"),
                topOptionBangla = top.optString("nameBangla"),
                tipsBangla = (0 until (tips?.length() ?: 0)).map { tips!!.getJSONObject(it).getString("bn") }
            )
        }
    }

    suspend fun askAi(query: String, farmProfile: JSONObject?): Result<RemoteAiResponse> = withContext(Dispatchers.IO) {
        val farmProfileStr = farmProfile?.toString()
        val payload = if (farmProfileStr != null) {
            """{"query":"${escapeJson(query)}","farmProfile":$farmProfileStr}"""
        } else {
            """{"query":"${escapeJson(query)}"}"""
        }

        val res = sendRequest("/api/v1/ai/ask", method = "POST", bodyJson = payload)
        res.mapCatching { body ->
            val json = JSONObject(body)
            val sourcesArray = json.optJSONArray("sources") ?: JSONArray()
            val suggestionsArray = json.optJSONArray("followUpSuggestions") ?: JSONArray()

            val sources = mutableListOf<String>()
            for (i in 0 until sourcesArray.length()) {
                sources.add(sourcesArray.getString(i))
            }
            val suggestions = mutableListOf<String>()
            for (i in 0 until suggestionsArray.length()) {
                suggestions.add(suggestionsArray.getString(i))
            }

            RemoteAiResponse(
                answer = json.getString("answer"),
                sources = sources,
                evidenceLevel = json.optString("evidenceLevel", "verified_high"),
                suggestions = suggestions,
                timestamp = json.optString("timestamp", "")
            )
        }
    }
}
