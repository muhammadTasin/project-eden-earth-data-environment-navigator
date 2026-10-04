package org.projecteden.farmermobile.ui.screens.weather

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Air
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Thunderstorm
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.projecteden.farmermobile.data.model.CattleAdvisory
import org.projecteden.farmermobile.data.model.CattleJob
import org.projecteden.farmermobile.data.model.District
import org.projecteden.farmermobile.data.model.ForecastDay
import org.projecteden.farmermobile.data.model.ForecastHour
import org.projecteden.farmermobile.data.model.ForecastResponse
import org.projecteden.farmermobile.data.model.ObservationResponse
import org.projecteden.farmermobile.data.remote.ApiErrorKind
import org.projecteden.farmermobile.data.remote.messageBangla
import org.projecteden.farmermobile.domain.CattleThi
import org.projecteden.farmermobile.domain.ThiCategory
import org.projecteden.farmermobile.domain.WeatherCodes
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnPrimaryContainer
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.PrimaryFixed
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceContainerLow
import org.projecteden.farmermobile.theme.Tertiary
import org.projecteden.farmermobile.ui.components.EdenTopAppBar
import java.util.Locale

private val locationPermissions = arrayOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION,
)

private fun fmt(value: Double?, unit: String = "", digits: Int = 1): String =
    if (value == null) "—" else String.format(Locale.ROOT, "%.${digits}f", value) + unit

