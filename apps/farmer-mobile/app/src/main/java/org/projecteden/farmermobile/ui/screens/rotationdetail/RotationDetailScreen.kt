package org.projecteden.farmermobile.ui.screens.rotationdetail

import org.projecteden.farmermobile.theme.bevel

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.projecteden.farmermobile.audio.AudioPlaybackState
import org.projecteden.farmermobile.theme.Error
import org.projecteden.farmermobile.theme.InverseOnSurface
import org.projecteden.farmermobile.theme.InverseSurface
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnPrimaryFixed
import org.projecteden.farmermobile.theme.OnSecondaryContainer
import org.projecteden.farmermobile.theme.OnSecondaryFixed
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Outline
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.PrimaryFixed
import org.projecteden.farmermobile.theme.Secondary
import org.projecteden.farmermobile.theme.SecondaryContainer
import org.projecteden.farmermobile.theme.SecondaryFixed
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainer
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceContainerLow
import org.projecteden.farmermobile.theme.SurfaceContainerLowest
import org.projecteden.farmermobile.ui.components.AudioPlayerCard
import org.projecteden.farmermobile.ui.components.EdenTopAppBar
import org.projecteden.farmermobile.ui.components.windowPart

@Composable
fun RotationDetailScreen(
    onBack: () -> Unit,
    viewModel: RotationDetailViewModel = viewModel(),
    modifier: Modifier = Modifier
) {
    val advice by viewModel.advice.collectAsStateWithLifecycle()
    val playbackState by viewModel.playbackState.collectAsStateWithLifecycle()
    val isConfirmed by viewModel.isConfirmed.collectAsStateWithLifecycle()
    val confirmToast by viewModel.confirmToast.collectAsStateWithLifecycle()

    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Surface)
    ) {
        EdenTopAppBar(
            title = "ফসল চক্রের বিস্তারিত",
            onBackClick = onBack,
            isOffline = advice.isOffline
        )

        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // 1. Plot Header Banner
                Surface(
                    color = SurfaceContainerHigh,
                    shape = RoundedCornerShape(2.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.LocationOn,
                                contentDescription = null,
                                tint = Primary,
                                modifier = Modifier.size(22.dp)
                            )
                            Column {
                                Text(
                                    text = advice.plotName,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = OnSurface
                                )
                                Text(
                                    text = advice.rotationTitle,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = OnSurfaceVariant,
                                    fontSize = 11.sp
                                )
                            }
                        }

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(2.dp))
                                .background(SecondaryContainer)
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = "নির্বাচিত চক্র",
                                style = MaterialTheme.typography.labelSmall,
                                color = OnSecondaryContainer,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                // 2. Audio Listen Widget
                AudioPlayerCard(
                    playbackState = playbackState,
                    onPlayClick = { viewModel.playAudio() },
                    onPauseOrStopClick = { viewModel.pauseOrStopAudio() }
                )

                // 3. Section Title
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(Primary)
                        )
                        Text(
                            text = "পর্যায়ক্রমিক ফসল পরিক্রমা",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = Primary
                        )
                    }

                    Text(
                        text = "২টি মৌসুম",
                        style = MaterialTheme.typography.labelSmall,
                        color = OnSurfaceVariant
                    )
                }

                // 4. Detailed Season Breakdown
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Season 1: Kharif-2
                    Surface(
                        color = SurfaceContainerLowest,
                        shape = RoundedCornerShape(2.dp),
                        shadowElevation = 2.dp,
                        modifier = Modifier.bevel().fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(IntrinsicSize.Min)
                        ) {
                            Box(
                                modifier = Modifier
                                    .width(5.dp)
                                    .fillMaxHeight()
                                    .background(PrimaryContainer)
                            )

                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(PrimaryFixed)
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = "মৌসুম ১ • খরিপ-২",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = OnPrimaryFixed,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 10.sp
                                        )
                                    }

                                    Text(
                                        text = "অনুমোদিত জাত",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Primary,
                                        fontWeight = FontWeight.Medium
                                    )
                                }

                                Text(
                                    text = "${advice.season1Name} (${advice.season1Variety})",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = OnSurface
                                )

                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(
                                        text = advice.season1Window.windowPart(0),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = OnSurfaceVariant
                                    )
                                    Text(
                                        text = advice.season1Window.windowPart(1),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = OnSurfaceVariant
                                    )
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = "সেচ ব্যবস্থাপনা: ",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = OnSurfaceVariant
                                        )
                                        Text(
                                            text = advice.season1IrrigationStatus,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = Error,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Season 2: Rabi
                    Surface(
                        color = SurfaceContainerLowest,
                        shape = RoundedCornerShape(2.dp),
                        shadowElevation = 2.dp,
                        modifier = Modifier.bevel().fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(IntrinsicSize.Min)
                        ) {
                            Box(
                                modifier = Modifier
                                    .width(5.dp)
                                    .fillMaxHeight()
                                    .background(Secondary)
                            )

                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(SecondaryContainer)
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = "মৌসুম ২ • রবি",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = OnSecondaryContainer,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 10.sp
                                        )
                                    }

                                    Text(
                                        text = "পরবর্তী ফসল",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Secondary,
                                        fontWeight = FontWeight.Medium
                                    )
                                }

                                Text(
                                    text = "${advice.season2Name} (${advice.season2Variety})",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = OnSurface
                                )

                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(
                                        text = advice.season2Window.windowPart(0),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = OnSurfaceVariant
                                    )
                                    Text(
                                        text = advice.season2Window.windowPart(1),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = OnSurfaceVariant
                                    )
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = "সার সুপারিশ: ",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = OnSurfaceVariant
                                        )
                                        Text(
                                            text = advice.season2FertilizerRecommendation,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = Error,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }

                                Row(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(2.dp))
                                        .background(SurfaceContainer)
                                        .padding(horizontal = 8.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = Primary,
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Text(
                                        text = "অনুমোদিত কৃষি গাইডলাইন অনুযায়ী প্রস্তাবিত",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Primary
                                    )
                                }
                            }
                        }
                    }
                }

                // 5. Provenance & Reliability Notice
                Surface(
                    color = SurfaceContainer,
                    shape = RoundedCornerShape(2.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = Outline,
                            modifier = Modifier.size(18.dp)
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                text = "তথ্যসূত্র ও নির্ভরযোগ্যতা",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = OnSurface
                            )
                            Text(
                                text = advice.provenanceNotice,
                                style = MaterialTheme.typography.bodySmall,
                                color = OnSurfaceVariant,
                                lineHeight = 16.sp
                            )
                        }
                    }
                }

                // 6. Confirmation Button
                Button(
                    onClick = { viewModel.confirmPlan() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isConfirmed) Primary else PrimaryContainer,
                        contentColor = OnPrimary
                    ),
                    shape = RoundedCornerShape(2.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = if (isConfirmed) Icons.Default.CheckCircle else Icons.Default.Check,
                            contentDescription = null,
                            tint = OnPrimary,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = if (isConfirmed) "ফসল চক্রটি নিশ্চিত করা হয়েছে" else "এই ফসল চক্রটি নিশ্চিত করুন",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
            }

            // Confirmation Toast
            androidx.compose.animation.AnimatedVisibility(
                visible = confirmToast != null,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 24.dp)
            ) {
                Surface(
                    color = InverseSurface,
                    shape = RoundedCornerShape(2.dp),
                    shadowElevation = 6.dp
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = PrimaryFixed,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = confirmToast ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = InverseOnSurface
                        )
                    }
                }
            }
        }
    }
}
