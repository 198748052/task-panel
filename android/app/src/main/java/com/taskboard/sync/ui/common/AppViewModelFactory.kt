package com.taskboard.sync.ui.common

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.taskboard.sync.di.AppContainer
import com.taskboard.sync.ui.login.LoginViewModel
import com.taskboard.sync.ui.settings.SettingsViewModel
import com.taskboard.sync.ui.tasks.TaskListViewModel
import com.taskboard.sync.ui.trash.TrashViewModel

class AppViewModelFactory(
    private val container: AppContainer,
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val viewModel: ViewModel = when {
            modelClass.isAssignableFrom(LoginViewModel::class.java) ->
                LoginViewModel(
                    container.sessionRepository,
                    container.taskRepository,
                    container.syncScheduler,
                )

            modelClass.isAssignableFrom(TaskListViewModel::class.java) ->
                TaskListViewModel(
                    container.taskRepository,
                    container.syncScheduler,
                )

            modelClass.isAssignableFrom(TrashViewModel::class.java) ->
                TrashViewModel(container.trashRepository)

            modelClass.isAssignableFrom(SettingsViewModel::class.java) ->
                SettingsViewModel(
                    container.sessionRepository,
                    container.taskRepository,
                    container.exportRepository,
                    container.syncScheduler,
                )

            else -> throw IllegalArgumentException("未知的 ViewModel: ${modelClass.name}")
        }
        return viewModel as T
    }
}
