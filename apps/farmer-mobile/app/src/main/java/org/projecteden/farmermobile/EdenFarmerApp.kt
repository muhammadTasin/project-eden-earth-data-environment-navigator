package org.projecteden.farmermobile

import android.app.Application
import org.projecteden.farmermobile.audio.BanglaTtsManager
import org.projecteden.farmermobile.data.local.AuthManager
import org.projecteden.farmermobile.data.local.EdenDatabase
import org.projecteden.farmermobile.data.remote.EdenApiClient
import org.projecteden.farmermobile.data.repository.FarmerRepository

class EdenFarmerApp : Application() {

    lateinit var database: EdenDatabase
        private set

    lateinit var apiClient: EdenApiClient
        private set

    lateinit var authManager: AuthManager
        private set

    lateinit var repository: FarmerRepository
        private set

    lateinit var ttsManager: BanglaTtsManager
        private set

    override fun onCreate() {
        super.onCreate()
        database = EdenDatabase.getInstance(this)
        // One configured API (per build type, see build.gradle.kts / gradle.properties.example); no host guessing.
        apiClient = EdenApiClient(baseUrl = BuildConfig.EDEN_BASE_URL)
        authManager = AuthManager(this, apiClient)
        repository = FarmerRepository(database.farmDao(), apiClient) {
            org.projecteden.farmermobile.location.adviceUnionId(org.projecteden.farmermobile.location.PrefsLocationStore(this), apiClient)
        }
        ttsManager = BanglaTtsManager(this)
    }

    override fun onTerminate() {
        super.onTerminate()
        ttsManager.shutdown()
    }
}
