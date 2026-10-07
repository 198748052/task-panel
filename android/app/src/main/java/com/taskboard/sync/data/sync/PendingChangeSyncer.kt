package com.taskboard.sync.data.sync

import com.taskboard.sync.data.local.AppDatabase
import com.taskboard.sync.data.local.entity.PendingChangeEntity
import com.taskboard.sync.data.local.entity.PendingChangeType
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.remote.ApiHolder
import com.taskboard.sync.data.remote.TokenStore
import com.taskboard.sync.data.remote.dto.CreateNodeRequest
import com.taskboard.sync.data.remote.dto.CreateTaskRequest
import com.taskboard.sync.data.remote.dto.ReorderRequest
import com.taskboard.sync.data.remote.dto.UpdateNodeRequest
import com.taskboard.sync.data.remote.dto.UpdateTaskRequest
import com.taskboard.sync.data.remote.safeApiCall
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/**
 * 按入队顺序（FIFO）提交离线变更。
 *
 * payload 中保存的是本地 localId，提交时再解析成服务端 id，因此无需在创建后回写子实体引用。
 * 只要保证创建父实体（任务）的变更排在创建子实体（节点）之前，即可自然满足依赖。
 */
class PendingChangeSyncer(
    private val db: AppDatabase,
    private val apiHolder: ApiHolder,
    private val tokenStore: TokenStore,
    private val json: Json,
) {
    private val taskDao = db.taskDao()
    private val nodeDao = db.nodeDao()
    private val pendingDao = db.pendingChangeDao()

    private fun api() = apiHolder.api(tokenStore.baseUrl)

    /**
     * @return true 表示队列已清空；false 表示遇到网络问题或依赖未就绪而中断（稍后重试）。
     */
    suspend fun flush(): Boolean {
        val changes = pendingDao.listOrdered()
        for (change in changes) {
            val dropLocal = try {
                apply(change)
                false
            } catch (e: ApiException) {
                when (e.kind) {
                    ApiErrorKind.UNAUTHORIZED -> throw e
                    ApiErrorKind.NETWORK -> return false
                    ApiErrorKind.NOT_FOUND -> true
                    else -> return false
                }
            } catch (e: DependencyMissingException) {
                return false
            }
            if (dropLocal) dropLocalEntity(change)
            pendingDao.deleteById(change.id)
        }
        return true
    }

    private suspend fun apply(change: PendingChangeEntity) {
        when (change.type) {
            PendingChangeType.CREATE_TASK -> {
                val entity = taskDao.getByLocalId(change.targetLocalId) ?: return
                val payload = json.decodeFromString<CreateTaskPayload>(change.payload)
                val dto = safeApiCall {
                    api().createTask(CreateTaskRequest(payload.title, payload.description, payload.color))
                }.task
                taskDao.bindRemoteId(entity.localId, dto.id, dto.updatedAt)
            }

            PendingChangeType.UPDATE_TASK -> {
                val entity = taskDao.getByLocalId(change.targetLocalId) ?: return
                val remoteId = entity.remoteId ?: throw DependencyMissingException()
                val payload = json.decodeFromString<UpdateTaskPayload>(change.payload)
                val dto = safeApiCall {
                    api().updateTask(
                        remoteId,
                        UpdateTaskRequest(payload.title, payload.description, payload.color, payload.archived),
                    )
                }.task
                taskDao.upsert(entity.copy(updatedAt = dto.updatedAt ?: entity.updatedAt, dirty = false))
            }

            PendingChangeType.DELETE_TASK -> {
                val payload = json.decodeFromString<DeletePayload>(change.payload)
                val remoteId = payload.remoteId ?: return
                safeApiCall { api().deleteTask(remoteId) }
                taskDao.getByLocalId(change.targetLocalId)?.let { taskDao.deleteByLocalId(it.localId) }
            }

            PendingChangeType.REORDER_TASKS -> {
                val payload = json.decodeFromString<ReorderPayload>(change.payload)
                val remoteIds = payload.localIds.mapNotNull { taskDao.getByLocalId(it)?.remoteId }
                if (remoteIds.isNotEmpty()) {
                    safeApiCall { api().reorderTasks(ReorderRequest(remoteIds)) }
                }
            }

            PendingChangeType.CREATE_NODE -> {
                val entity = nodeDao.getByLocalId(change.targetLocalId) ?: return
                val payload = json.decodeFromString<CreateNodePayload>(change.payload)
                val task = taskDao.getByLocalId(payload.taskLocalId) ?: return
                val taskRemoteId = task.remoteId ?: throw DependencyMissingException()
                val dto = safeApiCall {
                    api().createNode(taskRemoteId, CreateNodeRequest(payload.title, payload.content))
                }.node
                nodeDao.bindRemoteId(entity.localId, dto.id, dto.updatedAt)
            }

            PendingChangeType.UPDATE_NODE -> {
                val entity = nodeDao.getByLocalId(change.targetLocalId) ?: return
                val remoteId = entity.remoteId ?: throw DependencyMissingException()
                val payload = json.decodeFromString<UpdateNodePayload>(change.payload)
                val dto = safeApiCall {
                    api().updateNode(remoteId, UpdateNodeRequest(payload.title, payload.content, payload.done))
                }.node
                nodeDao.upsert(entity.copy(updatedAt = dto.updatedAt ?: entity.updatedAt, dirty = false))
            }

            PendingChangeType.DELETE_NODE -> {
                val payload = json.decodeFromString<DeletePayload>(change.payload)
                val remoteId = payload.remoteId ?: return
                safeApiCall { api().deleteNode(remoteId) }
                nodeDao.getByLocalId(change.targetLocalId)?.let { nodeDao.deleteByLocalId(it.localId) }
            }

            PendingChangeType.REORDER_NODES -> {
                val payload = json.decodeFromString<ReorderPayload>(change.payload)
                val remoteIds = payload.localIds.mapNotNull { nodeDao.getByLocalId(it)?.remoteId }
                if (remoteIds.isNotEmpty()) {
                    safeApiCall { api().reorderNodes(ReorderRequest(remoteIds)) }
                }
            }
        }
    }

    private suspend fun dropLocalEntity(change: PendingChangeEntity) {
        when (change.type) {
            PendingChangeType.CREATE_TASK, PendingChangeType.UPDATE_TASK ->
                taskDao.deleteByLocalId(change.targetLocalId)

            PendingChangeType.CREATE_NODE, PendingChangeType.UPDATE_NODE ->
                nodeDao.deleteByLocalId(change.targetLocalId)
        }
    }
}

private class DependencyMissingException : Exception()
