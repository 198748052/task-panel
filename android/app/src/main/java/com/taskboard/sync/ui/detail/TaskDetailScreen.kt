package com.taskboard.sync.ui.detail

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.taskboard.sync.data.local.NodeWithAttachments
import com.taskboard.sync.data.local.TaskWithNodes
import com.taskboard.sync.data.local.entity.AttachmentEntity
import com.taskboard.sync.data.local.entity.NodeEntity
import com.taskboard.sync.data.local.entity.SyncMetaEntity
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.repository.AttachmentRepository
import com.taskboard.sync.data.repository.TaskRepository
import com.taskboard.sync.data.sync.SyncScheduler
import com.taskboard.sync.di.AppContainer
import com.taskboard.sync.util.FileUtil
import com.taskboard.sync.util.TimeFormat
import kotlinx.coroutines.launch

class TaskDetailViewModel(
    private val taskLocalId: String,
    private val appContext: Context,
    private val taskRepository: TaskRepository,
    private val attachmentRepository: AttachmentRepository,
    private val syncScheduler: SyncScheduler,
) : ViewModel() {

    var task by mutableStateOf<TaskWithNodes?>(null)
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
    var uploading by mutableStateOf(false)
        private set
    var uploadProgress by mutableStateOf(0f)
        private set

    init {
        viewModelScope.launch {
            taskRepository.tasks.collect { list ->
                task = list.firstOrNull { it.task.localId == taskLocalId }
            }
        }
        viewModelScope.launch { taskRepository.meta.collect { meta = it } }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            loading = true
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

    fun addNode(title: String, content: String, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                taskRepository.createNode(taskLocalId, title, content)
                onDone()
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun updateNode(localId: String, title: String? = null, content: String? = null, done: Boolean? = null) {
        viewModelScope.launch {
            try {
                taskRepository.updateNode(localId, title, content, done)
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun deleteNode(localId: String) {
        viewModelScope.launch {
            try {
                taskRepository.deleteNode(localId)
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun setArchived(archived: Boolean) {
        val current = task ?: return
        viewModelScope.launch {
            try {
                taskRepository.updateTask(current.task.localId, archived = archived)
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun deleteTask(onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                taskRepository.deleteTask(taskLocalId)
                onDone()
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun upload(nodeLocalId: String, storage: String, uri: Uri) {
        viewModelScope.launch {
            try {
                val size = FileUtil.querySize(appContext, uri)
                val limitMb = if (storage == "r2") {
                    meta?.maxR2UploadMb ?: 0
                } else {
                    meta?.maxUploadMb ?: 0
                }
                if (limitMb > 0 && size > limitMb.toLong() * 1024 * 1024) {
                    error = "文件超过 ${limitMb}MB 限制"
                    return@launch
                }
                uploading = true
                uploadProgress = 0f
                attachmentRepository.upload(
                    nodeLocalId = nodeLocalId,
                    storage = storage,
                    uri = uri,
                    fileName = FileUtil.queryDisplayName(appContext, uri),
                    mimeType = FileUtil.queryMimeType(appContext, uri),
                    onProgress = { uploadProgress = it.coerceIn(0f, 1f) },
                )
            } catch (e: ApiException) {
                handle(e)
            } finally {
                uploading = false
                uploadProgress = 0f
            }
        }
    }

    fun download(attachment: AttachmentEntity) {
        viewModelScope.launch {
            try {
                val file = attachmentRepository.download(attachment)
                FileUtil.shareFile(appContext, file, attachment.mimeType)
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun renameAttachment(localId: String, newName: String) {
        viewModelScope.launch {
            try {
                attachmentRepository.rename(localId, newName)
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun deleteAttachment(localId: String) {
        viewModelScope.launch {
            try {
                attachmentRepository.delete(localId)
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
fun TaskDetailScreen(
    container: AppContainer,
    taskLocalId: String,
    onBack: () -> Unit,
    onSessionExpired: () -> Unit,
) {
    val vm: TaskDetailViewModel = viewModel(
        key = taskLocalId,
        factory = object : androidx.lifecycle.ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                TaskDetailViewModel(
                    taskLocalId = taskLocalId,
                    appContext = container.appContext,
                    taskRepository = container.taskRepository,
                    attachmentRepository = container.attachmentRepository,
                    syncScheduler = container.syncScheduler,
                ) as T
        },
    )

    LaunchedEffect(vm.sessionExpired) {
        if (vm.sessionExpired) onSessionExpired()
    }

    var showAddNode by remember { mutableStateOf(false) }
    var editingNode by remember { mutableStateOf<NodeEntity?>(null) }
    var editingAttachment by remember { mutableStateOf<AttachmentEntity?>(null) }
    var pendingUpload by remember { mutableStateOf<Pair<String, Uri>?>(null) }
    var showStorageChoice by remember { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        val nodeLocalId = pendingUpload?.first
        if (uri != null && nodeLocalId != null) {
            if (vm.meta?.r2Enabled == true) {
                pendingUpload = nodeLocalId to uri
                showStorageChoice = true
            } else {
                vm.upload(nodeLocalId, "local", uri)
                pendingUpload = null
            }
        } else {
            pendingUpload = null
        }
    }

    if (showAddNode) {
        NodeEditDialog(
            initialTitle = "",
            initialContent = "",
            onDismiss = { showAddNode = false },
            onConfirm = { title, content ->
                vm.addNode(title, content) { showAddNode = false }
            },
        )
    }

    editingNode?.let { node ->
        NodeEditDialog(
            initialTitle = node.title,
            initialContent = node.content,
            onDismiss = { editingNode = null },
            onConfirm = { title, content ->
                vm.updateNode(node.localId, title = title, content = content)
                editingNode = null
            },
            onDelete = {
                vm.deleteNode(node.localId)
                editingNode = null
            },
        )
    }

    editingAttachment?.let { attachment ->
        RenameDialog(
            initial = attachment.originalName,
            onDismiss = { editingAttachment = null },
            onConfirm = { name ->
                vm.renameAttachment(attachment.localId, name)
                editingAttachment = null
            },
        )
    }

    val currentTask = vm.task

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text(currentTask?.task?.title ?: "任务") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    if (currentTask != null) {
                        IconButton(onClick = { vm.deleteTask(onBack) }) {
                            Icon(Icons.Filled.Delete, contentDescription = "删除任务")
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showAddNode = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(Icons.Filled.Add, contentDescription = "新建节点")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (vm.offline) {
                Text(
                    text = "离线模式，展示本地缓存",
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            vm.error?.let { message ->
                Text(
                    text = message,
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (vm.uploading) {
                UploadProgressBanner(progress = vm.uploadProgress)
            }
            if (currentTask == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                val sortedNodes = remember(currentTask.nodes) {
                    currentTask.nodes.sortedWith(
                        compareByDescending<NodeWithAttachments> { it.node.createdAt ?: "" }
                            .thenByDescending { it.node.sortOrder },
                    )
                }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                if (currentTask.task.description.isNotBlank()) {
                                    Text(
                                        text = currentTask.task.description,
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                }
                                Spacer(Modifier.height(8.dp))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("归档", style = MaterialTheme.typography.bodyMedium)
                                    Spacer(Modifier.height(0.dp))
                                    Switch(
                                        checked = currentTask.task.archived,
                                        onCheckedChange = { vm.setArchived(it) },
                                    )
                                }
                            }
                        }
                    }
                    items(sortedNodes, key = { it.node.localId }) { nodeWithAttachments ->
                        val node = nodeWithAttachments.node
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = node.title,
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.weight(1f),
                                    )
                                    IconButton(onClick = { editingNode = node }) {
                                        Icon(Icons.Filled.Edit, contentDescription = "编辑")
                                    }
                                    IconButton(
                                        onClick = {
                                            pendingUpload = node.localId to Uri.EMPTY
                                            picker.launch(arrayOf("*/*"))
                                        },
                                    ) {
                                        Icon(Icons.Filled.Upload, contentDescription = "上传附件")
                                    }
                                }
                                if (node.content.isNotBlank()) {
                                    Text(
                                        text = node.content,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                val timeMeta = listOfNotNull(
                                    TimeFormat.dateTime(node.createdAt)
                                        .takeIf { it.isNotBlank() }
                                        ?.let { "创建 $it" },
                                    TimeFormat.dateTime(node.updatedAt)
                                        .takeIf { it.isNotBlank() }
                                        ?.let { "编辑 $it" },
                                ).joinToString("  ·  ")
                                if (timeMeta.isNotBlank()) {
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        text = timeMeta,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                if (nodeWithAttachments.attachments.isNotEmpty()) {
                                    Spacer(Modifier.height(8.dp))
                                    Text(
                                        text = "附件（${nodeWithAttachments.attachments.size}）",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    nodeWithAttachments.attachments.forEach { attachment ->
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .clip(RoundedCornerShape(8.dp))
                                                .clickable { vm.download(attachment) }
                                                .padding(horizontal = 4.dp, vertical = 6.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Icon(
                                                imageVector = Icons.Filled.AttachFile,
                                                contentDescription = null,
                                                tint = MaterialTheme.colorScheme.primary,
                                                modifier = Modifier.size(16.dp),
                                            )
                                            Spacer(Modifier.width(8.dp))
                                            Text(
                                                text = attachment.originalName,
                                                style = MaterialTheme.typography.bodySmall,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.weight(1f),
                                            )
                                            Text(
                                                text = FileUtil.humanSize(attachment.size),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                            IconButton(onClick = { vm.download(attachment) }) {
                                                Icon(Icons.Filled.Download, contentDescription = "下载")
                                            }
                                            IconButton(onClick = { editingAttachment = attachment }) {
                                                Icon(Icons.Filled.Edit, contentDescription = "重命名")
                                            }
                                            IconButton(onClick = { vm.deleteAttachment(attachment.localId) }) {
                                                Icon(Icons.Filled.Delete, contentDescription = "删除附件")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showStorageChoice) {
        AlertDialog(
            onDismissRequest = {
                showStorageChoice = false
                pendingUpload = null
            },
            title = { Text("选择存储位置") },
            text = { Text("附件将上传到所选位置") },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingUpload?.let { (nodeLocalId, uri) ->
                            if (uri != Uri.EMPTY) vm.upload(nodeLocalId, "r2", uri)
                        }
                        showStorageChoice = false
                        pendingUpload = null
                    },
                ) { Text("Cloudflare R2") }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        pendingUpload?.let { (nodeLocalId, uri) ->
                            if (uri != Uri.EMPTY) vm.upload(nodeLocalId, "local", uri)
                        }
                        showStorageChoice = false
                        pendingUpload = null
                    },
                ) { Text("本地存储") }
            },
        )
    }
}

@Composable
private fun NodeEditDialog(
    initialTitle: String,
    initialContent: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var title by remember(initialTitle, initialContent) { mutableStateOf(initialTitle) }
    var content by remember(initialTitle, initialContent) { mutableStateOf(initialContent) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initialTitle.isBlank()) "新建节点" else "编辑节点") },
        text = {
            Column {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("节点名称") },
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = content,
                    onValueChange = { content = it },
                    label = { Text("节点内容") },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(title, content) },
                enabled = title.isNotBlank(),
            ) { Text("保存") }
        },
        dismissButton = {
            Row {
                if (onDelete != null) {
                    TextButton(onClick = onDelete) { Text("删除") }
                }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

@Composable
private fun RenameDialog(
    initial: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var name by remember(initial) { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("重命名附件") },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("文件名") },
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name) },
                enabled = name.isNotBlank(),
            ) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

@Composable
private fun UploadProgressBanner(progress: Float) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "正在上传附件",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "${(progress * 100).toInt()}%",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress.coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
