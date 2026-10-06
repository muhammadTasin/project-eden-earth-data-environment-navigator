package org.projecteden.farmermobile.data.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import org.projecteden.farmermobile.data.model.CattleAdvisory
import org.projecteden.farmermobile.data.model.CattleAoi
import org.projecteden.farmermobile.data.model.CattleJob
import org.projecteden.farmermobile.data.model.ForecastResponse
import org.projecteden.farmermobile.data.model.LocationCatalog
import org.projecteden.farmermobile.data.model.ObservationResponse

/**
 * The detailed pilot (Talanda union, Tanore). Advice goes to the upazila nearest the farmer's saved location
 * (see location/AdvicePlace.kt) and falls back to the pilot when no location is saved or the server cannot say.
 */
const val PILOT_UNION_ID = "talanda_tanore"

/** One of the 544 upazilas the rotation engine plans for (geoBoundaries ids, e.g. ADM3_Khaliajuri). */
data class AdvicePlace(val id: String, val name: String, val district: String)

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

/** Response from the in-repository crop-planning voice endpoint, when the configured API exposes it. */
data class RemoteVoiceAnswer(
    val crops: List<String>,
    val heroCrop: String?,
    val excluded: List<String>,
    val speechBangla: String,
    val smsBangla: String,
    val topOptionBangla: String,
    val tipsBangla: List<String>
) {
    val namedCrops: Boolean get() = crops.isNotEmpty() || heroCrop != null || excluded.isNotEmpty()
}

/** The slice of the shared API the weather and cattle screens use. Fake it in unit tests. */
interface EdenApi {
    suspend fun fetchLocations(): Result<LocationCatalog>
    suspend fun fetchForecast(lat: Double, lon: Double): Result<ForecastResponse>
    suspend fun fetchObservations(lat: Double, lon: Double): Result<ObservationResponse>
    suspend fun fetchCattleAois(): Result<List<CattleAoi>>
    suspend fun fetchCattleAdvisory(aoiId: String): Result<CattleAdvisory>
    suspend fun fetchCattleJobs(aoiId: String): Result<List<CattleJob>>
}

/**
 * HTTP client for the shared Project EDEN API (the Edith_Web_App_Connectivity server; contract in docs/api-contract.md).
 * It talks to exactly one configured base URL (BuildConfig.EDEN_BASE_URL, set per build type): there is no host
 * guessing and no fallback server. Failures are ApiException with an ApiErrorKind.
 */
