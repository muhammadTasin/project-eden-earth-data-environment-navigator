package org.projecteden.farmermobile.ui.screens.weather

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.projecteden.farmermobile.data.remote.RemoteWeatherDay
import org.projecteden.farmermobile.data.remote.RemoteWeatherResponse
import org.projecteden.farmermobile.theme.InverseOnSurface
import org.projecteden.farmermobile.theme.InverseSurface
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

@Composable
fun WeatherScreen(
    viewModel: WeatherViewModel = viewModel(),
    onNavigateToProfile: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val isRefreshing by viewModel.isRefreshing.collectAsStateWithLifecycle()
    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Surface)
    ) {
        EdenTopAppBar(
            title = "নাসা আবহাওয়া ও মাটির রস",
            isOffline = (uiState as? WeatherUiState.Success)?.data?.isLive != true,
            onProfileClick = onNavigateToProfile
        )

        when (val state = uiState) {
            is WeatherUiState.Loading -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        CircularProgressIndicator(color = Primary)
                        Text(
                            text = "নাসা স্যাটেলাইট উপাত্ত সংগ্রহ করা হচ্ছে...",
                            style = MaterialTheme.typography.bodyMedium,
                            color = OnSurfaceVariant
                        )
                    }
                }
            }
            is WeatherUiState.Error -> {
                if (state.cached != null) {
                    WeatherContent(
                        weather = state.cached,
                        isRefreshing = isRefreshing,
                        onRefresh = { viewModel.loadWeather() },
                        errorMessage = state.message,
                        scrollState = scrollState
                    )
                } else {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(
                            modifier = Modifier.padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Text(
                                text = state.message,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.error
                            )
                            Button(
                                onClick = { viewModel.loadWeather() },
                                colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = OnPrimary)
                            ) {
                                Icon(Icons.Default.Refresh, contentDescription = null)
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("পুনরায় চেষ্টা করুন")
                            }
                        }
                    }
                }
            }
            is WeatherUiState.Success -> {
                WeatherContent(
                    weather = state.data,
                    isRefreshing = isRefreshing,
                    onRefresh = { viewModel.loadWeather() },
                    errorMessage = null,
                    scrollState = scrollState
                )
            }
        }
    }
}

