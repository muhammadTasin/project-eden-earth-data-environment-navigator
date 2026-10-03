package org.projecteden.farmermobile.ui.screens.ai

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnPrimaryContainer
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Outline
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.PrimaryFixed
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceContainerLow
import org.projecteden.farmermobile.theme.SurfaceContainerLowest
import org.projecteden.farmermobile.theme.Tertiary
import org.projecteden.farmermobile.ui.components.EdenTopAppBar

@Composable
fun AiAssistantScreen(
    viewModel: AiAssistantViewModel = viewModel(),
    onNavigateToProfile: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val messages by viewModel.messages.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Surface)
            .imePadding()
    ) {
        EdenTopAppBar(
            title = "সহায়ক এআই (কৃষি সহকারী)",
            isOffline = false,
            onProfileClick = onNavigateToProfile
        )

        // Grounding Notice Banner
        Surface(
            color = SurfaceContainerHigh,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Verified,
                    contentDescription = null,
                    tint = Primary,
                    modifier = Modifier.size(18.dp)
                )
                Text(
                    text = "নাসা উপগ্রহ, বিআরআরআই ও এসআরডিআই তথ্যে নিবদ্ধিত প্রামাণ্য সহকারী",
                    style = MaterialTheme.typography.labelSmall,
                    color = Primary,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        // Messages List
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { Spacer(modifier = Modifier.height(6.dp)) }

            items(messages, key = { it.id }) { msg ->
                ChatBubble(message = msg)
            }

            if (isLoading) {
                item {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(8.dp)
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Primary, strokeWidth = 2.dp)
                        Text(
                            text = "বিজ্ঞানসম্মত তথ্য বিশ্লেষণ করা হচ্ছে...",
                            style = MaterialTheme.typography.bodySmall,
                            color = OnSurfaceVariant
                        )
                    }
                }
            }

            item { Spacer(modifier = Modifier.height(8.dp)) }
        }

        // Quick Suggestion Chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            viewModel.promptSuggestions.forEach { prompt ->
                Surface(
                    shape = RoundedCornerShape(2.dp),
                    color = SurfaceContainerLow,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Primary.copy(alpha = 0.3f)),
                    modifier = Modifier.clickable {
                        viewModel.sendQuery(prompt)
                    }
                ) {
                    Text(
                        text = prompt,
                        style = MaterialTheme.typography.labelSmall,
                        color = Primary,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }
        }

        // Input Field Bar
        Surface(
            color = SurfaceContainerHigh,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Speak instead of typing: the phone's speech recogniser (Bangla) turns the words into text
                val context = LocalContext.current
                val speech = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                    val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
                    if (result.resultCode == Activity.RESULT_OK && !heard.isNullOrBlank()) {
                        viewModel.sendQuery(heard, spoken = true)
                    }
                }
                IconButton(
                    onClick = {
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "bn-BD")
                            putExtra(RecognizerIntent.EXTRA_PROMPT, "কোন ফসল করতে চান, বলুন")
                        }
                        try {
                            speech.launch(intent)
                        } catch (e: ActivityNotFoundException) {
                            Toast.makeText(context, "এই ফোনে কথা থেকে লেখার সুবিধা নেই; লিখে পাঠান।", Toast.LENGTH_LONG).show()
                        }
                    },
                    enabled = !isLoading,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(SurfaceContainerHigh)
                ) {
                    Icon(
                        imageVector = Icons.Filled.Mic,
                        contentDescription = "বলুন",
                        tint = Primary,
                        modifier = Modifier.size(22.dp)
                    )
                }

                OutlinedTextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    placeholder = { Text("আপনার প্রশ্ন এখানে লিখুন...", color = OnSurfaceVariant) },
                    maxLines = 3,
                    shape = RoundedCornerShape(2.dp),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        color = OnSurface,
                        fontWeight = FontWeight.Normal
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = OnSurface,
                        unfocusedTextColor = OnSurface,
                        focusedContainerColor = SurfaceContainerLowest,
                        unfocusedContainerColor = SurfaceContainerLowest,
                        focusedBorderColor = Primary,
                        unfocusedBorderColor = Outline,
                        cursorColor = Primary
                    ),
                    modifier = Modifier.weight(1f)
                )

                IconButton(
                    onClick = {
                        val text = inputText
                        inputText = ""
                        viewModel.sendQuery(text)
                    },
                    enabled = !isLoading && inputText.isNotBlank(),
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(if (!isLoading && inputText.isNotBlank()) Primary else SurfaceContainerLow)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "পাঠান",
                        tint = if (!isLoading && inputText.isNotBlank()) OnPrimary else OnSurfaceVariant,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatBubble(message: ChatMessage) {
    if (message.isUser) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            Surface(
                color = Primary,
                shape = RoundedCornerShape(topStart = 16.dp, topEnd = 4.dp, bottomStart = 16.dp, bottomEnd = 16.dp),
                modifier = Modifier.fillMaxWidth(0.82f)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = message.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = OnPrimary,
                        lineHeight = 20.sp
                    )
                    Text(
                        text = message.timeFormatted,
                        style = MaterialTheme.typography.labelSmall,
                        fontSize = 10.sp,
                        color = OnPrimary.copy(alpha = 0.7f),
                        modifier = Modifier
                            .align(Alignment.End)
                            .padding(top = 4.dp)
                    )
                }
            }
        }
    } else {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Start
        ) {
            Surface(
                color = SurfaceContainerLow,
                shape = RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 16.dp),
                border = if (message.isInsufficientEvidence) androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFBA1A1A).copy(alpha = 0.4f)) else null,
                modifier = Modifier.fillMaxWidth(0.92f)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .clip(CircleShape)
                                .background(if (message.isInsufficientEvidence) Color(0xFFBA1A1A) else Primary),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = if (message.isInsufficientEvidence) Icons.Default.HelpOutline else Icons.Default.AutoAwesome,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(14.dp)
                            )
                        }
                        Text(
                            text = if (message.isInsufficientEvidence) "প্রমাণ সীমাবদ্ধতা" else "ইডেন এআই সহকারী",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (message.isInsufficientEvidence) Color(0xFFBA1A1A) else Primary
                        )
                    }

                    Text(
                        text = message.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = OnSurface,
                        lineHeight = 22.sp
                    )

                    // Sources footer
                    if (message.sources.isNotEmpty()) {
                        Surface(
                            color = SurfaceContainerHigh.copy(alpha = 0.6f),
                            shape = RoundedCornerShape(2.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    text = "তথ্যসূত্র:",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = Primary
                                )
                                message.sources.forEach { src ->
                                    Text(
                                        text = "• $src",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontSize = 11.sp,
                                        color = OnSurfaceVariant
                                    )
                                }
                            }
                        }
                    }

                    Text(
                        text = message.timeFormatted,
                        style = MaterialTheme.typography.labelSmall,
                        fontSize = 10.sp,
                        color = OnSurfaceVariant,
                        modifier = Modifier.align(Alignment.End)
                    )
                }
            }
        }
    }
}
