package org.projecteden.farmermobile.ui.screens.myfarm

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.projecteden.farmermobile.EdenFarmerApp
import org.projecteden.farmermobile.data.local.AuthState
import org.projecteden.farmermobile.data.local.AuthUser
import org.projecteden.farmermobile.data.model.FarmProfileEntity

class MyFarmViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as EdenFarmerApp
    private val repository = app.repository
    private val authManager = app.authManager

    val farmProfile: StateFlow<FarmProfileEntity> = repository.farmProfile.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = FarmProfileEntity()
    )

    val authState: StateFlow<AuthState> = authManager.authState

    private val _isEditing = MutableStateFlow(false)
    val isEditing: StateFlow<Boolean> = _isEditing.asStateFlow()

    private val _draftProfile = MutableStateFlow<FarmProfileEntity?>(null)
    val draftProfile: StateFlow<FarmProfileEntity?> = _draftProfile.asStateFlow()

    private val _isUpdating = MutableStateFlow(false)
    val isUpdating: StateFlow<Boolean> = _isUpdating.asStateFlow()

    private val _feedbackMessage = MutableStateFlow<String?>(null)
    val feedbackMessage: StateFlow<String?> = _feedbackMessage.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    fun logEditOpened() {
        Log.i(TAG, "farm_profile_edit_opened")
    }

    fun logEditCancelled() {
        Log.i(TAG, "farm_profile_edit_cancelled")
    }

    fun startEditing() {
        // The location and plot cards remain visible below the edit form. If one is tapped
        // while editing, keep the current draft instead of replacing it with the saved profile.
        if (_isEditing.value) return
        val current = farmProfile.value
        _draftProfile.value = current
        _isEditing.value = true
        _feedbackMessage.value = null
        _errorMessage.value = null
        Log.i(TAG, "farm_profile_edit_opened")
    }

    fun updateDraft(transform: (FarmProfileEntity) -> FarmProfileEntity) {
        val current = _draftProfile.value ?: farmProfile.value
        _draftProfile.value = transform(current)
    }

    fun cancelEditing() {
        _draftProfile.value = null
        _isEditing.value = false
        _errorMessage.value = null
        Log.i(TAG, "farm_profile_edit_cancelled")
    }

    fun saveDraft() {
        val draft = _draftProfile.value ?: return
        if (_isUpdating.value) return

        if (draft.farmName.trim().isBlank()) {
            _errorMessage.value = "খামারের নাম খালি রাখা যাবে না"
            return
        }
        if (draft.region.trim().isBlank()) {
            _errorMessage.value = "অঞ্চলের নাম খালি রাখা যাবে না"
            return
        }

        viewModelScope.launch {
            _isUpdating.value = true
            _feedbackMessage.value = null
            _errorMessage.value = null
            try {
                repository.saveProfile(draft)
                _isEditing.value = false
                _draftProfile.value = null
                _feedbackMessage.value = "খামারের তথ্য সফলভাবে সংরক্ষিত হয়েছে"
                Log.i(TAG, "farm_profile_save_success")
                delay(2500)
                _feedbackMessage.value = null
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _errorMessage.value = "তথ্য সংরক্ষণ করা যায়নি; আবার চেষ্টা করুন"
                Log.w(TAG, "farm_profile_save_failed:${error.javaClass.simpleName}")
            } finally {
                _isUpdating.value = false
            }
        }
    }

    fun updateFarmInfo(profile: FarmProfileEntity) {
        if (_isUpdating.value) return
        viewModelScope.launch {
            _isUpdating.value = true
            _feedbackMessage.value = null
            _errorMessage.value = null
            try {
                repository.saveProfile(profile)
                _isEditing.value = false
                _draftProfile.value = null
                _feedbackMessage.value = "খামারের তথ্য সফলভাবে সংরক্ষিত হয়েছে"
                Log.i(TAG, "farm_profile_save_success")
                delay(2500)
                _feedbackMessage.value = null
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _errorMessage.value = "তথ্য সংরক্ষণ করা যায়নি; আবার চেষ্টা করুন"
                Log.w(TAG, "farm_profile_save_failed:${error.javaClass.simpleName}")
            } finally {
                _isUpdating.value = false
            }
        }
    }

    fun login(role: String, id: String, pinOrCode: String, onResult: (Result<AuthUser>) -> Unit) {
        viewModelScope.launch {
            val res = authManager.login(role, id, pinOrCode)
            if (res.isSuccess) {
                Log.i(TAG, "user_logged_in:$role")
                _feedbackMessage.value = "লগইন সফল হয়েছে"
                delay(2000)
                _feedbackMessage.value = null
            } else {
                Log.w(TAG, "user_login_failed")
                _errorMessage.value = "লগইন ব্যর্থ হয়েছে; সঠিক তথ্য দিন"
            }
            onResult(res)
        }
    }

    fun logout() {
        viewModelScope.launch {
            authManager.logout()
            Log.i(TAG, "user_logged_out")
            _feedbackMessage.value = "সাইন আউট সম্পন্ন হয়েছে"
            delay(2000)
            _feedbackMessage.value = null
        }
    }

    fun clearError() {
        _errorMessage.value = null
    }

    private companion object {
        const val TAG = "EDEN_APP"
    }
}
