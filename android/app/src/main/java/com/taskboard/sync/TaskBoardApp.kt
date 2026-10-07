package com.taskboard.sync

import android.app.Application
import com.taskboard.sync.di.AppContainer

class TaskBoardApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
