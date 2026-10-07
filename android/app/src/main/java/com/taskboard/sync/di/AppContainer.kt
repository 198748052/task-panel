package com.taskboard.sync.di

import android.content.Context
import androidx.room.Room
import com.taskboard.sync.BuildConfig
import com.taskboard.sync.data.local.AppDatabase
import com.taskboard.sync.data.remote.ApiHolder
import com.taskboard.sync.data.remote.AuthInterceptor
import com.taskboard.sync.data.remote.TokenStore
import com.taskboard.sync.data.repository.AttachmentRepository
import com.taskboard.sync.data.repository.ExportRepository
import com.taskboard.sync.data.repository.SessionRepository
import com.taskboard.sync.data.repository.TaskRepository
import com.taskboard.sync.data.repository.TrashRepository
import com.taskboard.sync.data.sync.PendingChangeSyncer
import com.taskboard.sync.data.sync.SyncScheduler
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit

/**
 * 轻量手写依赖容器，避免引入注解处理器带来的版本耦合。
 */
class AppContainer(context: Context) {

    val appContext: Context = context.applicationContext
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        isLenient = true
    }

    val tokenStore: TokenStore = TokenStore(appContext)

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor { tokenStore.token })
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(
                    HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BASIC
                    },
                )
            }
        }
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    val apiHolder: ApiHolder = ApiHolder(okHttpClient, json)

    val database: AppDatabase = Room.databaseBuilder(
        appContext,
        AppDatabase::class.java,
        "task-board.db",
    )
        .addMigrations(AppDatabase.MIGRATION_1_2)
        .fallbackToDestructiveMigration()
        .build()

    val syncScheduler: SyncScheduler = SyncScheduler(appContext)

    private val syncer = PendingChangeSyncer(database, apiHolder, tokenStore, json)

    val sessionRepository: SessionRepository = SessionRepository(database, apiHolder, tokenStore)

    val taskRepository: TaskRepository =
        TaskRepository(database, apiHolder, tokenStore, json, syncer, syncScheduler)

    val attachmentRepository: AttachmentRepository =
        AttachmentRepository(appContext, database, apiHolder, tokenStore)

    val trashRepository: TrashRepository = TrashRepository(apiHolder, tokenStore)

    val exportRepository: ExportRepository = ExportRepository(apiHolder, tokenStore)
}
