package com.taskboard.sync.ui.settings

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.taskboard.sync.data.local.entity.SyncMetaEntity
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.repository.ExportRepository
import com.taskboard.sync.data.repository.SessionRepository
import com.taskboard.sync.data.repository.TaskRepository
import com.taskboard.sync.data.sync.SyncScheduler
import com.taskboard.sync.di.AppContainer
import com.taskboard.sync.ui.common.AppViewModelFactory
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class SettingsViewModel(
    private val sessionRepository: SessionRepository,
    private val taskRepository: TaskRepository,
    private val exportRepository: ExportRepository,
    private val syncScheduler: SyncScheduler,
) : ViewModel() {

    var meta by mutableStateOf<SyncMetaEntity?>(null)
        private set
    var username by mutableStateOf("")
        private set
    var baseUrl by mutableStateOf(sessionRepository.baseUrl)
        private set
    var loading by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var sessionExpired by mutableStateOf(false)
        private set

    init {
        viewModelScope.launch { taskRepository.meta.collect { meta = it } }
        load()
    }

    fun load() {
        viewModelScope.launch {
            loading = true
            error = null
            try {
                username = sessionRepository.fetchUsername()
                sessionRepository.refreshServerInfo()
                runCatching { taskRepository.refresh() }
                syncScheduler.enqueue()
            } catch (e: ApiException) {
                handle(e)
            } finally {
                loading = false
            }
        }
    }

    fun changeAccount(currentPassword: String, newPassword: String, newUsername: String) {
        viewModelScope.launch {
            try {
                sessionRepository.changeAccount(newUsername, currentPassword, newPassword)
                username = newUsername
                message = "账号已更新"
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun export(resolver: ContentResolver, uri: Uri) {
        viewModelScope.launch {
            try {
                exportRepository.exportTo(resolver, uri)
                message = "导出完成，已保存到所选位置"
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            sessionRepository.logout()
            onDone()
        }
    }

    private fun handle(e: ApiException) {
        when (e.kind) {
            ApiErrorKind.UNAUTHORIZED -> sessionExpired = true
            else -> error = e.message
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onLoggedOut: () -> Unit,
    onSessionExpired: () -> Unit,
) {
    val vm: SettingsViewModel = viewModel(factory = AppViewModelFactory(container))
    val context = LocalContext.current

    LaunchedEffect(vm.sessionExpired) {
        if (vm.sessionExpired) onSessionExpired()
    }

    var showChangeAccount by mutableStateOf(false)

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/zip"),
    ) { uri ->
        if (uri != null) vm.export(context.contentResolver, uri)
    }

    if (showChangeAccount) {
        ChangeAccountDialog(
            initialUsername = vm.username,
            onDismiss = { showChangeAccount = false },
            onConfirm = { current, next, user ->
                vm.changeAccount(current, next, user)
                showChangeAccount = false
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            vm.error?.let {
                Text(
                    text = it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(8.dp))
            }
            vm.message?.let {
                Text(
                    text = it,
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(8.dp))
            }

            SectionCard(title = "账号") {
                InfoRow("用户名", vm.username.ifBlank { "-" })
                InfoRow("服务地址", vm.baseUrl.ifBlank { "-" })
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { showChangeAccount = true }) { Text("修改账号") }
            }

            Spacer(Modifier.height(12.dp))

            SectionCard(title = "服务") {
                InfoRow("服务版本", vm.meta?.serverVersion?.ifBlank { "-" } ?: "-")
                InfoRow("分支", vm.meta?.serverBranch?.ifBlank { "-" } ?: "-")
                InfoRow("R2 附件存储", if (vm.meta?.r2Enabled == true) "已启用" else "未启用")
                InfoRow("单文件上限（本地）", "${vm.meta?.maxUploadMb ?: 0} MB")
                InfoRow("单文件上限（R2）", "${vm.meta?.maxR2UploadMb ?: 0} MB")
                InfoRow("回收站保留", "${vm.meta?.retentionDays ?: 0} 天")
                InfoRow("最近同步", formatTime(vm.meta?.lastSyncAt))
            }

            Spacer(Modifier.height(12.dp))

            SectionCard(title = "数据") {
                OutlinedButton(onClick = { exportLauncher.launch("task-board-export.zip") }) {
                    Text("导出全部内容")
                }
            }

            Spacer(Modifier.height(12.dp))

            Button(onClick = { vm.logout(onLoggedOut) }, modifier = Modifier.fillMaxWidth()) {
                Text("退出登录")
            }
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(text = value, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ChangeAccountDialog(
    initialUsername: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
) {
    var username by mutableStateOf(initialUsername)
    var currentPassword by mutableStateOf("")
    var newPassword by mutableStateOf("")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("修改账号") },
        text = {
            Column {
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text("用户名") },
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    label = { Text("当前密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = newPassword,
                    onValueChange = { newPassword = it },
                    label = { Text("新密码（留空则不变）") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(currentPassword, newPassword, username) },
                enabled = username.isNotBlank() && currentPassword.isNotBlank(),
            ) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

private val TIME_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault())

private fun formatTime(millis: Long?): String {
    if (millis == null || millis <= 0) return "-"
    return TIME_FORMAT.format(Instant.ofEpochMilli(millis))
}
