package org.projecteden.farmermobile.ui.screens.ai

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.projecteden.farmermobile.EdenFarmerApp
import org.projecteden.farmermobile.data.remote.RemoteAiResponse
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class ChatMessage(
    val id: String,
    val isUser: Boolean,
    val text: String,
    val sources: List<String> = emptyList(),
    val isInsufficientEvidence: Boolean = false,
    val timeFormatted: String
)

class AiAssistantViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as EdenFarmerApp
    private val apiClient = app.apiClient
    private val repository = app.repository

    private val _messages = MutableStateFlow<List<ChatMessage>>(
        listOf(
            ChatMessage(
                id = "init_0",
                isUser = false,
                text = "নমস্কার/সালাম। আমি প্রজেক্ট ইডেন কৃত্রিম বুদ্ধিমত্তা সহকারী। আমি নাসা উপগ্রহ উপাত্ত, বাংলাদেশ ধান গবেষণা ইনস্টিটিউট (BRRI) এবং মৃত্তিকা সম্পদ উন্নয়ন ইনস্টিটিউট (SRDI)-এর পরীক্ষিত তথ্যের ভিত্তিতে প্রশ্নের উত্তর দিই। আপনার জমি, সেচ বা আবহাওয়া সম্পর্কে কী জানতে চান?",
                sources = listOf("NASA Earth Science", "BRRI", "SRDI", "BWDB"),
                timeFormatted = currentTime()
            )
        )
    )
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    val promptSuggestions = listOf(
        "আমি শুধু গম করতে চাই, ধান না",
        "সূর্যমুখী আর মসুর করতে চাই",
        "আমার জমিতে সেচ কখন দেওয়া উচিত?",
        "আজকের আবহাওয়া ও মাটির অবস্থা কেমন?",
        "ব্রি ধান৭১ ও রবি মসুর চক্রের সুবিধা কি?",
        "নদীভাঙন ও আকস্মিক বন্যার ঝুঁকি আছে কি?"
    )

    /** Read a reply aloud with the phone's Bangla voice. */
    fun speak(text: String) {
        app.ttsManager.playAdvice(text, durationEstimate = maxOf(20, text.length / 12))
    }

    /**
     * A question from the keyboard or the microphone. When it names crops (to grow, as the main crop, or to avoid),
     * the server plans the year for them and the plan answers; otherwise the evidence assistant answers. A spoken
     * question gets a spoken answer.
     */
    fun sendQuery(query: String, spoken: Boolean = false) {
        val trimmed = query.trim()
        if (trimmed.isBlank() || _isLoading.value) return

        val userMsg = ChatMessage(
            id = "user_${System.currentTimeMillis()}",
            isUser = true,
            text = trimmed,
            timeFormatted = currentTime()
        )
        _messages.value = _messages.value + userMsg
        _isLoading.value = true
        Log.i(TAG, "ai_assistant_query_sent")

        viewModelScope.launch {
            val farmProfile = repository.farmProfile.firstOrNull()
            val profileJson = if (farmProfile != null) {
                JSONObject().apply {
                    put("farmName", farmProfile.farmName)
                    put("landType", farmProfile.landType)
                    put("soilTexture", farmProfile.soilTexture)
                    put("region", farmProfile.region)
                }
            } else null

            val plan = apiClient.voiceAnswer(trimmed).getOrNull()
            if (plan != null && plan.namedCrops) {
                val text = buildString {
                    append(plan.speechBangla)
                    if (plan.tipsBangla.isNotEmpty()) {
                        append("\n\nমাটি ও পানি রক্ষা:\n")
                        plan.tipsBangla.take(3).forEach { append("• ").append(it).append('\n') }
                    }
                }.trim()
                _messages.value = _messages.value + ChatMessage(
                    id = "plan_${System.currentTimeMillis()}",
                    isUser = false,
                    text = text,
                    sources = listOf("NASA POWER", "GPM IMERG", "NASA GLDAS", "SRDI", "BRRI/BARI"),
                    timeFormatted = currentTime()
                )
                if (spoken) speak(plan.speechBangla)
                Log.i(TAG, "ai_assistant_plan_answer:crops=${plan.crops.size}")
                _isLoading.value = false
                return@launch
            }

            val res = apiClient.askAi(trimmed, profileJson)
            res.fold(
                onSuccess = { aiResp ->
                    val aiMsg = ChatMessage(
                        id = "ai_${System.currentTimeMillis()}",
                        isUser = false,
                        text = aiResp.answer,
                        sources = aiResp.sources,
                        isInsufficientEvidence = aiResp.evidenceLevel == "insufficient_evidence",
                        timeFormatted = currentTime()
                    )
                    _messages.value = _messages.value + aiMsg
                    if (spoken) speak(aiResp.answer)
                    Log.i(TAG, "ai_assistant_response_received:evidence=${aiResp.evidenceLevel}")
                },
                onFailure = { err ->
                    Log.w(TAG, "ai_assistant_request_failed:${err.javaClass.simpleName}")
                    val fallbackMsg = ChatMessage(
                        id = "ai_err_${System.currentTimeMillis()}",
                        isUser = false,
                        text = "সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি। দয়া করে নেটওয়ার্ক চেক করে আবার চেষ্টা করুন।",
                        timeFormatted = currentTime()
                    )
                    _messages.value = _messages.value + fallbackMsg
                }
            )
            _isLoading.value = false
        }
    }

    private companion object {
        const val TAG = "EDEN_APP"

        fun currentTime(): String {
            return SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date())
        }
    }
}
