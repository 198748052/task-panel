package com.taskboard.sync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.taskboard.sync.ui.AppNavHost
import com.taskboard.sync.ui.theme.TaskBoardTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as TaskBoardApp).container
        setContent {
            TaskBoardTheme {
                AppNavHost(container)
            }
        }
    }
}