@Composable
fun WeatherScreen(
    viewModel: WeatherViewModel = viewModel(),
    onNavigateToProfile: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scrollState = rememberScrollState()

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) viewModel.useGps() else viewModel.onPermissionDenied()
    }
    val onUseGps = {
        if (viewModel.hasLocationPermission()) viewModel.useGps() else permissionLauncher.launch(locationPermissions)
    }

    val forecastFailedOffline = (state.forecast as? Section.Failed)?.kind.let { it == ApiErrorKind.OFFLINE || it == ApiErrorKind.TIMEOUT }

    Column(modifier = modifier.fillMaxSize().background(Surface)) {
        EdenTopAppBar(
            title = "আবহাওয়া ও মাটির রস",
            isOffline = forecastFailedOffline,
            onProfileClick = onNavigateToProfile
        )

        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(scrollState).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            LocationNoticeBanner(state.notice, onDismiss = viewModel::dismissNotice)

            LocationCard(
                state = state,
                onUseGps = onUseGps,
                onSelect = viewModel::selectUpazila,
                onRefresh = viewModel::refresh,
                onRetryCatalog = viewModel::retryCatalog,
            )

            val target = state.target
            if (target == null) {
                if (state.catalog is CatalogState.Ready) {
                    InfoCard("আবহাওয়া দেখতে উপরে জেলা ও উপজেলা বেছে নিন, অথবা \"আমার অবস্থান\" ব্যবহার করুন। কোনো ডিফল্ট স্থান ধরে নেওয়া হয় না।")
                }
            } else {
                ForecastSection(state.forecast, onRetry = viewModel::refresh)
                val forecast = (state.forecast as? Section.Ready)?.data ?: (state.forecast as? Section.Failed)?.stale
                if (forecast != null) HourlyThiCard(forecast)
                ObservationsSection(state.observations, onRetry = viewModel::refresh)
            }

            CattleAdvisorySection()

            AttributionCard()
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------------------------------------------

@Composable
private fun LocationNoticeBanner(notice: LocationNotice?, onDismiss: () -> Unit) {
    val text = when (notice) {
        null -> return
        LocationNotice.LOCATING -> "আপনার অবস্থান নির্ণয় করা হচ্ছে…"
        LocationNotice.PERMISSION_DENIED -> "লোকেশনের অনুমতি দেওয়া হয়নি। জেলা ও উপজেলা হাতে বেছে নিন; চাইলে পরে ফোনের সেটিংস থেকে অনুমতি দিতে পারেন।"
        LocationNotice.GPS_DISABLED -> "ফোনের লোকেশন (জিপিএস) বন্ধ আছে। চালু করুন অথবা জেলা ও উপজেলা হাতে বেছে নিন।"
        LocationNotice.GPS_UNAVAILABLE -> "অবস্থান নির্ণয় করা যায়নি (সংকেত দুর্বল বা সময় শেষ)। আবার চেষ্টা করুন অথবা হাতে বেছে নিন।"
        LocationNotice.OUTSIDE_BANGLADESH -> "আপনার অবস্থান বাংলাদেশের বাইরে। জেলা ও উপজেলা হাতে বেছে নিন।"
    }
    Surface(
        color = SurfaceContainerHigh,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, Tertiary.copy(alpha = 0.3f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (notice == LocationNotice.LOCATING) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Tertiary)
                } else {
                    Icon(Icons.Default.Info, contentDescription = null, tint = Tertiary, modifier = Modifier.size(18.dp))
                }
                Text(text, style = MaterialTheme.typography.bodySmall, color = OnSurface)
            }
            if (notice != LocationNotice.LOCATING) {
                IconButton(onClick = onDismiss, modifier = Modifier.size(24.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "বন্ধ করুন", modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
private fun LocationCard(
    state: WeatherState,
    onUseGps: () -> Unit,
    onSelect: (districtId: String, upazilaId: String) -> Unit,
    onRefresh: () -> Unit,
    onRetryCatalog: () -> Unit,
) {
    val target = state.target
    Surface(color = PrimaryContainer, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (target == null) {
                        Text("স্থান নির্বাচন করুন", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = OnPrimary)
                    } else {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(
                                imageVector = if (target is WeatherTarget.Gps) Icons.Default.MyLocation else Icons.Default.LocationOn,
                                contentDescription = null, tint = PrimaryFixed, modifier = Modifier.size(20.dp)
                            )
                            Text(
                                text = when (target) {
                                    is WeatherTarget.Admin -> "${target.upazila.nameBn}, ${target.district.nameBn}"
                                    is WeatherTarget.Gps -> "আপনার বর্তমান অবস্থান"
                                },
                                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = OnPrimary
                            )
                        }
                        Text(
                            text = "স্থানাঙ্ক: ${String.format(Locale.ROOT, "%.3f", target.latitude)}° N, ${String.format(Locale.ROOT, "%.3f", target.longitude)}° E" +
                                when (target) {
                                    is WeatherTarget.Admin -> " (প্রশাসনিক এলাকার আনুমানিক কেন্দ্র)"
                                    is WeatherTarget.Gps -> if (target.approximate) " (আনুমানিক জিপিএস)" else " (জিপিএস, ~১ কিমি নির্ভুলতায় গোল করা)"
                                },
                            style = MaterialTheme.typography.labelSmall, color = OnPrimaryContainer
                        )
                    }
                }
                if (target != null) {
                    val loading = state.forecast is Section.Loading || state.observations is Section.Loading
                    Button(
                        onClick = onRefresh,
                        enabled = !loading,
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryFixed, contentColor = Primary)
                    ) {
                        if (loading) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Primary, strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = "রিফ্রেশ", modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("রিফ্রেশ", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                        }
                    }
                }
            }

            when (val catalog = state.catalog) {
                CatalogState.Loading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = OnPrimary)
                    Text("জেলা-উপজেলার তালিকা লোড হচ্ছে…", style = MaterialTheme.typography.bodySmall, color = OnPrimary)
                }
                is CatalogState.Failed -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("জেলা-উপজেলার তালিকা লোড করা যায়নি। ${catalog.kind.messageBangla()}", style = MaterialTheme.typography.bodySmall, color = OnPrimary)
                    OutlinedButton(onClick = onRetryCatalog) { Text("আবার চেষ্টা করুন", color = OnPrimary) }
                }
                is CatalogState.Ready -> DistrictUpazilaPicker(catalog.districts(), target, onSelect)
            }

            Button(
                onClick = onUseGps,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryFixed, contentColor = Primary)
            ) {
                Icon(Icons.Default.MyLocation, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("আমার বর্তমান অবস্থান ব্যবহার করুন", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

private fun CatalogState.Ready.districts(): List<District> = catalog.districts

@Composable
private fun DistrictUpazilaPicker(districts: List<District>, target: WeatherTarget?, onSelect: (String, String) -> Unit) {
    var districtId by remember(target?.key) { mutableStateOf((target as? WeatherTarget.Admin)?.district?.id) }
    var districtMenu by remember { mutableStateOf(false) }
    var upazilaMenu by remember { mutableStateOf(false) }
    val district = districts.firstOrNull { it.id == districtId }
    val selectedUpazilaId = (target as? WeatherTarget.Admin)?.upazila?.id

    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(modifier = Modifier.weight(1f)) {
            OutlinedButton(onClick = { districtMenu = true }, modifier = Modifier.fillMaxWidth()) {
                Text(district?.nameBn ?: "জেলা", maxLines = 1, color = OnPrimary, fontSize = 13.sp)
            }
            DropdownMenu(expanded = districtMenu, onDismissRequest = { districtMenu = false }) {
                districts.forEach { d ->
                    DropdownMenuItem(text = { Text(d.nameBn) }, onClick = { districtId = d.id; districtMenu = false; upazilaMenu = true })
                }
            }
        }
        Box(modifier = Modifier.weight(1f)) {
            OutlinedButton(onClick = { upazilaMenu = true }, enabled = district != null, modifier = Modifier.fillMaxWidth()) {
                val label = district?.upazilas?.firstOrNull { it.id == selectedUpazilaId }?.nameBn ?: "উপজেলা"
                Text(label, maxLines = 1, color = OnPrimary, fontSize = 13.sp)
            }
            DropdownMenu(expanded = upazilaMenu && district != null, onDismissRequest = { upazilaMenu = false }) {
                district?.upazilas?.forEach { u ->
                    DropdownMenuItem(text = { Text(u.nameBn) }, onClick = { upazilaMenu = false; onSelect(district.id, u.id) })
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Open-Meteo forecast (numerical model estimate)
// ---------------------------------------------------------------------------------------------------------------

@Composable
private fun ForecastSection(section: Section<ForecastResponse>, onRetry: () -> Unit) {
    when (section) {
        Section.Idle -> {}
        is Section.Loading -> {
            LoadingCard("আবহাওয়া পূর্বাভাস লোড হচ্ছে…")
            section.stale?.let { ForecastContent(it) }
        }
        is Section.Failed -> {
            ErrorCard("আবহাওয়া পূর্বাভাস আনা যায়নি। ${section.kind.messageBangla()}", onRetry)
            section.stale?.let { ForecastContent(it, stale = true) }
        }
        is Section.Ready -> ForecastContent(section.data)
    }
}

@Composable
private fun ForecastContent(forecast: ForecastResponse, stale: Boolean = false) {
    val current = forecast.current
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SourceBanner(
            title = if (stale) "পুরোনো পূর্বাভাস (সর্বশেষ সফল লোড) — সংখ্যাভিত্তিক আবহাওয়া মডেলের অনুমান" else "সংখ্যাভিত্তিক আবহাওয়া মডেলের অনুমান (পূর্বাভাস) — স্থানীয় আবহাওয়া স্টেশনের মাপ নয়",
            detail = "তথ্যসূত্র: ${forecast.source.provider} • আপডেট: ${forecast.source.fetchedAt?.take(16)?.replace('T', ' ') ?: "—"} • পূর্বাভাসের সময় (স্থানীয়): ${current.time.replace('T', ' ')}",
        )

        Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(conditionIcon(current.weatherCode), contentDescription = null, tint = Primary, modifier = Modifier.size(26.dp))
                        Text("বর্তমান আবহাওয়া অনুমান", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = OnSurface)
                    }
                    Surface(color = Primary.copy(alpha = 0.1f), shape = RoundedCornerShape(8.dp)) {
                        Text(
                            WeatherCodes.labelBangla(current.weatherCode),
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = Primary,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                    Column {
                        Text("${fmt(current.temperatureC)}°C", style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Bold, color = Primary)
                        Text("অনুভূত তাপমাত্রা: ${fmt(current.apparentTemperatureC, "°C")}", style = MaterialTheme.typography.bodyMedium, color = OnSurfaceVariant)
                    }
                    forecast.daily.firstOrNull()?.let { today ->
                        Column(horizontalAlignment = Alignment.End) {
                            Text("সর্বোচ্চ: ${fmt(today.tempMaxC, "°C")}", style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                            Text("সর্বনিম্ন: ${fmt(today.tempMinC, "°C")}", style = MaterialTheme.typography.bodyMedium, color = OnSurfaceVariant)
                        }
                    }
                }
            }
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MetricTile(Icons.Default.WaterDrop, "বাতাসের আর্দ্রতা", fmt(current.humidityPct, "%", 0), "আপেক্ষিক আর্দ্রতা", Modifier.weight(1f))
            MetricTile(Icons.Default.Air, "বাতাসের গতি", fmt(current.windSpeedMs, " মি/সে"), "১০ মি. উচ্চতায়", Modifier.weight(1f))
        }

        val upcoming = forecast.hourly.filter { it.time >= current.time.take(13) }.take(24)
        if (upcoming.isNotEmpty()) {
            Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("আগামী ২৪ ঘণ্টার আবহাওয়া ধারা", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = OnSurface)
                    Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        upcoming.forEach { HourlyTile(it) }
                    }
                }
            }
        }

        if (forecast.daily.isNotEmpty()) {
            Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("আগামী ৭ দিনের পূর্বাভাস", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = OnSurface)
                    forecast.daily.forEach { DailyRow(it) }
                }
            }
        }
    }
}

