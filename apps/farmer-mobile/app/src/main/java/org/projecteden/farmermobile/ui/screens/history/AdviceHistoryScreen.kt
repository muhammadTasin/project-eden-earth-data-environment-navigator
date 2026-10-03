package org.projecteden.farmermobile.ui.screens.history

import org.projecteden.farmermobile.theme.bevel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.Secondary
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainer
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceContainerLow
import org.projecteden.farmermobile.theme.SurfaceContainerLowest
import org.projecteden.farmermobile.ui.components.EdenTopAppBar

@Composable
fun AdviceHistoryScreen(
    onBack: () -> Unit = {},
    onNavigateToDetail: () -> Unit,
    viewModel: AdviceHistoryViewModel = viewModel(),
    modifier: Modifier = Modifier
) {
    val historyList by viewModel.historyList.collectAsStateWithLifecycle()
    val advice by viewModel.currentAdvice.collectAsStateWithLifecycle()
    val playbackState by viewModel.playbackState.collectAsStateWithLifecycle()
    val playingItemId by viewModel.playingItemId.collectAsStateWithLifecycle()
    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Surface)
    ) {
        EdenTopAppBar(
            title = "আগের পরামর্শ",
            onBackClick = onBack,
            isOffline = advice.isOffline
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // 1. Offline Freshness Banner
            Surface(
                color = SurfaceContainerHigh,
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        modifier = Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(SurfaceContainer),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Info,
                                contentDescription = null,
                                tint = Primary,
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        Column {
                            Text(
                                text = "অফলাইন মোড: শেষ সিঙ্ক ${advice.lastSyncFormatted}",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = OnSurfaceVariant
                            )
                            Text(
                                text = "ক্যাশে থেকে দেখানো হচ্ছে • নেটওয়ার্ক প্রয়োজন নেই",
                                style = MaterialTheme.typography.labelSmall,
                                color = Secondary,
                                fontSize = 11.sp
                            )
                        }
                    }

                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(Secondary)
                    )
                }
            }

            // 2. Section Title & Meta
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "সংরক্ষিত পরামর্শ",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = Primary
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(2.dp))
                            .background(PrimaryContainer)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "${historyList.size}টি পরামর্শ",
                            style = MaterialTheme.typography.labelSmall,
                            color = OnPrimary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.DateRange,
                        contentDescription = null,
                        tint = Secondary,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = "সর্বশেষ তথ্য",
                        style = MaterialTheme.typography.labelSmall,
                        color = Secondary
                    )
                }
            }

            // 3. Saved Advice Card Stack
            historyList.forEach { item ->
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
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.DateRange,
                                        contentDescription = null,
                                        tint = Secondary,
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Text(
                                        text = item.seasonTag,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Secondary
                                    )
                                }

                                if (item.hasListenedAudio) {
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(SurfaceContainer)
                                            .padding(horizontal = 8.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = "শুনেছেন",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = Primary,
                                            fontWeight = FontWeight.Medium,
                                            fontSize = 10.5.sp
                                        )
                                    }
                                }
                            }

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Place,
                                    contentDescription = null,
                                    tint = Secondary,
                                    modifier = Modifier.size(18.dp)
                                )
                                Text(
                                    text = item.rotationTitle,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = Primary
                                )
                            }

                            Text(
                                text = item.adviceSummary,
                                style = MaterialTheme.typography.bodySmall,
                                color = OnSurface,
                                lineHeight = 18.sp
                            )

                            val isItemPlaying = playbackState is AudioPlaybackState.Playing && playingItemId == item.id

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Button(
                                    onClick = {
                                        if (isItemPlaying) {
                                            viewModel.pauseOrStopAudio()
                                        } else {
                                            viewModel.playAudio(item)
                                        }
                                    },
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = SurfaceContainer,
                                        contentColor = Primary
                                    ),
                                    shape = RoundedCornerShape(2.dp),
                                    modifier = Modifier.height(44.dp)
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Icon(
                                            imageVector = if (isItemPlaying) Icons.Default.Close else Icons.Default.PlayArrow,
                                            contentDescription = null,
                                            tint = Primary,
                                            modifier = Modifier.size(18.dp)
                                        )
                                        Text(
                                            text = if (isItemPlaying) "থামুন" else "পুনরায় শুনুন",
                                            style = MaterialTheme.typography.labelMedium,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }

                                IconButton(
                                    onClick = onNavigateToDetail,
                                    modifier = Modifier
                                        .size(44.dp)
                                        .clip(RoundedCornerShape(2.dp))
                                        .background(SurfaceContainerLow)
                                ) {
                                    Icon(
                                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                        contentDescription = "বিস্তারিত দেখুন",
                                        tint = OnSurfaceVariant,
                                        modifier = Modifier.size(24.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // 4. Honest Calm Empty State for Older Seasons
            Surface(
                color = SurfaceContainerLow,
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(SurfaceContainerHigh),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Place,
                            contentDescription = null,
                            tint = Primary,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Text(
                        text = "পূর্ববর্তী মৌসুমের কোনো সংরক্ষিত পরামর্শ নেই",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Primary
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    Text(
                        text = "নতুন পরামর্শ তৈরি হলে অথবা মাঠ কর্মকর্তা কর্তৃক হালনাগাদ দেওয়া হলে স্বয়ংক্রিয়ভাবে এখানে সংরক্ষিত হবে।",
                        style = MaterialTheme.typography.bodySmall,
                        color = OnSurfaceVariant,
                        fontSize = 12.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        lineHeight = 18.sp
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    // Contact SAAO Chip
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(2.dp))
                            .background(SurfaceContainer)
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Phone,
                                contentDescription = null,
                                tint = Secondary,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = "সহায়তা প্রয়োজন? ইউনিয়ন কর্মকর্তার সাথে যোগাযোগ করুন",
                                style = MaterialTheme.typography.labelSmall,
                                color = Secondary
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