open class EdenApiClient(
    val baseUrl: String
) : EdenApi {
    private val root: String = baseUrl.trim().trimEnd('/')

    private fun escapeJson(value: String): String {
        return value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private fun readBody(stream: java.io.InputStream?): String =
        stream?.let { BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() } }.orEmpty()

    /** Maps an error response to ApiException using the API's `{error:{code,message}}` envelope when present. */
    internal fun errorFor(status: Int, body: String): ApiException {
        val env = try { JSONObject(body).optJSONObject("error") } catch (_: Exception) { null }
        val kind = ApiErrorKind.fromCode(env?.optString("code")) ?: ApiErrorKind.fromHttpStatus(status)
        return ApiException(kind, env?.optString("message")?.takeIf { it.isNotBlank() } ?: "HTTP $status", status)
    }

    private suspend fun sendRequest(
        path: String,
        method: String = "GET",
        authToken: String? = null,
        bodyJson: String? = null
    ): Result<String> = withContext(Dispatchers.IO) {
        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$root$path").openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 8000
                readTimeout = 20000
                setRequestProperty("Accept", "application/json")
                if (authToken != null) setRequestProperty("Authorization", "Bearer $authToken")
                if (bodyJson != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            if (bodyJson != null) conn.outputStream.use { it.write(bodyJson.toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            if (code in 200..299) {
                Result.success(readBody(conn.inputStream))
            } else {
                Result.failure(errorFor(code, readBody(conn.errorStream)))
            }
        } catch (e: java.net.SocketTimeoutException) {
            Result.failure(ApiException(ApiErrorKind.TIMEOUT, "Timed out calling $path", cause = e))
        } catch (e: java.io.IOException) {
            // DNS failure, refused connection, no route, cleartext blocked, TLS failure, dropped connection ...
            Result.failure(ApiException(ApiErrorKind.OFFLINE, e.message ?: "Network error", cause = e))
        } catch (e: IllegalArgumentException) {
            Result.failure(ApiException(ApiErrorKind.MALFORMED, "Invalid API URL: $root", cause = e))
        } finally {
            conn?.disconnect()
        }
    }

    /** Runs [parse] on a successful body; a parse failure means the server did not answer in the contract's shape. */
    private fun <T> Result<String>.parsed(parse: (String) -> T): Result<T> = fold(
        onSuccess = { body ->
            try {
                Result.success(parse(body))
            } catch (e: Exception) {
                Result.failure(ApiException(ApiErrorKind.MALFORMED, "Unexpected response: ${e.message}", cause = e))
            }
        },
        onFailure = { Result.failure(it) },
    )

    private fun coords(lat: Double, lon: Double) = "lat=${String.format(java.util.Locale.ROOT, "%.5f", lat)}&lon=${String.format(java.util.Locale.ROOT, "%.5f", lon)}"

    override suspend fun fetchLocations(): Result<LocationCatalog> =
        sendRequest("/api/v1/locations").parsed(ApiParsers::locations)

    override suspend fun fetchForecast(lat: Double, lon: Double): Result<ForecastResponse> =
        sendRequest("/api/v1/weather/forecast?${coords(lat, lon)}").parsed(ApiParsers::forecast)

    override suspend fun fetchObservations(lat: Double, lon: Double): Result<ObservationResponse> =
        sendRequest("/api/v1/weather?${coords(lat, lon)}").parsed(ApiParsers::observations)

    override suspend fun fetchCattleAois(): Result<List<CattleAoi>> =
        sendRequest("/api/v1/cattle/aois").parsed(ApiParsers::cattleAois)

    override suspend fun fetchCattleAdvisory(aoiId: String): Result<CattleAdvisory> =
        sendRequest("/api/v1/cattle/aois/${java.net.URLEncoder.encode(aoiId, "UTF-8")}/advisory").parsed(ApiParsers::cattleAdvisory)

    override suspend fun fetchCattleJobs(aoiId: String): Result<List<CattleJob>> =
        sendRequest("/api/v1/cattle/jobs?aoiId=${java.net.URLEncoder.encode(aoiId, "UTF-8")}").parsed(ApiParsers::cattleJobs)

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

    /** The engine's upazila nearest a point, from the daily NASA file (`/api/v1/live/upazila?lat=&lon=`). */
    open suspend fun nearestAdvicePlace(lat: Double, lon: Double): Result<AdvicePlace> =
        sendRequest("/api/v1/live/upazila?${coords(lat, lon)}").mapCatching { body ->
            val j = JSONObject(body)
            AdvicePlace(j.getString("id"), j.optString("name"), j.optString("district"))
        }

    suspend fun fetchAdvice(
        landType: String = "medium_high",
        waterWeight: Double = 0.5,
        incomeWeight: Double = 0.3,
        soilWeight: Double = 0.2,
        unionId: String = PILOT_UNION_ID
    ): Result<RemoteAdviceResponse> = withContext(Dispatchers.IO) {
        val payload = """{"unionId":"${escapeJson(unionId)}","landType":"${escapeJson(landType)}","farmerPriorities":{"water":$waterWeight,"income":$incomeWeight,"soil":$soilWeight}}"""
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

    /** POST /api/v1/voice/answer. If the configured shared API lacks this optional route, callers can fall back to /ai/ask. */
    suspend fun voiceAnswer(text: String, unionId: String = PILOT_UNION_ID): Result<RemoteVoiceAnswer> = withContext(Dispatchers.IO) {
        val payload = JSONObject().put("text", text).put("unionId", unionId).toString()
        sendRequest("/api/v1/voice/answer", method = "POST", bodyJson = payload).mapCatching { body ->
            val json = JSONObject(body)
            val understood = json.getJSONObject("understood")
            val reply = json.getJSONObject("reply")
            val top = json.getJSONObject("advice").getJSONArray("options").getJSONObject(0)
            fun strings(array: JSONArray?): List<String> =
                (0 until (array?.length() ?: 0)).map { array!!.getString(it) }
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

    suspend fun askAi(query: String, farmProfile: JSONObject?, lat: Double? = null, lon: Double? = null): Result<RemoteAiResponse> = withContext(Dispatchers.IO) {
        // lat/lon are the user's selected location; without them the server declines weather questions instead of guessing.
        val body = JSONObject().put("query", query)
        if (farmProfile != null) body.put("farmProfile", farmProfile)
        if (lat != null && lon != null) body.put("lat", lat).put("lon", lon)
        val payload = body.toString()

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
                evidenceLevel = json.optString("evidenceLevel", "insufficient_evidence"),
                suggestions = suggestions,
                timestamp = json.optString("timestamp", "")
            )
        }
    }
}