@Composable
private fun DailyRow(day: ForecastDay) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(day.date, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = OnSurface, modifier = Modifier.width(85.dp))
        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(conditionIcon(day.weatherCode), contentDescription = null, modifier = Modifier.size(16.dp), tint = Primary)
            Text(WeatherCodes.labelBangla(day.weatherCode), style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant, maxLines = 1)
        }
        Text("${fmt(day.tempMinC, "°", 0)} - ${fmt(day.tempMaxC, "°C", 0)}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, color = OnSurface)
        Text(
            if (day.precipitationProbabilityMaxPct == null) "—" else "${fmt(day.precipitationProbabilityMaxPct, "%", 0)} বৃষ্টি",
            style = MaterialTheme.typography.bodySmall, color = Primary, modifier = Modifier.width(70.dp)
        )
    }
}

@Composable
private fun HourlyTile(hour: ForecastHour) {
    Surface(color = SurfaceContainerHigh, shape = RoundedCornerShape(10.dp), modifier = Modifier.width(72.dp)) {
        Column(modifier = Modifier.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(hour.time.substringAfter('T').take(5), style = MaterialTheme.typography.labelSmall, fontSize = 10.sp, color = OnSurfaceVariant)
            Icon(conditionIcon(hour.weatherCode), contentDescription = null, modifier = Modifier.size(20.dp), tint = Primary)
            Text(fmt(hour.temperatureC, "°", 0), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = OnSurface)
            Text("আর্দ্রতা ${fmt(hour.humidityPct, "%", 0)}", style = MaterialTheme.typography.labelSmall, fontSize = 9.sp, color = OnSurfaceVariant)
        }
    }
}

