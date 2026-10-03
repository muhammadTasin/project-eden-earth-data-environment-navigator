package org.projecteden.farmermobile.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.projecteden.farmermobile.audio.AudioPlaybackState
import org.projecteden.farmermobile.theme.Error
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceDim

// Helper to convert western digits to Bengali numerals
fun Int.toBanglaDigits(): String {
    val bnDigits = charArrayOf('০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯')
    val str = this.toString()
    val sb = StringBuilder()
    for (ch in str) {
        if (ch in '0'..'9') {
            sb.append(bnDigits[ch - '0'])
        } else {
            sb.append(ch)
        }
    }
    return sb.toString()
}

fun formatBanglaTimer(currentSec: Int, totalSec: Int): String {
    val curMin = currentSec / 60
    val curRemSec = currentSec % 60
    val totMin = totalSec / 60
    val totRemSec = totalSec % 60

    val curStr = "${curMin.toBanglaDigits()}:${if (curRemSec < 10) "০" else ""}${curRemSec.toBanglaDigits()}"
    val totStr = "${totMin.toBanglaDigits()}:${if (totRemSec < 10) "০" else ""}${totRemSec.toBanglaDigits()}"
    return "$curStr / $totStr"
}

@Composable
fun AudioPlayerCard(
    playbackState: AudioPlaybackState,
    onPlayClick: () -> Unit,
    onPauseOrStopClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isPlaying = playbackState is AudioPlaybackState.Playing

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Main Trigger Button
        Button(
            onClick = {
                if (isPlaying) onPauseOrStopClick() else onPlayClick()
            },
            colors = ButtonDefaults.buttonColors(
                containerColor = Primary,
                contentColor = OnPrimary
            ),
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.PlayArrow,
                    contentDescription = "অডিও শুনুন",
                    tint = OnPrimary,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = if (isPlaying) "অডিও চলছে (থামান)" else "পরামর্শটি শুনুন (অডিও)",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
            }
        }

        // Active Player Bar
        AnimatedVisibility(
            visible = isPlaying,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically()
        ) {
            val state = playbackState as? AudioPlaybackState.Playing
            val progressFraction = state?.progressFraction ?: 0f
            val currentSec = state?.currentSeconds ?: 0
            val totalSec = state?.totalSeconds ?: 80

            Surface(
                color = SurfaceContainerHigh,
                shape = RoundedCornerShape(2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(PrimaryContainer)
                            .clickable { onPauseOrStopClick() },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "❚❚",
                            color = OnPrimary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp
                        )
                    }

                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "বাংলা অডিও গাইড",
                                style = MaterialTheme.typography.labelSmall,
                                color = OnSurfaceVariant,
                                fontSize = 11.sp
                            )
                            Text(
                                text = formatBanglaTimer(currentSec, totalSec),
                                style = MaterialTheme.typography.labelSmall,
                                color = OnSurfaceVariant,
                                fontSize = 11.sp
                            )
                        }

                        LinearProgressIndicator(
                            progress = { progressFraction },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(2.dp)),
                            color = PrimaryContainer,
                            trackColor = SurfaceDim
                        )
                    }
                }
            }
        }

        // Error Feedback State
        if (playbackState is AudioPlaybackState.Error) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(2.dp))
                    .background(SurfaceContainerHigh)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = "সতর্কতা",
                    tint = Error,
                    modifier = Modifier.size(16.dp)
                )
                Text(
                    text = playbackState.messageBangla,
                    style = MaterialTheme.typography.labelSmall,
                    color = OnSurface,
                    fontSize = 11.sp
                )
            }
        }
    }
}