@Composable
private fun WeatherContent(
    weather: RemoteWeatherResponse,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    errorMessage: String?,
    scrollState: androidx.compose.foundation.ScrollState
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        if (!errorMessage.isNullOrBlank()) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
            }
        }

        // Location & Lat/Lon Header
        Surface(
            color = PrimaryContainer,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.LocationOn,
                            contentDescription = null,
                            tint = PrimaryFixed,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = weather.locationTitle,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = OnPrimary
                        )
                    }
                    Text(
                        text = "স্থানাঙ্ক: ${weather.latitude}° N, ${weather.longitude}° E",
                        style = MaterialTheme.typography.labelSmall,
                        color = OnPrimaryContainer
                    )
                }

                Button(
                    onClick = onRefresh,
                    enabled = !isRefreshing,
                    shape = RoundedCornerShape(2.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = PrimaryFixed, contentColor = Primary)
                ) {
                    if (isRefreshing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = Primary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(imageVector = Icons.Default.Refresh, contentDescription = "রিফ্রেশ", modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("রিফ্রেশ", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    }
                }
            }
        }

        // Observation vs Forecast Disclaimer Pill
        Surface(
            color = SurfaceContainerHigh,
            shape = RoundedCornerShape(2.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Tertiary.copy(alpha = 0.3f)),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = null,
                    tint = Tertiary,
                    modifier = Modifier.size(22.dp)
                )
                Column {
                    Text(
                        text = weather.observationNotice,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = Tertiary
                    )
                    Text(
                        text = "সর্বশেষ পর্যবেক্ষণ: ${weather.observationDate} (${weather.latencyNotice})",
                        style = MaterialTheme.typography.bodySmall,
                        color = OnSurfaceVariant
                    )
                }
            }
        }

        // Hero Metric Card: Temperature
        Surface(
            color = SurfaceContainerLow,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Thermostat, contentDescription = null, tint = Primary, modifier = Modifier.size(24.dp))
                        Text(
                            text = "বাতাসের তাপমাত্রা",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = OnSurface
                        )
                    }
                    Text(
                        text = "পর্যবেক্ষণ: ${weather.observationDate}",
                        style = MaterialTheme.typography.labelSmall,
                        color = OnSurfaceVariant
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Bottom
                ) {
                    Text(
                        text = "${weather.currentTempAvgC}°C",
                        style = MaterialTheme.typography.displayMedium,
                        fontWeight = FontWeight.Bold,
                        color = Primary
                    )

                    Column(horizontalAlignment = Alignment.End) {
                        Text(text = "সর্বোচ্চ: ${weather.currentTempMaxC}°C", style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                        Text(text = "সর্বনিম্ন: ${weather.currentTempMinC}°C", style = MaterialTheme.typography.bodyMedium, color = OnSurfaceVariant)
                    }
                }
            }
        }

        // Secondary Metrics Grid
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            MetricTile(
                icon = Icons.Default.WaterDrop,
                title = "বাতাসের আর্দ্রতা",
                value = "${weather.currentHumidityPct.toInt()}%",
                subtitle = "আপেক্ষিক আর্দ্রতা (২ মি)",
                modifier = Modifier.weight(1f)
            )
            MetricTile(
                icon = Icons.Default.Cloud,
                title = "বিগত ৩০ দিনের বৃষ্টি",
                value = "${weather.rainLast30DaysMm.toInt()} মিমি",
                subtitle = weather.rainVerdict,
                modifier = Modifier.weight(1f)
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            MetricTile(
                icon = Icons.Default.Air,
                title = "বাতাসের গতি",
                value = "${weather.currentWindSpeedMs} মি/সে",
                subtitle = "বায়ুপ্রবাহ",
                modifier = Modifier.weight(1f)
            )
            MetricTile(
                icon = Icons.Default.WaterDrop,
                title = "মাটির মূল অঞ্চলের রস",
                value = "${(weather.rootZoneSoilMoisture * 100).toInt()}%",
                subtitle = "SMAP L4 রুটজোন",
                modifier = Modifier.weight(1f)
            )
        }

        // Soil Wetness Analysis Card
        Surface(
            color = SurfaceContainerLow,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = "মাটির আর্দ্রতা ও রবি বপন উপযোগিতা",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = Primary
                )
                Text(
                    text = weather.rootZoneStatus,
                    style = MaterialTheme.typography.bodyMedium,
                    color = OnSurface
                )
                Text(
                    text = "নাসা SMAP উপগ্রহ অনুযায়ী রুটজোনে পর্যাপ্ত রস থাকায় আমন কাটার সাথে সাথে বিনা চাষে বা স্বল্প চাষে মসুর ও সরিষা বপন করা সুবিধাজনক।",
                    style = MaterialTheme.typography.bodySmall,
                    color = OnSurfaceVariant
                )
            }
        }

        // Recent 5-Day Historical Observation Trend
        if (weather.history.isNotEmpty()) {
            Surface(
                color = SurfaceContainerLow,
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "সাম্প্রতিক দিনের উপগ্রহ পর্যবেক্ষণ রেকর্ড",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = OnSurface
                    )

                    weather.history.takeLast(5).forEach { day ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(text = day.date, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = OnSurface)
                            Text(text = "${day.t2m}°C (${day.t2mMin}°- ${day.t2mMax}°)", style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant)
                            Text(text = "${day.rh2m.toInt()}% আর্দ্রতা", style = MaterialTheme.typography.bodySmall, color = OnSurfaceVariant)
                            Text(text = "${day.rainMm} মিমি", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, color = Primary)
                        }
                    }
                }
            }
        }

        // Data Provenance & Source Badge
        Surface(
            color = SurfaceContainerHigh,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = "তথ্যসূত্র ও বিজ্ঞানভিত্তিক স্বচ্ছতা:",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = OnSurface
                )
                Text(
                    text = weather.dataSource,
                    style = MaterialTheme.typography.bodySmall,
                    color = OnSurfaceVariant
                )
                Text(
                    text = "NASA Langley Research Center POWER Project (Agroclimatology) & NASA GSFC SMAP Level 4.",
                    style = MaterialTheme.typography.labelSmall,
                    color = OnSurfaceVariant,
                    fontSize = 10.sp
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun MetricTile(
    icon: ImageVector,
    title: String,
    value: String,
    subtitle: String,
    modifier: Modifier = Modifier
) {
    Surface(
        color = SurfaceContainerLow,
        shape = RoundedCornerShape(2.dp),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(imageVector = icon, contentDescription = null, tint = Primary, modifier = Modifier.size(18.dp))
                Text(text = title, style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant, maxLines = 1)
            }
            Text(text = value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = OnSurface)
            Text(text = subtitle, style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant, maxLines = 1)
        }
    }
}
