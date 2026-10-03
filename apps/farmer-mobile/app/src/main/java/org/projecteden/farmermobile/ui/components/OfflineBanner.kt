package org.projecteden.farmermobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.Secondary
import org.projecteden.farmermobile.theme.SurfaceContainerHigh

@Composable
fun OfflineStatusBanner(
    isOffline: Boolean,
    lastSyncTimeText: String = "সকাল ৭:০০",
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(2.dp))
            .background(SurfaceContainerHigh)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Info,
                contentDescription = "অফলাইন স্ট্যাটাস",
                tint = if (isOffline) Secondary else PrimaryContainer,
                modifier = Modifier.size(18.dp)
            )

            Text(
                text = if (isOffline) {
                    "অফলাইন মোড — সংরক্ষিত তথ্য (আপডেট: $lastSyncTimeText)"
                } else {
                    "অনলাইন মোড — রিয়েলটাইম তথ্য সিঙ্ক সক্রিয়"
                },
                style = MaterialTheme.typography.labelSmall,
                color = OnSurfaceVariant,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (isOffline) Secondary else PrimaryContainer)
        )
    }
}
