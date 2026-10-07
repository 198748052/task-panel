package com.taskboard.sync.data.repository

import androidx.room.withTransaction
import com.taskboard.sync.data.local.AppDatabase
import com.taskboard.sync.data.local.TaskWithNodes
import com.taskboard.sync.data.local.entity.AttachmentEntity
import com.taskboard.sync.data.local.entity.NodeEntity
import com.taskboard.sync.data.local.entity.PendingChangeEntity
import com.taskboard.sync.data.local.entity.PendingChangeType
import com.taskboard.sync.data.local.entity.SyncMetaEntity
import com.taskboard.sync.data.local.entity.TaskEntity
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.remote.ApiHolder
import com.taskboard.sync.data.remote.TokenStore
import com.taskboard.sync.data.remote.dto.SyncResponse
import com.taskboard.sync.data.remote.safeApiCall
import com.taskboard.sync.data.sync.CreateNodePayload
import com.taskboard.sync.data.sync.CreateTaskPayload
import com.taskboard.sync.data.sync.DeletePayload
import com.taskboard.sync.data.sync.PendingChangeSyncer
import com.taskboard.sync.data.sync.ReorderPayload
import com.taskboard.sync.data.sync.UpdateNodePayload
import com.taskboard.sync.data.sync.UpdateTaskPayload
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID

class TaskRepository(
    private val db: AppDatabase,
    private val apiHolder: ApiHolder,
    private val tokenStore: TokenStore,
    private val json: Json,
    private val syncer: PendingChangeSyncer,
) {
    private val taskDao = db.taskDao()
    private val nodeDao = db.nodeDao()
    private val attachmentDao = db.attachmentDao()
    private val pendingDao = db.pendingChangeDao()
    private val metaDao = db.syncMetaDao()

    val tasks: Flow<List<TaskWithNodes>> = taskDao.observeTasksWithNodes()
    val meta: Flow<SyncMetaEntity?> = metaDao.observe()

    private fun api() = apiHolder.api(tokenStore.baseUrl)

    private fun nowIso(): String = Instant.now().toString()

    suspend fun refresh() {
        if (!syncer.flush()) {
            throw ApiException(ApiErrorKind.NETWORK, "网络不可用，已展示本地缓存")
        }
        val snapshot = safeApiCall { api().sync() }
        applySnapshot(snapshot)
        val existing = metaDao.get()
        metaDao.upsert(
            SyncMetaEntity(
                id = 1,
                lastSyncAt = System.currentTimeMillis(),
                serverVersion = existing?.serverVersion ?: "",
                serverBranch = existing?.serverBranch ?: "",
                maxUploadMb = snapshot.maxUploadMb,
                maxR2UploadMb = snapshot.maxR2UploadMb,
                r2Enabled = snapshot.r2Enabled,
                retentionDays = snapshot.retentionDays,
            ),
        )
    }

    /* ------------------------------ tasks ------------------------------ */

    suspend fun createTask(title: String, description: String, color: String) {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) throw ApiException(ApiErrorKind.UNKNOWN, "任务名称不能为空")
        val localId = UUID.randomUUID().toString()
        val order = taskDao.maxSortOrder() + 1.0
        db.withTransaction {
            taskDao.upsert(
                TaskEntity(
                    localId = localId,
                    remoteId = null,
                    title = trimmed,
                    description = description,
                    color = color,
                    archived = false,
                    sortOrder = order,
                    createdAt = nowIso(),
                    updatedAt = null,
                    dirty = true,
                ),
            )
            pendingDao.insert(
                PendingChangeEntity(
                    type = PendingChangeType.CREATE_TASK,
                    targetLocalId = localId,
                    payload = json.encodeToString(CreateTaskPayload(trimmed, description, color)),
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
        triggerSync()
    }

    suspend fun updateTask(
        localId: String,
        title: String? = null,
        description: String? = null,
        color: String? = null,
        archived: Boolean? = null,
    ) {
        val current = taskDao.getByLocalId(localId) ?: return
        val updated = current.copy(
            title = title?.trim() ?: current.title,
            description = description ?: current.description,
            color = color ?: current.color,
            archived = archived ?: current.archived,
            dirty = true,
        )
        db.withTransaction {
            taskDao.upsert(updated)
            pendingDao.insert(
                PendingChangeEntity(
                    type = PendingChangeType.UPDATE_TASK,
                    targetLocalId = localId,
                    payload = json.encodeToString(
                        UpdateTaskPayload(title?.trim(), description, color, archived),
                    ),
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
        triggerSync()
    }

    suspend fun deleteTask(localId: String) {
        val current = taskDao.getByLocalId(localId) ?: return
        db.withTransaction {
            pendingDao.deleteForEntity(localId)
            taskDao.deleteByLocalId(localId)
            val remoteId = current.remoteId
            if (remoteId != null) {
                pendingDao.insert(
                    PendingChangeEntity(
                        type = PendingChangeType.DELETE_TASK,
                        targetLocalId = localId,
                        payload = json.encodeToString(DeletePayload(remoteId)),
                        createdAt = System.currentTimeMillis(),
                    ),
                )
            }
        }
        triggerSync()
    }

    suspend fun reorderTasks(localIds: List<String>) {
        if (localIds.isEmpty()) return
        db.withTransaction {
            localIds.forEachIndexed { index, id -> taskDao.updateSortOrder(id, index + 1.0) }
            pendingDao.insert(
                PendingChangeEntity(
                    type = PendingChangeType.REORDER_TASKS,
                    targetLocalId = "",
                    payload = json.encodeToString(ReorderPayload(localIds)),
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
        triggerSync()
    }

    /* ------------------------------ nodes ------------------------------ */

    suspend fun createNode(taskLocalId: String, title: String, content: String) {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) throw ApiException(ApiErrorKind.UNKNOWN, "节点名称不能为空")
        if (taskDao.getByLocalId(taskLocalId) == null) return
        val localId = UUID.randomUUID().toString()
        val order = nodeDao.maxSortOrder(taskLocalId) + 1.0
        db.withTransaction {
            nodeDao.upsert(
                NodeEntity(
                    localId = localId,
                    remoteId = null,
                    taskLocalId = taskLocalId,
                    title = trimmed,
                    content = content,
                    done = false,
                    sortOrder = order,
                    createdAt = nowIso(),
                    updatedAt = null,
                    dirty = true,
                ),
            )
            pendingDao.insert(
                PendingChangeEntity(
                    type = PendingChangeType.CREATE_NODE,
                    targetLocalId = localId,
                    parentLocalId = taskLocalId,
                    payload = json.encodeToString(CreateNodePayload(taskLocalId, trimmed, content)),
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
        triggerSync()
    }

    suspend fun updateNode(
        localId: String,
        title: String? = null,
        content: String? = null,
        done: Boolean? = null,
    ) {
        val current = nodeDao.getByLocalId(localId) ?: return
        val updated = current.copy(
            title = title?.trim() ?: current.title,
            content = content ?: current.content,
            done = done ?: current.done,
            dirty = true,
        )
        db.withTransaction {
            nodeDao.upsert(updated)
            pendingDao.insert(
                PendingChangeEntity(
                    type = PendingChangeType.UPDATE_NODE,
                    targetLocalId = localId,
                    parentLocalId = current.taskLocalId,
                    payload = json.encodeToString(UpdateNodePayload(title?.trim(), content, done)),
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
        triggerSync()
    }

    suspend fun deleteNode(localId: String) {
        val current = nodeDao.getByLocalId(localId) ?: return
        db.withTransaction {
            pendingDao.deleteForEntity(localId)
            nodeDao.deleteByLocalId(localId)
            val remoteId = current.remoteId
            if (remoteId != null) {
                pendingDao.insert(
                    PendingChangeEntity(
                        type = PendingChangeType.DELETE_NODE,
                        targetLocalId = localId,
                        parentLocalId = current.taskLocalId,
                        payload = json.encodeToString(DeletePayload(remoteId)),
                        createdAt = System.currentTimeMillis(),
                    ),
                )
            }
        }
        triggerSync()
    }

    suspend fun reorderNodes(taskLocalId: String, localIds: List<String>) {
        if (localIds.isEmpty()) return
        db.withTransaction {
            localIds.forEachIndexed { index, id -> nodeDao.updateSortOrder(id, index + 1.0) }
            pendingDao.insert(
                PendingChangeEntity(
                    type = PendingChangeType.REORDER_NODES,
                    targetLocalId = "",
                    parentLocalId = taskLocalId,
                    payload = json.encodeToString(ReorderPayload(localIds)),
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
        triggerSync()
    }

    /* --------------------------- snapshot merge ------------------------ */

    private suspend fun applySnapshot(snapshot: SyncResponse) {
        db.withTransaction {
            val serverTaskIds = HashSet<Long>()
            val taskIdToLocal = HashMap<Long, String>()

            for (dto in snapshot.tasks) {
                serverTaskIds.add(dto.id)
                val existing = taskDao.getByRemoteId(dto.id)
                if (existing == null) {
                    val localId = UUID.randomUUID().toString()
                    taskDao.upsert(
                        TaskEntity(
                            localId = localId,
                            remoteId = dto.id,
                            title = dto.title,
                            description = dto.description,
                            color = dto.color,
                            archived = dto.archived,
                            sortOrder = dto.sortOrder,
                            createdAt = dto.createdAt,
                            updatedAt = dto.updatedAt,
                            dirty = false,
                        ),
                    )
                    taskIdToLocal[dto.id] = localId
                } else {
                    if (!existing.dirty) {
                        taskDao.upsert(
                            existing.copy(
                                title = dto.title,
                                description = dto.description,
                                color = dto.color,
                                archived = dto.archived,
                                sortOrder = dto.sortOrder,
                                createdAt = dto.createdAt ?: existing.createdAt,
                                updatedAt = dto.updatedAt ?: existing.updatedAt,
                            ),
                        )
                    }
                    taskIdToLocal[dto.id] = existing.localId
                }
            }

            for (local in taskDao.getAll()) {
                val remoteId = local.remoteId
                if (remoteId != null && !local.dirty && remoteId !in serverTaskIds) {
                    taskDao.deleteByLocalId(local.localId)
                }
            }

            val serverNodeIds = HashSet<Long>()
            val nodeIdToLocal = HashMap<Long, String>()

            for (dto in snapshot.tasks) {
                val parentLocalId = taskIdToLocal[dto.id] ?: continue
                for (node in dto.nodes) {
                    serverNodeIds.add(node.id)
                    val existing = nodeDao.getByRemoteId(node.id)
                    if (existing == null) {
                        val localId = UUID.randomUUID().toString()
                        nodeDao.upsert(
                            NodeEntity(
                                localId = localId,
                                remoteId = node.id,
                                taskLocalId = parentLocalId,
                                title = node.title,
                                content = node.content,
                                done = node.done,
                                sortOrder = node.sortOrder,
                                createdAt = node.createdAt,
                                updatedAt = node.updatedAt,
                                dirty = false,
                            ),
                        )
                        nodeIdToLocal[node.id] = localId
                    } else {
                        if (!existing.dirty) {
                            nodeDao.upsert(
                                existing.copy(
                                    taskLocalId = parentLocalId,
                                    title = node.title,
                                    content = node.content,
                                    done = node.done,
                                    sortOrder = node.sortOrder,
                                    createdAt = node.createdAt ?: existing.createdAt,
                                    updatedAt = node.updatedAt ?: existing.updatedAt,
                                ),
                            )
                        }
                        nodeIdToLocal[node.id] = existing.localId
                    }
                }
            }

            for (local in nodeDao.getAll()) {
                val remoteId = local.remoteId
                if (remoteId != null && !local.dirty && remoteId !in serverNodeIds) {
                    nodeDao.deleteByLocalId(local.localId)
                }
            }

            val serverAttachmentIds = HashSet<Long>()
            for (dto in snapshot.tasks) {
                for (node in dto.nodes) {
                    val nodeLocalId = nodeIdToLocal[node.id] ?: continue
                    for (att in node.attachments) {
                        serverAttachmentIds.add(att.id)
                        val existing = attachmentDao.getByRemoteId(att.id)
                        attachmentDao.upsert(
                            AttachmentEntity(
                                localId = existing?.localId ?: UUID.randomUUID().toString(),
                                remoteId = att.id,
                                nodeLocalId = nodeLocalId,
                                originalName = att.originalName,
                                mimeType = att.mimeType,
                                size = att.size,
                                storage = att.storage,
                                remoteUrl = att.url,
                                localPath = existing?.localPath,
                                createdAt = att.createdAt,
                            ),
                        )
                    }
                }
            }

            for (local in attachmentDao.getAll()) {
                if (local.remoteId !in serverAttachmentIds) {
                    attachmentDao.deleteByLocalId(local.localId)
                }
            }
        }
    }

    private suspend fun triggerSync() {
        try {
            syncer.flush()
        } catch (e: ApiException) {
            if (e.kind == ApiErrorKind.UNAUTHORIZED) throw e
        }
    }
}