/** Derived value: THI from the forecast's own hourly temperature and humidity. Labelled as generic, not validated for local cattle. */
@Composable
private fun HourlyThiCard(forecast: ForecastResponse) {
    val hourly = remember(forecast) { CattleThi.hourly(forecast) }
    Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("গরুর তাপ চাপ সূচক (THI) — ঘণ্টাভিত্তিক", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = OnSurface)
            Text(
                "গণনা করা মান (আবহাওয়া মডেলের প্রতি ঘণ্টার তাপমাত্রা ও আর্দ্রতা থেকে, NRC 1971 সূত্র)। সাধারণ গরুর ক্যাটাগরি; স্থানীয় জাতের জন্য যাচাইকৃত নয়, ভবিষ্যদ্বাণীও নয়।",
                style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant
            )
            if (hourly.hours.isEmpty()) {
                Text("ঘণ্টাভিত্তিক তাপমাত্রা ও আর্দ্রতার উপাত্ত নেই।", style = MaterialTheme.typography.bodySmall, color = OnSurface)
            } else {
                Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    hourly.hours.forEach { h ->
                        Surface(color = thiColor(h.category), shape = RoundedCornerShape(10.dp), modifier = Modifier.width(66.dp)) {
                            Column(modifier = Modifier.padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(h.time.substringAfter('T').take(5), fontSize = 10.sp, color = OnSurfaceVariant)
                                Text(fmt(h.thi, "", 0), fontWeight = FontWeight.Bold, color = OnSurface)
                                Text("${fmt(h.temperatureC, "°", 0)} · ${fmt(h.humidityPct, "%", 0)}", fontSize = 9.sp, color = OnSurfaceVariant)
                            }
                        }
                    }
                }
                if (hourly.hoursMissingInputs > 0) {
                    Text("${hourly.hoursMissingInputs} ঘণ্টার তাপমাত্রা বা আর্দ্রতার উপাত্ত অসম্পূর্ণ, তাই বাদ দেওয়া হয়েছে।", style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant)
                }
            }
        }
    }
}

