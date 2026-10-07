package com.taskboard.sync.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.taskboard.sync.TaskBoardApp
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException

class SyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as TaskBoardApp).container
        return try {
            container.taskRepository.refresh()
            Result.success()
        } catch (e: ApiException) {
            if (e.kind == ApiErrorKind.NETWORK) Result.retry() else Result.failure()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
