package org.projecteden.farmermobile.data.remote

/** What went wrong talking to the shared API (contract: docs/api-contract.md in Edith_Web_App_Connectivity). */
enum class ApiErrorKind {
    /** No connection to the server at all (no network, DNS, refused). */
    OFFLINE,
    TIMEOUT,
    /** 400: bad coordinates or body. */
    INVALID_INPUT,
    /** 502: Open-Meteo / NASA POWER / TTS / LLM failed upstream. */
    PROVIDER_UNAVAILABLE,
    /** Valid request, nothing to show yet (e.g. no advisory produced). */
    NO_DATA,
    /** 503: needs server configuration (Earth Engine, TTS). */
    CONFIGURATION_REQUIRED,
    NOT_FOUND,
    UNAUTHORIZED,
    SERVER,
    /** The response was not the JSON the contract describes (e.g. wrong base URL serving HTML). */
    MALFORMED;

    companion object {
        /** Maps the API's `error.code` strings. */
        fun fromCode(code: String?): ApiErrorKind? = when (code) {
            "invalid_input" -> INVALID_INPUT
            "unauthorized" -> UNAUTHORIZED
            "not_found" -> NOT_FOUND
            "no_data" -> NO_DATA
            "provider_unavailable" -> PROVIDER_UNAVAILABLE
            "configuration_required" -> CONFIGURATION_REQUIRED
            "internal" -> SERVER
            else -> null
        }

        fun fromHttpStatus(status: Int): ApiErrorKind = when (status) {
            400, 422 -> INVALID_INPUT
            401 -> UNAUTHORIZED
            404 -> NOT_FOUND
            502 -> PROVIDER_UNAVAILABLE
            503 -> CONFIGURATION_REQUIRED
            else -> SERVER
        }
    }
}

class ApiException(
    val kind: ApiErrorKind,
    message: String,
    val httpStatus: Int? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

/** Short Bangla text for each failure, shown beside a retry button. */
fun ApiErrorKind.messageBangla(): String = when (this) {
    ApiErrorKind.OFFLINE -> "ইন্টারনেট বা সার্ভারের সাথে সংযোগ নেই। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।"
    ApiErrorKind.TIMEOUT -> "সার্ভার সময়মতো উত্তর দেয়নি। আবার চেষ্টা করুন।"
    ApiErrorKind.INVALID_INPUT -> "অবস্থান বা তথ্য সঠিক নয়। অন্য অবস্থান বেছে নিন।"
    ApiErrorKind.PROVIDER_UNAVAILABLE -> "তথ্য সরবরাহকারী সেবা (আবহাওয়া/নাসা) এখন পাওয়া যাচ্ছে না। পরে আবার চেষ্টা করুন।"
    ApiErrorKind.NO_DATA -> "এই অবস্থানের জন্য কোনো উপাত্ত পাওয়া যায়নি।"
    ApiErrorKind.CONFIGURATION_REQUIRED -> "সার্ভারে এই সুবিধার কনফিগারেশন নেই।"
    ApiErrorKind.NOT_FOUND -> "অনুরোধ করা তথ্য পাওয়া যায়নি।"
    ApiErrorKind.UNAUTHORIZED -> "অনুমতি নেই।"
    ApiErrorKind.SERVER -> "সার্ভারে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।"
    ApiErrorKind.MALFORMED -> "সার্ভারের উত্তর বোঝা যায়নি। সার্ভারের ঠিকানা (API URL) ঠিক আছে কি না দেখুন।"
}

fun Throwable.apiErrorKind(): ApiErrorKind = (this as? ApiException)?.kind ?: ApiErrorKind.OFFLINE
