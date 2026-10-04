package org.projecteden.farmermobile.weather

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.projecteden.farmermobile.data.remote.ApiErrorKind
import org.projecteden.farmermobile.data.remote.ApiException
import org.projecteden.farmermobile.data.remote.ApiParsers
import org.projecteden.farmermobile.data.remote.EdenApiClient
import java.net.InetSocketAddress

/** Runs the real client against a JDK HTTP server that speaks the API contract (docs/api-contract.md). */
class ApiClientAndParserTest {
    private lateinit var server: HttpServer
    private val requests = mutableListOf<String>()
    private var status = 200
    private var body = "{}"
    private var contentType = "application/json"
    private val base get() = "http://127.0.0.1:${server.address.port}"

    @Before fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            requests += ex.requestURI.toString()
            val bytes = body.toByteArray()
            ex.responseHeaders.add("Content-Type", contentType)
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @After fun stop() = server.stop(0)

    private val forecastJson = """
      {"location":{"lat":23.81,"lon":90.41},"source":{"provider":"Open-Meteo","kind":"model_estimate","live":true,"fetchedAt":"2026-10-03T10:00:00Z","validAt":"2026-10-03T16:00","note":"n"},
       "forecast":{"timezone":"Asia/Dhaka","utcOffsetSeconds":21600,
         "current":{"time":"2026-10-03T16:00","temperatureC":30.1,"apparentTemperatureC":null,"relativeHumidityPct":63,"precipitationMm":0,"windSpeedMs":null,"weatherCode":1},
         "hourly":[{"time":"2026-10-03T16:00","temperatureC":30.1,"relativeHumidityPct":63,"precipitationProbabilityPct":5,"precipitationMm":0,"weatherCode":1},
                   {"time":"2026-10-03T17:00","temperatureC":null,"relativeHumidityPct":null,"precipitationProbabilityPct":null,"precipitationMm":null,"weatherCode":null}],
         "daily":[{"date":"2026-10-03","weatherCode":1,"temperatureMaxC":31,"temperatureMinC":25,"precipitationMm":0,"precipitationProbabilityMaxPct":10}]}}"""

    @Test fun forecastParsingKeepsNullsAndHourlyHumidity() {
        val f = ApiParsers.forecast(forecastJson)
        assertEquals(23.81, f.latitude, 0.0)
        assertEquals("model_estimate", f.source.kind)
        assertTrue(f.source.live)
        assertNull("missing apparent temperature must stay null, not 0", f.current.apparentTemperatureC)
        assertNull(f.current.windSpeedMs)
        assertEquals(63.0, f.hourly[0].humidityPct!!, 0.0)
        assertNull(f.hourly[1].temperatureC)
        assertNull(f.hourly[1].humidityPct)
        assertEquals(21600, f.utcOffsetSeconds)
    }

    @Test fun observationsAreDelayedAndHaveNoSoilMoisture() {
        val json = """{"location":{"lat":22.35,"lon":91.83},"source":{"provider":"NASA POWER (community AG)","kind":"satellite_delayed","live":false,"note":"x"},
          "isLive":false,"latestObservationDate":"2026-09-30","windowStart":"2026-09-01","windowEnd":"2026-09-30","daysWithData":30,
          "latest":{"date":"2026-09-30","t2m":28.1,"t2mMax":null,"t2mMin":24,"rh2m":null,"rainMm":0,"windSpeedMs":2},
          "meanT2mWindow":28.4,"rainWindowMm":null,"rainDaysWithData":0,"soilMoisture":{"status":"unavailable","reason":"not in POWER"},"recentDays":[]}"""
        val o = ApiParsers.observations(json)
        assertFalse(o.source.live)
        assertEquals("satellite_delayed", o.source.kind)
        assertNull(o.latest.t2mMax); assertNull(o.latest.rh2m); assertNull(o.rainWindowMm)
        assertEquals("not in POWER", o.soilMoistureUnavailableReason)
    }

