package com.taskboard.sync.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

object PendingChangeType {
    const val CREATE_TASK = "CREATE_TASK"
    const val UPDATE_TASK = "UPDATE_TASK"
    const val DELETE_TASK = "DELETE_TASK"
    const val REORDER_TASKS = "REORDER_TASKS"
    const val CREATE_NODE = "CREATE_NODE"
    const val UPDATE_NODE = "UPDATE_NODE"
    const val DELETE_NODE = "DELETE_NODE"
    const val REORDER_NODES = "REORDER_NODES"
}

@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val localId: String,
    val remoteId: Long? = null,
    val title: String,
    val description: String = "",
    val color: String = "blue",
    val archived: Boolean = false,
    val sortOrder: Double = 0.0,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val dirty: Boolean = false,
)

@Entity(
    tableName = "nodes",
    foreignKeys = [
        ForeignKey(
            entity = TaskEntity::class,
            parentColumns = ["localId"],
            childColumns = ["taskLocalId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("taskLocalId"), Index("remoteId")],
)
data class NodeEntity(
    @PrimaryKey val localId: String,
    val remoteId: Long? = null,
    val taskLocalId: String,
    val title: String,
    val content: String = "",
    val done: Boolean = false,
    val sortOrder: Double = 0.0,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val dirty: Boolean = false,
)

@Entity(
    tableName = "attachments",
    foreignKeys = [
        ForeignKey(
            entity = NodeEntity::class,
            parentColumns = ["localId"],
            childColumns = ["nodeLocalId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("nodeLocalId"), Index("remoteId")],
)
data class AttachmentEntity(
    @PrimaryKey val localId: String,
    val remoteId: Long,
    val nodeLocalId: String,
    val originalName: String,
    val mimeType: String = "",
    val size: Long = 0,
    val storage: String = "local",
    val remoteUrl: String? = null,
    val localPath: String? = null,
    val createdAt: String? = null,
)

@Entity(tableName = "pending_changes")
data class PendingChangeEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val type: String,
    val targetLocalId: String,
    val parentLocalId: String? = null,
    val payload: String,
    val createdAt: Long,
)

@Entity(tableName = "sync_meta")
data class SyncMetaEntity(
    @PrimaryKey val id: Int = 1,
    val lastSyncAt: Long? = null,
    val serverVersion: String = "",
    val serverBranch: String = "",
    val maxUploadMb: Int = 0,
    val maxR2UploadMb: Int = 0,
    val r2Enabled: Boolean = false,
    val retentionDays: Int = 30,
)
