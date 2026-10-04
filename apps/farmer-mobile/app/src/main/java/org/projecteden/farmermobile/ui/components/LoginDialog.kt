package org.projecteden.farmermobile.ui.components

import org.projecteden.farmermobile.theme.EdenShape

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import org.projecteden.farmermobile.theme.OnPrimary
import org.projecteden.farmermobile.theme.OnSurface
import org.projecteden.farmermobile.theme.OnSurfaceVariant
import org.projecteden.farmermobile.theme.Outline
import org.projecteden.farmermobile.theme.Primary
import org.projecteden.farmermobile.theme.PrimaryContainer
import org.projecteden.farmermobile.theme.Surface
import org.projecteden.farmermobile.theme.SurfaceContainerHigh
import org.projecteden.farmermobile.theme.SurfaceContainerLowest

@Composable
fun LoginDialog(
    onDismiss: () -> Unit,
    onLogin: (role: String, id: String, pinOrCode: String) -> Unit,
    isLoading: Boolean = false,
    errorMessage: String? = null
) {
    var selectedRole by remember { mutableStateOf("farmer") } // "farmer" or "officer"
    // Demo credentials are pre-filled in debug builds only; release builds start with empty fields.
    var idInput by remember { mutableStateOf(if (org.projecteden.farmermobile.BuildConfig.DEBUG) "F01" else "") }
    var pinOrCodeInput by remember { mutableStateOf(if (org.projecteden.farmermobile.BuildConfig.DEBUG) "1234" else "") }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(2.dp),
            color = Surface,
            tonalElevation = 6.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Header
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.AccountCircle,
                        contentDescription = null,
                        tint = Primary,
                        modifier = Modifier.size(28.dp)
                    )
                    Text(
                        text = "প্রজেক্ট ইডেন সাইন-ইন",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = OnSurface
                    )
                }

                // Role Toggle
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(2.dp))
                        .background(SurfaceContainerHigh)
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    val isFarmer = selectedRole == "farmer"
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(2.dp))
                            .background(if (isFarmer) Primary else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable {
                                selectedRole = "farmer"
                                idInput = if (org.projecteden.farmermobile.BuildConfig.DEBUG) "F01" else ""
                                pinOrCodeInput = if (org.projecteden.farmermobile.BuildConfig.DEBUG) "1234" else ""
                            }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "কৃষক লগইন",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isFarmer) OnPrimary else OnSurfaceVariant
                        )
                    }

                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(2.dp))
                            .background(if (!isFarmer) Primary else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable {
                                selectedRole = "officer"
                                if (org.projecteden.farmermobile.BuildConfig.DEBUG) {
                                    idInput = "saao_talanda_01"
                                    pinOrCodeInput = "talanda-demo"
                                } else {
                                    idInput = ""
                                    pinOrCodeInput = ""
                                }
                            }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "কর্মকর্তা (SAAO)",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (!isFarmer) OnPrimary else OnSurfaceVariant
                        )
                    }
                }

                // Quick demo helpers: debug builds only (they fill in the server's demo accounts)
                if (org.projecteden.farmermobile.BuildConfig.DEBUG) {
                Text(
                    text = if (selectedRole == "farmer") "দ্রুত বাছাই (ডেমো কৃষক):" else "ডেমো কর্মকর্তা তথ্য:",
                    style = MaterialTheme.typography.labelSmall,
                    color = OnSurfaceVariant
                )
                if (selectedRole == "farmer") {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        listOf("F01" to "কৃষক ০১", "F02" to "কৃষক ০২", "F04" to "কৃষক ০৪").forEach { (fid, label) ->
                            Surface(
                                shape = RoundedCornerShape(2.dp),
                                color = if (idInput == fid) PrimaryContainer else SurfaceContainerHigh,
                                modifier = Modifier.clickable {
                                    idInput = fid
                                    pinOrCodeInput = "1234"
                                }
                            ) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (idInput == fid) Primary else OnSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                                )
                            }
                        }
                    }
                } else {
                    Surface(
                        shape = RoundedCornerShape(2.dp),
                        color = PrimaryContainer,
                        modifier = Modifier.clickable {
                            idInput = "saao_talanda_01"
                            pinOrCodeInput = "talanda-demo"
                        }
                    ) {
                        Text(
                            text = "তালন্দ ব্লক SAAO (saao_talanda_01)",
                            style = MaterialTheme.typography.labelSmall,
                            color = Primary,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                        )
                    }
                }
                }

                // Input Fields
                OutlinedTextField(
                    value = idInput,
                    onValueChange = { idInput = it },
                    label = { Text(if (selectedRole == "farmer") "কৃষক আইডি / মোবাইল নম্বর" else "কর্মকর্তা আইডি") },
                    leadingIcon = {
                        Icon(imageVector = Icons.Default.Person, contentDescription = null, tint = Primary)
                    },
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
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = pinOrCodeInput,
                    onValueChange = { pinOrCodeInput = it },
                    label = { Text(if (selectedRole == "farmer") "পিন নম্বর (৪ ডিজিট)" else "এক্সেস কোড") },
                    leadingIcon = {
                        Icon(imageVector = Icons.Default.Lock, contentDescription = null, tint = Primary)
                    },
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
                    modifier = Modifier.fillMaxWidth()
                )

                if (errorMessage != null) {
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                // Action Buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = onDismiss, enabled = !isLoading, shape = EdenShape) {
                        Text("বাতিল")
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = { onLogin(selectedRole, idInput, pinOrCodeInput) },
                        enabled = !isLoading && idInput.isNotBlank() && pinOrCodeInput.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = OnPrimary),
                        shape = RoundedCornerShape(2.dp)
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = OnPrimary,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text("প্রবেশ করুন")
                        }
                    }
                }
            }
        }
    }
}
