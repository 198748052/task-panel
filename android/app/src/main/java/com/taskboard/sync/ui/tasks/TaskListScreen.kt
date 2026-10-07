package com.taskboard.sync.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.taskboard.sync.data.local.TaskWithNodes
import com.taskboard.sync.data.local.entity.SyncMetaEntity
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.repository.TaskRepository
import com.taskboard.sync.data.sync.SyncScheduler
import com.taskboard.sync.di.AppContainer
import com.taskboard.sync.ui.common.AppViewModelFactory
import kotlinx.coroutines.launch

class TaskListViewModel(
    private val taskRepository: TaskRepository,
    private val syncScheduler: SyncScheduler,
) : ViewModel() {

    var tasks by mutableStateOf<List<TaskWithNodes>>(emptyList())
        private set
    var meta by mutableStateOf<SyncMetaEntity?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    var offline by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var sessionExpired by mutableStateOf(false)
        private set

    init {
        viewModelScope.launch { taskRepository.tasks.collect { tasks = it } }
        viewModelScope.launch { taskRepository.meta.collect { meta = it } }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            loading = true
            error = null
            offline = false
            try {
                taskRepository.refresh()
                syncScheduler.enqueue()
            } catch (e: ApiException) {
                when (e.kind) {
                    ApiErrorKind.UNAUTHORIZED -> sessionExpired = true
                    ApiErrorKind.NETWORK -> offline = true
                    else -> error = e.message
                }
            } finally {
                loading = false
            }
        }
    }

    fun createTask(title: String, description: String, color: String, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                taskRepository.createTask(title, description, color)
                onDone()
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun deleteTask(localId: String) {
        viewModelScope.launch {
            try {
                taskRepository.deleteTask(localId)
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    private fun handle(e: ApiException) {
        if (e.kind == ApiErrorKind.UNAUTHORIZED) sessionExpired = true else error = e.message
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskListScreen(
    container: AppContainer,
    onOpenTask: (String) -> Unit,
    onOpenTrash: () -> Unit,
    onOpenSettings: () -> Unit,
    onSessionExpired: () -> Unit,
) {
    val vm: TaskListViewModel = viewModel(factory = AppViewModelFactory(container))
    var showCreate by mutableStateOf(false)

    androidx.compose.runtime.LaunchedEffect(vm.sessionExpired) {
        if (vm.sessionExpired) onSessionExpired()
    }

    if (showCreate) {
        CreateTaskDialog(
            onDismiss = { showCreate = false },
            onConfirm = { title, description, color ->
                vm.createTask(title, description, color) { showCreate = false }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("任务") },
                actions = {
                    IconButton(onClick = { onOpenTrash() }) { Text("回收站") }
                    IconButton(onClick = { onOpenSettings() }) {
                        Icon(Icons.Filled.Settings, contentDescription = "设置")
                    }
                    IconButton(onClick = { vm.refresh() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "刷新")
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showCreate = true }) {
                Icon(Icons.Filled.Add, contentDescription = "新建任务")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (vm.offline) {
                Banner("离线模式，展示本地缓存")
            }
            val error = vm.error
            if (error != null) {
                Banner(error)
            }
            if (vm.loading && vm.tasks.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (vm.tasks.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("暂无任务", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(vm.tasks, key = { it.task.localId }) { item ->
                        TaskCard(
                            item = item,
                            onClick = { onOpenTask(item.task.localId) },
                            onDelete = { vm.deleteTask(item.task.localId) },
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskCard(item: TaskWithNodes, onClick: () -> Unit, onDelete: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = item.task.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (item.task.archived) {
                        Spacer(Modifier.height(0.dp))
                        Text(
                            text = "  已归档",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (item.task.dirty) {
                        Text(
                            text = "  待同步",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
                if (item.task.description.isNotBlank()) {
                    Text(
                        text = item.task.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    text = "节点 ${item.nodes.size}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, contentDescription = "删除")
            }
        }
    }
}

@Composable
private fun Banner(text: String) {
    androidx.compose.material3.Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun CreateTaskDialog(
    onDismiss: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
) {
    var title by mutableStateOf("")
    var description by mutableStateOf("")

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建任务") },
        text = {
            Column {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("任务名称") },
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("描述") },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(title, description, "blue") },
                enabled = title.isNotBlank(),
            ) { Text("创建") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}
