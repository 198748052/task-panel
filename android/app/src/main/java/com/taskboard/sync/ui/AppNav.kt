package com.taskboard.sync.ui

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.taskboard.sync.di.AppContainer
import com.taskboard.sync.ui.detail.TaskDetailScreen
import com.taskboard.sync.ui.login.LoginScreen
import com.taskboard.sync.ui.settings.SettingsScreen
import com.taskboard.sync.ui.tasks.TaskListScreen
import com.taskboard.sync.ui.trash.TrashScreen

object Routes {
    const val LOGIN = "login"
    const val TASKS = "tasks"
    const val TRASH = "trash"
    const val SETTINGS = "settings"
    const val TASK_DETAIL = "detail/{taskLocalId}"

    fun taskDetail(localId: String) = "detail/$localId"
}

@Composable
fun AppNavHost(container: AppContainer) {
    val navController = rememberNavController()
    val start = if (container.sessionRepository.hasSession && container.sessionRepository.hasBaseUrl) {
        Routes.TASKS
    } else {
        Routes.LOGIN
    }

    NavHost(navController = navController, startDestination = start) {
        composable(Routes.LOGIN) {
            LoginScreen(
                container = container,
                onLoggedIn = {
                    navController.navigate(Routes.TASKS) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                },
            )
        }

        composable(Routes.TASKS) {
            TaskListScreen(
                container = container,
                onOpenTask = { navController.navigate(Routes.taskDetail(it)) },
                onOpenTrash = { navController.navigate(Routes.TRASH) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                onSessionExpired = { navController.toLogin() },
            )
        }

        composable(
            route = Routes.TASK_DETAIL,
            arguments = listOf(navArgument("taskLocalId") { type = NavType.StringType }),
        ) { entry ->
            val taskLocalId = entry.arguments?.getString("taskLocalId").orEmpty()
            TaskDetailScreen(
                container = container,
                taskLocalId = taskLocalId,
                onBack = { navController.popBackStack() },
                onSessionExpired = { navController.toLogin() },
            )
        }

        composable(Routes.TRASH) {
            TrashScreen(
                container = container,
                onBack = { navController.popBackStack() },
                onSessionExpired = { navController.toLogin() },
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(
                container = container,
                onBack = { navController.popBackStack() },
                onLoggedOut = { navController.toLogin() },
                onSessionExpired = { navController.toLogin() },
            )
        }
    }
}

private fun androidx.navigation.NavHostController.toLogin() {
    navigate(Routes.LOGIN) {
        popUpTo(graph.id) { inclusive = true }
        launchSingleTop = true
    }
}
