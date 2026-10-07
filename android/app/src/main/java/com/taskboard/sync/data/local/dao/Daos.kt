package com.taskboard.sync.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.taskboard.sync.data.local.NodeWithAttachments
import com.taskboard.sync.data.local.TaskWithNodes
import com.taskboard.sync.data.local.entity.AttachmentEntity
import com.taskboard.sync.data.local.entity.NodeEntity
import com.taskboard.sync.data.local.entity.PendingChangeEntity
import com.taskboard.sync.data.local.entity.SyncMetaEntity
import com.taskboard.sync.data.local.entity.TaskEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskDao {

    @Transaction
    @Query("SELECT * FROM tasks ORDER BY archived ASC, sortOrder ASC, localId ASC")
    fun observeTasksWithNodes(): Flow<List<TaskWithNodes>>

    @Query("SELECT * FROM tasks WHERE localId = :localId LIMIT 1")
    suspend fun getByLocalId(localId: String): TaskEntity?

    @Query("SELECT * FROM tasks WHERE remoteId = :remoteId LIMIT 1")
    suspend fun getByRemoteId(remoteId: Long): TaskEntity?

    @Query("SELECT * FROM tasks")
    suspend fun getAll(): List<TaskEntity>

    @Query("SELECT COALESCE(MAX(sortOrder), 0.0) FROM tasks")
    suspend fun maxSortOrder(): Double

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(task: TaskEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(tasks: List<TaskEntity>)

    @Query("UPDATE tasks SET remoteId = :remoteId, updatedAt = :updatedAt, dirty = 0 WHERE localId = :localId")
    suspend fun bindRemoteId(localId: String, remoteId: Long, updatedAt: String?)

    @Query("UPDATE tasks SET sortOrder = :sortOrder WHERE localId = :localId")
    suspend fun updateSortOrder(localId: String, sortOrder: Double)

    @Query("DELETE FROM tasks WHERE localId = :localId")
    suspend fun deleteByLocalId(localId: String)
}

@Dao
interface NodeDao {

    @Query("SELECT * FROM nodes WHERE localId = :localId LIMIT 1")
    suspend fun getByLocalId(localId: String): NodeEntity?

    @Query("SELECT * FROM nodes WHERE remoteId = :remoteId LIMIT 1")
    suspend fun getByRemoteId(remoteId: Long): NodeEntity?

    @Query("SELECT * FROM nodes WHERE taskLocalId = :taskLocalId ORDER BY sortOrder ASC, localId ASC")
    suspend fun getByTask(taskLocalId: String): List<NodeEntity>

    @Query("SELECT * FROM nodes")
    suspend fun getAll(): List<NodeEntity>

    @Query("SELECT COALESCE(MAX(sortOrder), 0.0) FROM nodes WHERE taskLocalId = :taskLocalId")
    suspend fun maxSortOrder(taskLocalId: String): Double

    @Query("SELECT COALESCE(MIN(sortOrder), 0.0) FROM nodes WHERE taskLocalId = :taskLocalId")
    suspend fun minSortOrder(taskLocalId: String): Double

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(node: NodeEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(nodes: List<NodeEntity>)

    @Query("UPDATE nodes SET remoteId = :remoteId, updatedAt = :updatedAt, dirty = 0 WHERE localId = :localId")
    suspend fun bindRemoteId(localId: String, remoteId: Long, updatedAt: String?)

    @Query("UPDATE nodes SET sortOrder = :sortOrder WHERE localId = :localId")
    suspend fun updateSortOrder(localId: String, sortOrder: Double)

    @Query("DELETE FROM nodes WHERE localId = :localId")
    suspend fun deleteByLocalId(localId: String)
}

@Dao
interface AttachmentDao {

    @Query("SELECT * FROM attachments WHERE localId = :localId LIMIT 1")
    suspend fun getByLocalId(localId: String): AttachmentEntity?

    @Query("SELECT * FROM attachments WHERE remoteId = :remoteId LIMIT 1")
    suspend fun getByRemoteId(remoteId: Long): AttachmentEntity?

    @Query("SELECT * FROM attachments")
    suspend fun getAll(): List<AttachmentEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: AttachmentEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<AttachmentEntity>)

    @Query("DELETE FROM attachments WHERE localId = :localId")
    suspend fun deleteByLocalId(localId: String)

    @Query("DELETE FROM attachments WHERE nodeLocalId = :nodeLocalId")
    suspend fun deleteByNode(nodeLocalId: String)
}

@Dao
interface PendingChangeDao {

    @Query("SELECT * FROM pending_changes ORDER BY id ASC")
    suspend fun listOrdered(): List<PendingChangeEntity>

    @Query("SELECT COUNT(*) FROM pending_changes")
    suspend fun count(): Int

    @Insert
    suspend fun insert(change: PendingChangeEntity): Long

    @Query("DELETE FROM pending_changes WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM pending_changes WHERE targetLocalId = :localId")
    suspend fun deleteByTarget(localId: String)

    @Query("DELETE FROM pending_changes WHERE targetLocalId = :localId OR parentLocalId = :localId")
    suspend fun deleteForEntity(localId: String)
}

@Dao
interface SyncMetaDao {

    @Query("SELECT * FROM sync_meta WHERE id = 1")
    fun observe(): Flow<SyncMetaEntity?>

    @Query("SELECT * FROM sync_meta WHERE id = 1")
    suspend fun get(): SyncMetaEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(meta: SyncMetaEntity)
}
