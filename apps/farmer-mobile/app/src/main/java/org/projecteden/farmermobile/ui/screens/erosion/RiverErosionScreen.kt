package org.projecteden.farmermobile.ui.screens.erosion

import org.projecteden.farmermobile.theme.EdenShape

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.AltRoute
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Landscape
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Water
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.projecteden.farmermobile.data.remote.RemoteRiverErosionResponse
import org.projecteden.farmermobile.data.remote.RemoteRiverStation
import org.projecteden.farmermobile.theme.InverseOnSurface
import org.projecteden.farmermobile.theme.InverseSurface
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnPrimaryContainer
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.PrimaryFixed
import org.projecteden.farmermobile.theme.Secondary
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceContainerLow
import org.projecteden.farmermobile.theme.Tertiary
import org.projecteden.farmermobile.ui.components.EdenTopAppBar

@Composable
fun RiverErosionScreen(
    viewModel: RiverErosionViewModel = viewModel(),
    onNavigateToProfile: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val selectedRiver by viewModel.selectedRiver.collectAsStateWithLifecycle()
    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Surface)
    ) {
        EdenTopAppBar(
            title = "নদীভাঙন ও হাইড্রোলজি",
            isOffline = uiState !is RiverErosionUiState.Success,
            onProfileClick = onNavigateToProfile
        )

        // River Selection Horizontal Chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(SurfaceContainerHigh)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf(
                "jamuna" to "যমুনা নদী",
                "padma" to "পদ্মা নদী",
                "meghna" to "মেঘনা নদী",
                "teesta" to "তিস্তা নদী"
            ).forEach { (id, label) ->
                val isSelected = selectedRiver == id
                Surface(
                    shape = RoundedCornerShape(2.dp),
                    color = if (isSelected) Primary else Surface,
                    border = if (isSelected) null else androidx.compose.foundation.BorderStroke(1.dp, Primary.copy(alpha = 0.3f)),
                    modifier = Modifier
                        .clickable { viewModel.selectRiver(id) }
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                        color = if (isSelected) OnPrimary else OnSurface,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }

        when (val state = uiState) {
            is RiverErosionUiState.Loading -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(color = Primary)
                        Text(
                            text = "পানি উন্নয়ন বোর্ড ও সিইজিআইএস উপাত্ত লোড হচ্ছে...",
                            style = MaterialTheme.typography.bodyMedium,
                            color = OnSurfaceVariant
                        )
                    }
                }
            }
            is RiverErosionUiState.Error -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(text = state.message, color = MaterialTheme.colorScheme.error)
                        Button(
                            onClick = { viewModel.loadRiverData(selectedRiver) },
                            colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = OnPrimary),
                            shape = EdenShape
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("পুনরায় চেষ্টা")
                        }
                    }
                }
            }
            is RiverErosionUiState.Success -> {
                ErosionContent(data = state.data, scrollState = scrollState)
            }
        }
    }
}

