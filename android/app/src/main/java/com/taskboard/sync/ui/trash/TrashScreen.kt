package com.taskboard.sync.ui.trash

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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.remote.dto.TrashItemDto
import com.taskboard.sync.data.repository.TrashRepository
import com.taskboard.sync.di.AppContainer
import com.taskboard.sync.ui.common.AppViewModelFactory
import kotlinx.coroutines.launch

class TrashViewModel(
    private val trashRepository: TrashRepository,
) : ViewModel() {

    var items by mutableStateOf<List<TrashItemDto>>(emptyList())
        private set
    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var sessionExpired by mutableStateOf(false)
        private set

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            loading = true
            error = null
            try {
                items = trashRepository.list()
            } catch (e: ApiException) {
                handle(e)
            } finally {
                loading = false
            }
        }
    }

    fun restore(batch: String) {
        viewModelScope.launch {
            try {
                trashRepository.restore(batch)
                load()
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun purge(batch: String) {
        viewModelScope.launch {
            try {
                trashRepository.purge(batch)
                load()
            } catch (e: ApiException) {
                handle(e)
            }
        }
    }

    fun empty() {
        viewModelScope.launch {
            try {
                trashRepository.empty()
                load()
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
fun TrashScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onSessionExpired: () -> Unit,
) {
    val vm: TrashViewModel = viewModel(factory = AppViewModelFactory(container))

    LaunchedEffect(vm.sessionExpired) {
        if (vm.sessionExpired) onSessionExpired()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("回收站") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { vm.empty() }) {
                        Icon(Icons.Filled.DeleteSweep, contentDescription = "清空回收站")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            vm.error?.let {
                Text(
                    text = it,
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            when {
                vm.loading && vm.items.isEmpty() -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                vm.items.isEmpty() -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { Text("回收站为空", color = MaterialTheme.colorScheme.onSurfaceVariant) }

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(vm.items, key = { it.batch }) { item ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(item.title, style = MaterialTheme.typography.titleSmall)
                                if (item.parent.isNotBlank()) {
                                    Text(
                                        item.parent,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    text = "类型 ${item.type} · 剩余 ${item.daysLeft} 天 · 节点 ${item.nodes} · 附件 ${item.attachments}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Spacer(Modifier.height(4.dp))
                                Row {
                                    TextButton(onClick = { vm.restore(item.batch) }) { Text("恢复") }
                                    TextButton(onClick = { vm.purge(item.batch) }) { Text("彻底删除") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