private fun thiColor(category: ThiCategory): Color = when (category) {
    ThiCategory.NORMAL -> Color(0xFFE6F4EA)
    ThiCategory.ALERT -> Color(0xFFFEF3C7)
    ThiCategory.DANGER -> Color(0xFFFED7AA)
    ThiCategory.EMERGENCY -> Color(0xFFFECACA)
}

// ---------------------------------------------------------------------------------------------------------------
// NASA POWER (delayed observations; kept separate from the forecast)
// ---------------------------------------------------------------------------------------------------------------

@Composable
private fun ObservationsSection(section: Section<ObservationResponse>, onRetry: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "নাসা পর্যবেক্ষণ — বিলম্বিত উপাত্ত, সরাসরি নয়",
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = OnSurface,
            modifier = Modifier.padding(top = 8.dp)
        )
        when (section) {
            Section.Idle -> {}
            is Section.Loading -> {
                LoadingCard("নাসা পর্যবেক্ষণ উপাত্ত লোড হচ্ছে…")
                section.stale?.let { ObservationsContent(it) }
            }
            is Section.Failed -> {
                ErrorCard("নাসা পর্যবেক্ষণ উপাত্ত আনা যায়নি। ${section.kind.messageBangla()} (আবহাওয়া পূর্বাভাস আলাদাভাবে কাজ করে।)", onRetry)
                section.stale?.let { ObservationsContent(it) }
            }
            is Section.Ready -> ObservationsContent(section.data)
        }
    }
}

