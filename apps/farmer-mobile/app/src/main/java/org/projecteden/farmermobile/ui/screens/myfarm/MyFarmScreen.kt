package org.projecteden.farmermobile.ui.screens.myfarm

import org.projecteden.farmermobile.theme.bevel

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Login
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import org.projecteden.farmermobile.data.local.AuthState
import org.projecteden.farmermobile.theme.InverseOnSurface
import org.projecteden.farmermobile.theme.InverseSurface
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnPrimaryContainer
import org.projecteden.farmermobile.theme.OnPrimaryFixed
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Outline
import org.projecteden.farmermobile.theme.OutlineVariant
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.PrimaryFixed
import org.projecteden.farmermobile.theme.PrimaryFixedDim
import org.projecteden.farmermobile.theme.Secondary
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainer
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceContainerLow
import org.projecteden.farmermobile.theme.SurfaceContainerLowest
import org.projecteden.farmermobile.theme.Tertiary
import org.projecteden.farmermobile.ui.components.EdenTopAppBar
import org.projecteden.farmermobile.ui.components.LoginDialog

@Composable
fun MyFarmScreen(
    viewModel: MyFarmViewModel = viewModel(),
    modifier: Modifier = Modifier
) {
    val farmProfile by viewModel.farmProfile.collectAsStateWithLifecycle()
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val isUpdating by viewModel.isUpdating.collectAsStateWithLifecycle()
    val isEditing by viewModel.isEditing.collectAsStateWithLifecycle()
    val draftProfile by viewModel.draftProfile.collectAsStateWithLifecycle()
    val feedbackMessage by viewModel.feedbackMessage.collectAsStateWithLifecycle()
    val errorMessage by viewModel.errorMessage.collectAsStateWithLifecycle()

    var showLoginDialog by remember { mutableStateOf(false) }
    var showAccountDialog by remember { mutableStateOf(false) }

    val scrollState = rememberScrollState()
    val coroutineScope = rememberCoroutineScope()

    if (showLoginDialog) {
        LoginDialog(
            onDismiss = { showLoginDialog = false },
            onLogin = { role, id, pinOrCode ->
                viewModel.login(role, id, pinOrCode) { result ->
                    if (result.isSuccess) {
                        showLoginDialog = false
                    }
                }
            },
            errorMessage = errorMessage
        )
    }

    if (showAccountDialog) {
        val user = (authState as? AuthState.Authenticated)?.user
        AlertDialog(
            onDismissRequest = { showAccountDialog = false },
            icon = {
                Icon(
                    imageVector = Icons.Default.AccountCircle,
                    contentDescription = null,
                    tint = Primary,
                    modifier = Modifier.size(36.dp)
                )
            },
            title = {
                Text(
                    text = user?.nameBangla ?: "প্রোফাইল তথ্য",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = OnSurface
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "${user?.titleBangla} (${if (user?.role == "officer") "কৃষি কর্মকর্তা" else "কৃষক"})",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Primary,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "ব্লক / গ্রাম: ${user?.blockOrVillage}",
                        style = MaterialTheme.typography.bodySmall,
                        color = OnSurfaceVariant
                    )
                    Text(
                        text = "লগইন স্থিতি: সুরক্ষিত ও সক্রিয়",
                        style = MaterialTheme.typography.labelSmall,
                        color = OnSurfaceVariant
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showAccountDialog = false
                        viewModel.logout()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = OnPrimary
                    )
                ) {
                    Icon(imageVector = Icons.Default.Logout, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("লগআউট")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAccountDialog = false }) {
                    Text("বন্ধ করুন")
                }
            },
            containerColor = Surface
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Surface)
            .imePadding()
    ) {
        EdenTopAppBar(
            title = "আমার খামার ও প্রোফাইল",
            isOffline = true,
            onProfileClick = {
                if (authState is AuthState.Authenticated) {
                    showAccountDialog = true
                } else {
                    showLoginDialog = true
                }
            }
        )

        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // 1. Session / Authentication Card
                Surface(
                    color = SurfaceContainerHigh,
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
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.AccountCircle,
                                contentDescription = null,
                                tint = Primary,
                                modifier = Modifier.size(24.dp)
                            )
                            Column {
                                when (val state = authState) {
                                    is AuthState.Authenticated -> {
                                        Text(
                                            text = state.user.nameBangla,
                                            style = MaterialTheme.typography.titleSmall,
                                            fontWeight = FontWeight.Bold,
                                            color = OnSurface
                                        )
                                        Text(
                                            text = "${state.user.titleBangla} • ${state.user.blockOrVillage}",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = Primary
                                        )
                                    }
                                    is AuthState.Guest -> {
                                        Text(
                                            text = "অতিথি ব্যবহারকারী",
                                            style = MaterialTheme.typography.titleSmall,
                                            fontWeight = FontWeight.Bold,
                                            color = OnSurface
                                        )
                                        Text(
                                            text = "লগইন করে আপনার নির্দিষ্ট তথ্য দেখুন",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = OnSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }

                        when (authState) {
                            is AuthState.Authenticated -> {
                                OutlinedButton(
                                    onClick = { viewModel.logout() },
                                    shape = RoundedCornerShape(2.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Logout,
                                        contentDescription = "সাইন আউট",
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("লগআউট", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                            is AuthState.Guest -> {
                                Button(
                                    onClick = { showLoginDialog = true },
                                    colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = OnPrimary),
                                    shape = RoundedCornerShape(2.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Login,
                                        contentDescription = "সাইন ইন",
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("লগইন", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }
                }

                // 2. Farm Identification Banner
                Surface(
                    color = PrimaryContainer,
                    shape = RoundedCornerShape(2.dp),
                    shadowElevation = 2.dp,
                    modifier = Modifier.bevel().fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(44.dp)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(PrimaryFixed.copy(alpha = 0.25f)),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Place,
                                    contentDescription = "খামার",
                                    tint = PrimaryFixed,
                                    modifier = Modifier.size(24.dp)
                                )
                            }

                            Column {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Text(
                                        text = farmProfile.farmName,
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = OnPrimary
                                    )
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(PrimaryFixed.copy(alpha = 0.2f))
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = farmProfile.sampleTag,
                                            style = MaterialTheme.typography.labelSmall,
                                            fontSize = 9.sp,
                                            color = PrimaryFixed
                                        )
                                    }
                                }
                                Text(
                                    text = farmProfile.region,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = OnPrimaryContainer
                                )
                            }
                        }

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(2.dp))
                                .background(Color.White.copy(alpha = 0.15f))
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = farmProfile.pilotZoneTag,
                                style = MaterialTheme.typography.labelSmall,
                                color = PrimaryFixed,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                // 3. EDIT CONTROLS & FORM - PLACED DIRECTLY AT TOP
                if (!isEditing) {
                    Button(
                        onClick = {
                            viewModel.startEditing()
                            coroutineScope.launch { scrollState.animateScrollTo(0) }
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Primary,
                            contentColor = OnPrimary
                        ),
                        shape = RoundedCornerShape(2.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "খামারের তথ্য সম্পাদনা করুন",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold
                        )
                    }
                } else {
                    val currentDraft = draftProfile ?: farmProfile
                    Surface(
                        color = SurfaceContainerLow,
                        shape = RoundedCornerShape(2.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, Primary.copy(alpha = 0.5f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
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
                                    Icon(
                                        imageVector = Icons.Default.Edit,
                                        contentDescription = null,
                                        tint = Primary,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Text(
                                        text = "খামারের তথ্য সম্পাদনা",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = Primary
                                    )
                                }
                            }

                            Text(
                                text = "পরিবর্তনগুলো আপনার ডিভাইসের সুরক্ষিত ডেটাবেজে সংরক্ষিত হবে (ডিভাইসে সংরক্ষিত)।",
                                style = MaterialTheme.typography.bodySmall,
                                color = OnSurfaceVariant
                            )

                            // Quick reachable Save/Cancel buttons at TOP of form
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                OutlinedButton(
                                    onClick = { viewModel.cancelEditing() },
                                    enabled = !isUpdating,
                                    shape = RoundedCornerShape(2.dp),
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(44.dp)
                                ) {
                                    Icon(imageVector = Icons.Default.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("বাতিল")
                                }

                                Button(
                                    onClick = { viewModel.saveDraft() },
                                    enabled = !isUpdating,
                                    colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = OnPrimary),
                                    shape = RoundedCornerShape(2.dp),
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(44.dp)
                                ) {
                                    if (isUpdating) {
                                        CircularProgressIndicator(
                                            color = OnPrimary,
                                            strokeWidth = 2.dp,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text("সংরক্ষণ হচ্ছে...", style = MaterialTheme.typography.labelMedium)
                                    } else {
                                        Icon(imageVector = Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("সংরক্ষণ করুন", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }

                            // Editable Input Fields
                            FarmEditField("খামারের নাম", currentDraft.farmName) { text ->
                                viewModel.updateDraft { it.copy(farmName = text) }
                            }
                            FarmEditField("অঞ্চল", currentDraft.region) { text ->
                                viewModel.updateDraft { it.copy(region = text) }
                            }
                            FarmEditField("ভৌগোলিক এলাকা", currentDraft.geoArea) { text ->
                                viewModel.updateDraft { it.copy(geoArea = text) }
                            }
                            FarmEditField("প্লটের বিবরণ", currentDraft.plotDescription) { text ->
                                viewModel.updateDraft { it.copy(plotDescription = text) }
                            }
                            FarmEditField("মোট জমির পরিমাণ", currentDraft.totalArea) { text ->
                                viewModel.updateDraft { it.copy(totalArea = text) }
                            }
                            FarmEditField("জমির শ্রেণি", currentDraft.landType) { text ->
                                viewModel.updateDraft { it.copy(landType = text) }
                            }
                            FarmEditField("মাটির বুনট", currentDraft.soilTexture) { text ->
                                viewModel.updateDraft { it.copy(soilTexture = text) }
                            }
                            FarmEditField("সেচ ও নিষ্কাশনের বিবরণ", currentDraft.irrigationFacility) { text ->
                                viewModel.updateDraft { it.copy(irrigationFacility = text) }
                            }
                            FarmEditField(
                                label = "অগ্রাধিকার (কমা দিয়ে আলাদা করুন)",
                                value = currentDraft.priorities,
                                keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Done)
                            ) { text ->
                                viewModel.updateDraft { it.copy(priorities = text) }
                            }

                            // Save and Cancel Actions at bottom of form
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                OutlinedButton(
                                    onClick = { viewModel.cancelEditing() },
                                    enabled = !isUpdating,
                                    shape = RoundedCornerShape(2.dp),
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(48.dp)
                                ) {
                                    Icon(imageVector = Icons.Default.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("বাতিল")
                                }

                                Button(
                                    onClick = { viewModel.saveDraft() },
                                    enabled = !isUpdating,
                                    colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = OnPrimary),
                                    shape = RoundedCornerShape(2.dp),
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(48.dp)
                                ) {
                                    if (isUpdating) {
                                        CircularProgressIndicator(
                                            color = OnPrimary,
                                            strokeWidth = 2.dp,
                                            modifier = Modifier.size(18.dp)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text("সংরক্ষণ হচ্ছে...")
                                    } else {
                                        Icon(imageVector = Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("সংরক্ষণ করুন", fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }
                    }
                }

                // 4. Farm Location Card
                Surface(
                    color = SurfaceContainerLow,
                    shape = RoundedCornerShape(2.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(SurfaceContainerHigh.copy(alpha = 0.5f))
                                .clickable {
                                    viewModel.startEditing()
                                    coroutineScope.launch { scrollState.animateScrollTo(0) }
                                }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.LocationOn,
                                    contentDescription = null,
                                    tint = Primary,
                                    modifier = Modifier.size(18.dp)
                                )
                                Text(
                                    text = "খামারের অবস্থান",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = Primary
                                )
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Edit,
                                    contentDescription = "পরিবর্তন",
                                    tint = Primary,
                                    modifier = Modifier.size(14.dp)
                                )
                                Text(
                                    text = "পরিবর্তন",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Primary
                                )
                            }
                        }

                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            InfoItem("অঞ্চল", farmProfile.region)
                            InfoItem("ভৌগোলিক এলাকা", farmProfile.geoArea)
                        }
                    }
                }

                // 5. Plot & Agro Info Card
                Surface(
                    color = SurfaceContainerLow,
                    shape = RoundedCornerShape(2.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(SurfaceContainerHigh.copy(alpha = 0.5f))
                                .clickable {
                                    viewModel.startEditing()
                                    coroutineScope.launch { scrollState.animateScrollTo(0) }
                                }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "প্লট ও ভূমির বিবরণ",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = Primary
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Edit,
                                    contentDescription = "পরিবর্তন",
                                    tint = Primary,
                                    modifier = Modifier.size(14.dp)
                                )
                                Text(
                                    text = "পরিবর্তন",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Primary
                                )
                            }
                        }

                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            InfoItem("প্লটের বিবরণ", farmProfile.plotDescription)
                            InfoItem("মোট জমির পরিমাণ", farmProfile.totalArea)
                            InfoItem("জমির শ্রেণি", farmProfile.landType)
                            InfoItem("মাটির বুনট", farmProfile.soilTexture)
                            InfoItem("সেচ ও নিষ্কাশনের সুবিধা", farmProfile.irrigationFacility)
                            InfoItem("কৃষকের অগ্রাধিকার", farmProfile.priorities)
                        }
                    }
                }

                // 6. Consent & Data Integrity Ledger
                Surface(
                    color = SurfaceContainerLow,
                    shape = RoundedCornerShape(2.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "উপাত্ত সুরক্ষা ও সম্মতি",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = OnSurface
                        )
                        Text(
                            text = farmProfile.consentDisclaimer,
                            style = MaterialTheme.typography.bodySmall,
                            color = OnSurfaceVariant,
                            lineHeight = 18.sp
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))
            }

            // Success Toast
            androidx.compose.animation.AnimatedVisibility(
                visible = feedbackMessage != null,
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
                            text = feedbackMessage ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = InverseOnSurface
                        )
                    }
                }
            }

            // Error Toast
            androidx.compose.animation.AnimatedVisibility(
                visible = errorMessage != null,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 24.dp)
            ) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(2.dp),
                    shadowElevation = 6.dp
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Error,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = errorMessage ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoItem(label: String, value: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = OnSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = OnSurface
        )
    }
}

@Composable
private fun FarmEditField(
    label: String,
    value: String,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Next),
    onValueChange: (String) -> Unit
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, style = MaterialTheme.typography.bodySmall) },
        singleLine = singleLine,
        keyboardOptions = keyboardOptions,
        textStyle = MaterialTheme.typography.bodyMedium.copy(
            color = OnSurface,
            fontWeight = FontWeight.Medium
        ),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = OnSurface,
            unfocusedTextColor = OnSurface,
            focusedContainerColor = SurfaceContainerLowest,
            unfocusedContainerColor = SurfaceContainerLowest,
            focusedLabelColor = Primary,
            unfocusedLabelColor = OnSurfaceVariant,
            focusedBorderColor = Primary,
            unfocusedBorderColor = Outline,
            cursorColor = Primary
        ),
        shape = RoundedCornerShape(2.dp),
        modifier = Modifier.fillMaxWidth()
    )
}
