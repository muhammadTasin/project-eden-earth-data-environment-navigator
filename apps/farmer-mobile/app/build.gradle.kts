import java.util.Properties

plugins {
  id("com.google.devtools.ksp")

  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

/**
 * API base URL per build type. Nothing is hardcoded: set these in local.properties (not committed), in
 * ~/.gradle/gradle.properties, or with -P on the command line:
 *   eden.baseUrl.debug   default http://10.0.2.2:4000 (the Android emulator's alias for the host machine)
 *   eden.baseUrl.release REQUIRED for release builds and must be https://
 */
fun edenProperty(name: String): String? {
    val local = Properties().apply {
        val file = rootProject.file("local.properties")
        if (file.exists()) file.inputStream().use { load(it) }
    }
    return (project.findProperty(name) as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?: local.getProperty(name)?.trim()?.takeIf { it.isNotEmpty() }
}

val debugBaseUrl = edenProperty("eden.baseUrl.debug") ?: "http://10.0.2.2:4000"
val releaseBaseUrl = edenProperty("eden.baseUrl.release") ?: ""
val buildingRelease = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
if (buildingRelease) {
    // A release build must never ship with a missing or cleartext API URL.
    require(releaseBaseUrl.startsWith("https://")) {
        "Release builds need eden.baseUrl.release=https://<your-api-host> (local.properties, gradle.properties or -P). Got: '$releaseBaseUrl'"
    }
}

android {
    namespace = "org.projecteden.farmermobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "org.projecteden.farmermobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            buildConfigField("String", "EDEN_BASE_URL", "\"${debugBaseUrl.trimEnd('/')}\"")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "EDEN_BASE_URL", "\"${releaseBaseUrl.trimEnd('/')}\"")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = true
      aidl = false
      buildConfig = true
      shaders = false
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
  implementation("androidx.room:room-runtime:2.7.0")
  implementation("androidx.room:room-ktx:2.7.0")
  ksp("androidx.room:room-compiler:2.7.0")
  implementation(libs.play.services.location)
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation("androidx.compose.material:material-icons-core")
  implementation("androidx.compose.material:material-icons-extended")

  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Local tests: jUnit, coroutines, Android runner
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  // Real org.json on the JVM so response-parsing tests run (android.jar's org.json is stubbed in unit tests)
  testImplementation("org.json:json:20240303")

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Navigation
  implementation(libs.androidx.navigation3.ui)
  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)
}