@Composable
private fun ObservationsContent(obs: ObservationResponse) {
    SourceBanner(
        title = "নাসা পাওয়ার — বিলম্বিত উপগ্রহ/পুনঃবিশ্লেষণ পর্যবেক্ষণ (পূর্বাভাস নয়, সরাসরি নয়)",
        detail = "সর্বশেষ পর্যবেক্ষণ: ${obs.latestObservationDate} (সাধারণত ২–৩ দিন বিলম্ব) • সময়কাল ${obs.windowStart} – ${obs.windowEnd}, ${obs.daysWithData} দিনের উপাত্ত",
    )
    Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("সর্বশেষ দিন (${obs.latest.date})", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Primary)
            Text(
                "গড় ${fmt(obs.latest.t2m, "°C")} (সর্বনিম্ন ${fmt(obs.latest.t2mMin, "°")} – সর্বোচ্চ ${fmt(obs.latest.t2mMax, "°C")}) • আর্দ্রতা ${fmt(obs.latest.rh2m, "%", 0)} • বৃষ্টি ${fmt(obs.latest.rainMm, " মিমি")}",
                style = MaterialTheme.typography.bodyMedium, color = OnSurface
            )
            Text(
                "সময়কালে গড় তাপমাত্রা: ${fmt(obs.meanT2mWindow, "°C")} • মোট বৃষ্টি: ${fmt(obs.rainWindowMm, " মিমি")} (${obs.rainDaysWithData} দিনের উপাত্ত)",
                style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant
            )
        }
    }
    Surface(color = SurfaceContainerHigh, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Text(
            "মাটির আর্দ্রতা (SMAP): এই উৎসে পাওয়া যায় না। ${obs.soilMoistureUnavailableReason.orEmpty()}",
            style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant, modifier = Modifier.padding(12.dp)
        )
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Farm advisories created on the website (same API data)
// ---------------------------------------------------------------------------------------------------------------

@Composable
private fun CattleAdvisorySection(viewModel: CattleAdvisoryViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("খামারের গবাদিপশু পরামর্শ (ওয়েবসাইটে আঁকা খামার)", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = OnSurface, modifier = Modifier.padding(top = 8.dp))
        Text(
            "খামারের সীমানা ওয়েবসাইটে আঁকা হয়; এখানে একই সার্ভারের তথ্য দেখানো হয়। পরামর্শটি আবহাওয়া মডেলের অনুমান থেকে গণনা করা THI-ভিত্তিক সাধারণ নির্দেশনা।",
            style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant
        )
        when (val aois = state.aois) {
            Section.Idle -> OutlinedButton(onClick = viewModel::loadFarms) { Text("খামারের তালিকা দেখুন") }
            is Section.Loading -> LoadingCard("খামারের তালিকা লোড হচ্ছে…")
            is Section.Failed -> ErrorCard("খামারের তালিকা আনা যায়নি। ${aois.kind.messageBangla()}", viewModel::loadFarms)
            is Section.Ready -> {
                if (aois.data.isEmpty()) {
                    InfoCard("এখনও কোনো খামার সংরক্ষিত নেই। ওয়েবসাইটের গবাদিপশু পাতায় খামারের সীমানা আঁকুন।")
                } else {
                    Box {
                        OutlinedButton(onClick = { menu = true }, modifier = Modifier.fillMaxWidth()) {
                            val sel = aois.data.firstOrNull { it.id == state.selectedAoiId }
                            Text(sel?.let { (if (it.demo) "[ডেমো] " else "") + it.label } ?: "খামার বাছুন", maxLines = 1)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            aois.data.forEach { a ->
                                DropdownMenuItem(text = { Text((if (a.demo) "[ডেমো] " else "") + a.label) }, onClick = { menu = false; viewModel.select(a.id) })
                            }
                        }
                    }
                    state.latestJob?.let { JobStatusCard(it) }
                    when (val adv = state.advisory) {
                        Section.Idle -> {}
                        is Section.Loading -> LoadingCard("পরামর্শ লোড হচ্ছে…")
                        is Section.Failed -> if (adv.kind == ApiErrorKind.NO_DATA) {
                            InfoCard("এই খামারের জন্য এখনও কোনো পরামর্শ তৈরি হয়নি (কাজ সম্পন্ন হয়নি)। ওয়েবসাইট থেকে \"রিফ্রেশ ও বিশ্লেষণ\" চালান।")
                        } else {
                            ErrorCard("পরামর্শ আনা যায়নি। ${adv.kind.messageBangla()}") { state.selectedAoiId?.let(viewModel::select) }
                        }
                        is Section.Ready -> AdvisoryContent(adv.data)
                    }
                }
            }
        }
    }
}

