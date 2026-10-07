package com.taskboard.sync.ui.tasks

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import com.taskboard.sync.ui.theme.TaskColorOptions
import com.taskboard.sync.ui.theme.taskAccent
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
    var showCreate by remember { mutableStateOf(false) }

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
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("任务") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
                actions = {
                    IconButton(onClick = { onOpenTrash() }) {
                        Icon(Icons.Filled.DeleteOutline, contentDescription = "回收站")
                    }
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
            FloatingActionButton(
                onClick = { showCreate = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
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
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
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
    val accent = taskAccent(item.task.color)
    val attachmentCount = item.nodes.sumOf { it.attachments.size }

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            Box(
                modifier = Modifier
                    .width(5.dp)
                    .fillMaxHeight()
                    .background(accent),
            )
            Column(modifier = Modifier.weight(1f).padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = item.task.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (item.task.archived) {
                        Spacer(Modifier.width(8.dp))
                        StatusBadge(
                            text = "已归档",
                            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            containerColor = MaterialTheme.colorScheme.surfaceVariant,
                        )
                    }
                    if (item.task.dirty) {
                        Spacer(Modifier.width(8.dp))
                        StatusBadge(
                            text = "待同步",
                            contentColor = accent,
                            containerColor = accent.copy(alpha = 0.12f),
                        )
                    }
                }
                if (item.task.description.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = item.task.description,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MetaItem(Icons.Filled.Layers, "${item.nodes.size} 个节点")
                    Spacer(Modifier.width(16.dp))
                    MetaItem(Icons.Filled.AttachFile, "$attachmentCount 个附件")
                }
            }
            IconButton(onClick = onDelete, modifier = Modifier.align(Alignment.Top)) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = "删除",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun StatusBadge(text: String, contentColor: Color, containerColor: Color) {
    Surface(color = containerColor, shape = RoundedCornerShape(6.dp)) {
        Text(
            text = text,
            color = contentColor,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun MetaItem(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Banner(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onTertiaryContainer,
        )
    }
}

@Composable
private fun CreateTaskDialog(
    onDismiss: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("blue") }

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
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "颜色",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TaskColorOptions.forEach { option ->
                        ColorDot(
                            color = taskAccent(option),
                            selected = option == color,
                            onClick = { color = option },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(title, description, color) },
                enabled = title.isNotBlank(),
            ) { Text("创建") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

@Composable
private fun ColorDot(color: Color, selected: Boolean, onClick: () -> Unit) {
    Surface(
        color = color,
        shape = RoundedCornerShape(50),
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.onSurface) else null,
        modifier = Modifier
            .size(24.dp)
            .clickable(onClick = onClick),
    ) {}
}