    @Test fun locationsParseTheDistrictHierarchy() {
        val c = ApiParsers.locations("""{"version":"v","districts":[{"id":"D","nameEn":"Dhaka","nameBn":"ঢাকা","upazilas":[{"id":"U","nameEn":"Savar","nameBn":"সাভার","lat":23.8,"lon":90.2,"approximate":true}]}]}""")
        assertEquals(1, c.upazilaCount)
        assertEquals("Savar", c.findUpazila("U")!!.second.nameEn)
    }

    @Test fun clientSendsTheRequestedCoordinatesToTheConfiguredServer() = runTest {
        body = forecastJson
        val result = EdenApiClient(base).fetchForecast(24.89, 91.87)
        assertTrue(result.isSuccess)
        assertEquals(listOf("/api/v1/weather/forecast?lat=24.89000&lon=91.87000"), requests)
    }

    @Test fun errorEnvelopeIsMappedToTypedFailures() = runTest {
        val cases = mapOf(
            "provider_unavailable" to (502 to ApiErrorKind.PROVIDER_UNAVAILABLE),
            "invalid_input" to (400 to ApiErrorKind.INVALID_INPUT),
            "no_data" to (404 to ApiErrorKind.NO_DATA),
            "configuration_required" to (503 to ApiErrorKind.CONFIGURATION_REQUIRED),
            "not_found" to (404 to ApiErrorKind.NOT_FOUND),
        )
        for ((code, expected) in cases) {
            status = expected.first
            body = """{"error":{"code":"$code","message":"m-$code"},"status":${expected.first}}"""
            val err = EdenApiClient(base).fetchForecast(23.8, 90.4).exceptionOrNull() as ApiException
            assertEquals(code, expected.second, err.kind)
            assertEquals("m-$code", err.message)
        }
    }

    @Test fun htmlFromAWrongBaseUrlIsReportedAsMalformedNotAsData() = runTest {
        contentType = "text/html"; body = "<!doctype html><html></html>"
        val err = EdenApiClient(base).fetchForecast(23.8, 90.4).exceptionOrNull() as ApiException
        assertEquals(ApiErrorKind.MALFORMED, err.kind)
    }

    @Test fun anUnreachableServerIsOffline() = runTest {
        val port = server.address.port
        server.stop(0)
        val err = EdenApiClient("http://127.0.0.1:$port").fetchLocations().exceptionOrNull() as ApiException
        assertEquals(ApiErrorKind.OFFLINE, err.kind)
        start() // @After stops the server; give it a live one
    }

    @Test fun cattleAdvisoryParsesEvidenceSections() {
        val json = """{"advisory":{"aoiId":"a","farmLabel":"F","generatedAt":"t",
          "measured":{"forecast":{"source":{"provider":"Open-Meteo","kind":"model_estimate","live":true,"note":""}},"nasaPower":{"status":"unavailable","reason":"x"},"satellite":{"status":"unavailable","reason":"Earth Engine not configured","features":[],"unavailable":[]}},
          "derived":{"thi":{"current":80.4,"category":"danger","formula":"NRC","thresholdNote":"generic","hourly":[{"time":"2026-10-03T22:00","temperatureC":27,"relativeHumidityPct":90,"thi":78,"category":"alert"}],"hoursMissingInputs":1,"lowestThiHours":["03:00"]}},
          "heuristic":{"basis":"generic","summaryBangla":"s","summaryEnglish":"e","bulletsBangla":["b"],"bulletsEnglish":["e"],"waterDemand":{"labelBangla":"w"}},
          "forageStatus":{"ndviProxy":null},"modelStatus":{"supervisedModelAvailable":false}}}"""
        val a = ApiParsers.cattleAdvisory(json)
        assertEquals("danger", a.thiCategory)
        assertEquals("unavailable", a.satelliteStatus)
        assertNull(a.ndvi)
        assertFalse(a.supervisedModelAvailable)
        assertEquals(1, a.hoursMissingInputs)
    }
}
