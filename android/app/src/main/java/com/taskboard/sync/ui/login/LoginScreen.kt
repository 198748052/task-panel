package com.taskboard.sync.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.repository.SessionRepository
import com.taskboard.sync.data.repository.TaskRepository
import com.taskboard.sync.data.sync.SyncScheduler
import com.taskboard.sync.di.AppContainer
import com.taskboard.sync.ui.common.AppViewModelFactory
import com.taskboard.sync.util.FileUtil
import kotlinx.coroutines.launch

class LoginViewModel(
    private val sessionRepository: SessionRepository,
    private val taskRepository: TaskRepository,
    private val syncScheduler: SyncScheduler,
) : ViewModel() {

    var baseUrl by mutableStateOf(sessionRepository.baseUrl)
    var username by mutableStateOf("")
    var password by mutableStateOf("")
    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    val showCleartextWarning: Boolean
        get() = FileUtil.isCleartext(baseUrl)

    fun login(onSuccess: () -> Unit) {
        if (loading) return
        viewModelScope.launch {
            loading = true
            error = null
            try {
                sessionRepository.login(baseUrl, username, password)
                runCatching { sessionRepository.refreshServerInfo() }
                runCatching { taskRepository.refresh() }
                syncScheduler.enqueue()
                onSuccess()
            } catch (e: ApiException) {
                error = e.message ?: "登录失败"
            } catch (e: Exception) {
                error = e.message ?: "登录失败"
            } finally {
                loading = false
            }
        }
    }
}

@Composable
fun LoginScreen(container: AppContainer, onLoggedIn: () -> Unit) {
    val vm: LoginViewModel = viewModel(factory = AppViewModelFactory(container))

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "任务面板",
                style = MaterialTheme.typography.headlineMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "连接到你的自建服务",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))

            OutlinedTextField(
                value = vm.baseUrl,
                onValueChange = { vm.baseUrl = it },
                label = { Text("服务地址") },
                placeholder = { Text("https://tasks.example.com") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            if (vm.showCleartextWarning) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "当前地址使用明文 HTTP，建议改用 HTTPS",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = vm.username,
                onValueChange = { vm.username = it },
                label = { Text("用户名") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = vm.password,
                onValueChange = { vm.password = it },
                label = { Text("密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )

            val error = vm.error
            if (error != null) {
                Spacer(Modifier.height(12.dp))
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { vm.login(onLoggedIn) },
                enabled = !vm.loading,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (vm.loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.height(20.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("登录")
                }
            }
        }
    }
}