@Composable
private fun JobStatusCard(job: CattleJob) {
    val (label, color) = when (job.status) {
        "succeeded" -> "সম্পন্ন (সব উপাত্ত পাওয়া গেছে)" to Color(0xFFE6F4EA)
        "partial" -> "আংশিক সম্পন্ন — কিছু উপাত্ত নেই" to Color(0xFFFEF3C7)
        "failed" -> "ব্যর্থ" to Color(0xFFFECACA)
        "blocked" -> "আটকে আছে — কনফিগারেশন বা উপাত্ত প্রয়োজন" to Color(0xFFFEF3C7)
        else -> "চলমান" to SurfaceContainerHigh
    }
    Surface(color = color, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("সর্বশেষ কাজের অবস্থা: $label", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = OnSurface)
            Text(job.stageMessageBangla.ifBlank { job.stageMessage }, style = MaterialTheme.typography.bodySmall, color = OnSurface)
            job.missing.forEach { (input, reason) -> Text("• নেই: $input — $reason", style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant) }
            job.errors.forEach { Text("• $it", style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant) }
        }
    }
}

@Composable
private fun AdvisoryContent(a: CattleAdvisory) {
    val category = ThiCategory.fromApi(a.thiCategory)
    Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(a.farmLabel, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = OnSurface)

            Text("পরিমাপকৃত / সরবরাহকারীর উপাত্ত", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Primary)
            Text(
                "• আবহাওয়া: ${a.forecastSource.provider} — সংখ্যাভিত্তিক মডেলের অনুমান\n" +
                    "• নাসা পাওয়ার (বিলম্বিত): ${if (a.nasaStatus == "ok") "পাওয়া গেছে" else "উপলব্ধ নয়"}\n" +
                    "• উপগ্রহ (Earth Engine): ${when (a.satelliteStatus) { "ok" -> "পাওয়া গেছে"; "partial" -> "আংশিক"; else -> "উপলব্ধ নয় — ${a.satelliteReason.orEmpty()}" }}" +
                    (a.ndvi?.let { "\n• NDVI (সবুজতা): ${fmt(it, "", 2)}" } ?: ""),
                style = MaterialTheme.typography.bodySmall, color = OnSurface
            )

            Text("গণনা করা মান", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Primary)
            Surface(color = thiColor(category), shape = RoundedCornerShape(8.dp)) {
                Text(
                    "THI ${fmt(a.thiCurrent, "", 1)} — ${category.labelBangla}",
                    fontWeight = FontWeight.Bold, color = OnSurface, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                )
            }
            Text(a.thiThresholdNote, style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant)
            if (a.hourly.isNotEmpty()) {
                Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    a.hourly.forEach { h ->
                        Surface(color = thiColor(ThiCategory.fromApi(h.category)), shape = RoundedCornerShape(8.dp), modifier = Modifier.width(62.dp)) {
                            Column(modifier = Modifier.padding(5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(h.time.substringAfter('T').take(5), fontSize = 10.sp, color = OnSurfaceVariant)
                                Text(fmt(h.thi, "", 0), fontWeight = FontWeight.Bold, color = OnSurface)
                                Text("${fmt(h.temperatureC, "°", 0)} · ${fmt(h.humidityPct, "%", 0)}", fontSize = 9.sp, color = OnSurfaceVariant)
                            }
                        }
                    }
                }
            }
            a.lowestThiHours?.let { Text("পূর্বাভাসে সবচেয়ে কম THI-র ঘণ্টা: ${it.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = OnSurface) }
            if (a.hoursMissingInputs > 0) Text("${a.hoursMissingInputs} ঘণ্টার উপাত্ত অসম্পূর্ণ, বাদ দেওয়া হয়েছে।", style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant)

            Text("সাধারণ নির্দেশনা (অনুমানভিত্তিক)", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Primary)
            Text(a.heuristicBasis, style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant)
            a.bulletsBangla.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = OnSurface) }
            if (a.waterDemandLabelBangla.isNotBlank()) Text("পানির চাহিদা (শ্রেণি, পরিমাণ নয়): ${a.waterDemandLabelBangla}", style = MaterialTheme.typography.bodySmall, color = OnSurface)

            Text(
                if (a.supervisedModelAvailable) "প্রশিক্ষিত মডেল সক্রিয়।" else "দুধ কমা বা রোগের ঝুঁকির কোনো পূর্বাভাস নেই: এর জন্য যাচাইকৃত লেবেলযুক্ত উপাত্ত নেই, তাই কোনো মডেল প্রশিক্ষিত হয়নি।",
                style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant
            )
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------------------------

@Composable
private fun LoadingCard(text: String) {
    Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = Primary)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = OnSurfaceVariant)
        }
    }
}