@Composable
private fun ErosionContent(
    data: RemoteRiverErosionResponse,
    scrollState: androidx.compose.foundation.ScrollState
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // River Corridor Header Banner
        Surface(
            color = PrimaryContainer,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Water, contentDescription = null, tint = PrimaryFixed, modifier = Modifier.size(24.dp))
                        Text(
                            text = data.riverName,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = OnPrimary
                        )
                    }
                    Surface(
                        color = Color(0xFFBA1A1A),
                        shape = RoundedCornerShape(2.dp)
                    ) {
                        Text(
                            text = data.overallRisk,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }

                Text(
                    text = "অববাহিকা: ${data.basinName}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = OnPrimaryContainer
                )
                Text(
                    text = data.primaryCause,
                    style = MaterialTheme.typography.bodySmall,
                    color = OnPrimaryContainer,
                    lineHeight = 18.sp
                )
            }
        }

        // Upstream Basin Rain Card
        Surface(
            color = SurfaceContainerLow,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.AltRoute,
                    contentDescription = null,
                    tint = Primary,
                    modifier = Modifier.size(24.dp)
                )
                Column {
                    Text(
                        text = "উজান অববাহিকা বৃষ্টিপাত (NASA GPM IMERG): ${data.basin30dRainMm.toInt()} মিমি",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = OnSurface
                    )
                    Text(
                        text = data.upstreamRainStatus,
                        style = MaterialTheme.typography.bodySmall,
                        color = OnSurfaceVariant
                    )
                }
            }
        }

        // Monitoring Stations Section
        Text(
            text = "প্রধান পর্যবেক্ষণ স্টেশন ও ঐতিহাসিক বিপদসীমা (BWDB)",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = Primary,
            modifier = Modifier.padding(top = 4.dp)
        )

        data.stations.forEach { station ->
            StationCard(station = station)
        }

        // Agricultural Guidelines in Erosion-Prone Areas
        Surface(
            color = SurfaceContainerLow,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(imageVector = Icons.Default.Landscape, contentDescription = null, tint = Primary, modifier = Modifier.size(20.dp))
                    Text(
                        text = "ভাঙনপ্রবণ তীরবর্তী কৃষকদের জন্য সুপারিশ:",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = OnSurface
                    )
                }

                data.guidelines.forEach { rule ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(vertical = 2.dp)
                    ) {
                        Text(text = "•", color = Primary, fontWeight = FontWeight.Bold)
                        Text(text = rule, style = MaterialTheme.typography.bodySmall, color = OnSurface, lineHeight = 18.sp)
                    }
                }
            }
        }

        // Caveats & Data Limitations
        Surface(
            color = SurfaceContainerHigh,
            shape = RoundedCornerShape(2.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFBA1A1A).copy(alpha = 0.3f)),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    tint = Color(0xFFBA1A1A),
                    modifier = Modifier.size(22.dp)
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = "উপাত্তের সীমাবদ্ধতা ও সতর্কতা:",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFBA1A1A)
                    )
                    Text(
                        text = data.caveat,
                        style = MaterialTheme.typography.bodySmall,
                        color = OnSurfaceVariant,
                        lineHeight = 18.sp
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun StationCard(station: RemoteRiverStation) {
    Surface(
        color = SurfaceContainerLow,
        shape = RoundedCornerShape(2.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = station.stationName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = OnSurface
                    )
                    Text(
                        text = "জেলা: ${station.district}",
                        style = MaterialTheme.typography.labelSmall,
                        color = OnSurfaceVariant
                    )
                }

                Surface(
                    color = when (station.riskLevel) {
                        "অতি উচ্চ ঝুঁকি" -> Color(0xFFBA1A1A)
                        "উচ্চ ঝুঁকি" -> Color(0xFFC04B00)
                        else -> Primary
                    },
                    shape = RoundedCornerShape(2.dp)
                ) {
                    Text(
                        text = station.riskLevel,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }

            // Metrics row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(SurfaceContainerHigh.copy(alpha = 0.5f), RoundedCornerShape(2.dp))
                    .padding(10.dp),
                horizontalArrangement = Arrangement.SpaceAround
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("বিপদসীমা", style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant)
                    Text("${station.dangerLevelM} মি", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = OnSurface)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("সর্বোচ্চ রেকর্ড", style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant)
                    Text("${station.highestPeakM} মি", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Color(0xFFBA1A1A))
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("বিপদসীমার উপরে", style = MaterialTheme.typography.labelSmall, color = OnSurfaceVariant)
                    Text("${station.daysAboveDangerLevel} দিন", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Primary)
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "বার্ষিক স্থানান্তর: ${station.bankShiftEstimate}",
                    style = MaterialTheme.typography.labelSmall,
                    color = OnSurfaceVariant
                )
                Text(
                    text = station.dataStatus,
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    color = Primary
                )
            }
        }
    }
}
