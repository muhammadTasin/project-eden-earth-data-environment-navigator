package org.projecteden.farmermobile.ui.screens.today

import org.projecteden.farmermobile.theme.bevel

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnSecondaryContainer
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Outline
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.Secondary
import org.projecteden.farmermobile.theme.SecondaryContainer
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainer
import org.projecteden.farmermobile.theme.SurfaceContainerLow
import org.projecteden.farmermobile.theme.SurfaceContainerLowest
import org.projecteden.farmermobile.ui.components.AudioPlayerCard
import org.projecteden.farmermobile.ui.components.EdenTopAppBar
import org.projecteden.farmermobile.ui.components.OfflineStatusBanner
import org.projecteden.farmermobile.ui.components.windowPart

@Composable
fun TodayAdviceScreen(
    onNavigateToPlan: () -> Unit,
    onNavigateToHistory: () -> Unit = {},
    onNavigateToDetail: () -> Unit = {},
    onNavigateToProfile: () -> Unit = {},
    viewModel: TodayAdviceViewModel = viewModel(),
    modifier: Modifier = Modifier
) {
    val advice by viewModel.advice.collectAsStateWithLifecycle()
    val playbackState by viewModel.playbackState.collectAsStateWithLifecycle()
    val isRefreshing by viewModel.isRefreshing.collectAsStateWithLifecycle()
    val refreshMessage by viewModel.refreshMessage.collectAsStateWithLifecycle()
    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Surface)
    ) {
        EdenTopAppBar(
            title = "আজ",
            isOffline = advice.isOffline,
            onProfileClick = onNavigateToProfile
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 1. Offline Mode Banner
            OfflineStatusBanner(
                isOffline = advice.isOffline,
                lastSyncTimeText = advice.lastSyncFormatted
            )

            Button(
                onClick = { viewModel.refreshAdvice() },
                enabled = !isRefreshing,
                colors = ButtonDefaults.buttonColors(
                    containerColor = SurfaceContainer,
                    contentColor = Primary
                ),
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isRefreshing) {
                    CircularProgressIndicator(
                        color = Primary,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp)
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = null,
                        tint = Primary,
                        modifier = Modifier.size(18.dp)
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = if (isRefreshing) "পরামর্শ হালনাগাদ হচ্ছে..." else "পরামর্শ হালনাগাদ করুন")
            }
            refreshMessage?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = OnSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            }

            // 2. Selected Plot Card
            Surface(
                color = SurfaceContainerLow,
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        modifier = Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.LocationOn,
                            contentDescription = null,
                            tint = PrimaryContainer,
                            modifier = Modifier.size(20.dp)
                        )
                        Column {
                            Text(
                                text = "নির্বাচিত জমি ও প্লট",
                                style = MaterialTheme.typography.labelSmall,
                                color = OnSurfaceVariant,
                                fontSize = 11.sp
                            )
                            Text(
                                text = advice.plotName,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = OnSurface
                            )
                        }
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(2.dp))
                            .background(SecondaryContainer)
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    ) {
                        Text(
                            text = advice.blockTag,
                            style = MaterialTheme.typography.labelSmall,
                            color = OnSecondaryContainer,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                    }
                }
            }

            // 3. Recommended Crop Rotation Card (Hero)
            Surface(
                color = SurfaceContainerLowest,
                shape = RoundedCornerShape(2.dp),
                shadowElevation = 2.dp,
                modifier = Modifier.bevel().fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Approved Guideline Pill & Cache Time
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
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
                                modifier = Modifier.size(15.dp)
                            )
                            Text(
                                text = advice.guidelineApproval,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = Primary
                            )
                        }

                        Text(
                            text = advice.cacheTimeString,
                            style = MaterialTheme.typography.labelSmall,
                            color = OnSurfaceVariant,
                            fontSize = 11.sp
                        )
                    }

                    // Rotation Title
                    Column {
                        Text(
                            text = "চলতি সুপারিশকৃত ফসল চক্র",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Medium,
                            color = Secondary
                        )
                        Text(
                            text = advice.rotationTitle,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = OnSurface,
                            modifier = Modifier.padding(top = 2.dp)
                        )
                        Text(
                            text = advice.rotationSubtitle,
                            style = MaterialTheme.typography.bodyMedium,
                            color = OnSurfaceVariant,
                            modifier = Modifier.padding(top = 2.dp)
                        )
                    }

                    // Season Breakdown Grid (Season 1 and 2)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(2.dp))
                            .background(SurfaceContainerLow)
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Season 1
                        Surface(
                            color = SurfaceContainerLowest,
                            shape = RoundedCornerShape(2.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(6.dp)
                                            .clip(CircleShape)
                                            .background(PrimaryContainer)
                                    )
                                    Text(
                                        text = "মৌসুম ১ (চলমান)",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = PrimaryContainer,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 10.5.sp
                                    )
                                }
                                Text(
                                    text = advice.season1Name,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = OnSurface,
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                                Text(
                                    text = advice.season1Variety,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = OnSurfaceVariant
                                )
                                Text(
                                    text = advice.season1Window.windowPart(0),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Secondary,
                                    fontSize = 10.sp,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                        }

                        // Season 2
                        Surface(
                            color = SurfaceContainerLowest,
                            shape = RoundedCornerShape(2.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(6.dp)
                                            .clip(CircleShape)
                                            .background(Outline)
                                    )
                                    Text(
                                        text = "মৌসুম ২ (পরবর্তী)",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = OnSurfaceVariant,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 10.5.sp
                                    )
                                }
                                Text(
                                    text = advice.season2Name,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = OnSurface,
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                                Text(
                                    text = advice.season2Variety,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = OnSurfaceVariant
                                )
                                Text(
                                    text = advice.season2Window.windowPart(0),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Secondary,
                                    fontSize = 10.sp,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                        }
                    }

                    // Field Stage Card (Organic Canvas Gradient)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(88.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(
                                Brush.verticalGradient(
                                    colors = listOf(
                                        PrimaryContainer,
                                        Primary
                                    )
                                )
                            )
                            .padding(12.dp),
                        contentAlignment = Alignment.BottomStart
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Place,
                                contentDescription = null,
                                tint = OnPrimary,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = advice.season1Stage,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Medium,
                                color = OnPrimary
                            )
                        }
                    }

                    // DAE Advisory Notice
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(2.dp))
                            .background(SurfaceContainer)
                            .padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = PrimaryContainer,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = advice.narrativeAdvice,
                            style = MaterialTheme.typography.bodySmall,
                            color = OnSurfaceVariant,
                            lineHeight = 18.sp
                        )
                    }

                    // Audio Player Component
                    AudioPlayerCard(
                        playbackState = playbackState,
                        onPlayClick = { viewModel.playAudio() },
                        onPauseOrStopClick = { viewModel.pauseOrStopAudio() }
                    )

                    // Secondary Action: Navigate to Plan
                    Button(
                        onClick = onNavigateToPlan,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SurfaceContainer,
                            contentColor = Primary
                        ),
                        shape = RoundedCornerShape(2.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.DateRange,
                                contentDescription = null,
                                tint = Primary,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "সম্পূর্ণ পর্যায়ক্রমিক পরিকল্পনা দেখুন",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    // Tertiary Action: Navigate to Advice History
                    Button(
                        onClick = onNavigateToHistory,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SurfaceContainer,
                            contentColor = Primary
                        ),
                        shape = RoundedCornerShape(2.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.DateRange,
                                contentDescription = null,
                                tint = Primary,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "আগের সংরক্ষিত পরামর্শের ইতিহাস দেখুন",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
            }

            // 4. Cache & Sync Info Notice
            Surface(
                color = SurfaceContainerLow,
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = OnSurfaceVariant,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "ক্যাশে ও সিঙ্ক তথ্য",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = OnSurfaceVariant
                        )
                    }
                    Text(
                        text = "আপনার এলাকায় নেটওয়ার্ক সংযোগ স্বাভাবিক হলে স্বয়ংক্রিয়ভাবে পরবর্তী মৌসুমের বীজ বপন ও সারের বিস্তারিত সূচি আপডেট হবে। অফলাইনে সংরক্ষিত তথ্য নিশ্চিন্তে অনুসরণযোগ্য।",
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 12.sp,
                        color = OnSurfaceVariant,
                        lineHeight = 18.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