@Composable
private fun ErrorCard(message: String, onRetry: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
            }
            OutlinedButton(onClick = onRetry) {
                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("পুনরায় চেষ্টা করুন")
            }
        }
    }
}

@Composable
private fun InfoCard(text: String) {
    Surface(color = SurfaceContainerHigh, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Default.Info, contentDescription = null, tint = Tertiary, modifier = Modifier.size(20.dp))
            Text(text, style = MaterialTheme.typography.bodySmall, color = OnSurface)
        }
    }
}

@Composable
private fun SourceBanner(title: String, detail: String) {
    Surface(
        color = SurfaceContainerHigh,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, Tertiary.copy(alpha = 0.3f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Default.Info, contentDescription = null, tint = Tertiary, modifier = Modifier.size(22.dp))
            Column {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Tertiary)
                Text(detail, style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant, fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun AttributionCard() {
    Surface(color = SurfaceContainerHigh, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("উপাত্তের উৎস ও সীমাবদ্ধতা:", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = OnSurface)
            Text("• পূর্বাভাস: Open-Meteo — সংখ্যাভিত্তিক আবহাওয়া মডেলের অনুমান, স্থানীয় স্টেশনের মাপ নয়।", style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant, fontSize = 11.sp)
            Text("• পর্যবেক্ষণ: NASA POWER — বিলম্বিত (প্রায় ২–৩ দিন), সরাসরি নয়।", style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant, fontSize = 11.sp)
            Text("• জেলা-উপজেলার স্থানাঙ্ক প্রশাসনিক এলাকার আনুমানিক কেন্দ্র (Open Admin Data Bangladesh, CC BY 4.0); খামারের সঠিক অবস্থান নয়।", style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant, fontSize = 11.sp)
        }
    }
}

@Composable
private fun MetricTile(icon: ImageVector, title: String, value: String, subtitle: String, modifier: Modifier = Modifier) {
    Surface(color = SurfaceContainerLow, shape = RoundedCornerShape(12.dp), modifier = modifier) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(icon, contentDescription = null, tint = Primary, modifier = Modifier.size(18.dp))
                Text(title, style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant, maxLines = 1)
            }
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = OnSurface)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant, maxLines = 1)
        }
    }
}

private fun conditionIcon(code: Int?): ImageVector = when (code) {
    0, 1 -> Icons.Default.WbSunny
    2, 3 -> Icons.Default.Cloud
    45, 48 -> Icons.Default.Air
    51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82 -> Icons.Default.WaterDrop
    95, 96, 99 -> Icons.Default.Thunderstorm
    else -> Icons.Default.Cloud
}
