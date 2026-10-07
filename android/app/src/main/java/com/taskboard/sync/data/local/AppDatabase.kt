package com.taskboard.sync.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.taskboard.sync.data.local.dao.AttachmentDao
import com.taskboard.sync.data.local.dao.NodeDao
import com.taskboard.sync.data.local.dao.PendingChangeDao
import com.taskboard.sync.data.local.dao.SyncMetaDao
import com.taskboard.sync.data.local.dao.TaskDao
import com.taskboard.sync.data.local.entity.AttachmentEntity
import com.taskboard.sync.data.local.entity.NodeEntity
import com.taskboard.sync.data.local.entity.PendingChangeEntity
import com.taskboard.sync.data.local.entity.SyncMetaEntity
import com.taskboard.sync.data.local.entity.TaskEntity

@Database(
    entities = [
        TaskEntity::class,
        NodeEntity::class,
        AttachmentEntity::class,
        PendingChangeEntity::class,
        SyncMetaEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun taskDao(): TaskDao
    abstract fun nodeDao(): NodeDao
    abstract fun attachmentDao(): AttachmentDao
    abstract fun pendingChangeDao(): PendingChangeDao
    abstract fun syncMetaDao(): SyncMetaDao

    companion object {
        val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE INDEX IF NOT EXISTS index_tasks_remoteId ON tasks(remoteId)")
            }
        }
    }
}
