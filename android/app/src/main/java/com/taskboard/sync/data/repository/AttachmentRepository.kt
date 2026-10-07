package com.taskboard.sync.data.repository

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import com.taskboard.sync.data.local.AppDatabase
import com.taskboard.sync.data.local.entity.AttachmentEntity
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.remote.ApiHolder
import com.taskboard.sync.data.remote.ProgressRequestBody
import com.taskboard.sync.data.remote.TokenStore
import com.taskboard.sync.data.remote.dto.RenameAttachmentRequest
import com.taskboard.sync.data.remote.safeApiCall
import com.taskboard.sync.util.FileUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.util.UUID

class AttachmentRepository(
    private val context: Context,
    private val db: AppDatabase,
    private val apiHolder: ApiHolder,
    private val tokenStore: TokenStore,
) {
    private val attachmentDao = db.attachmentDao()
    private val nodeDao = db.nodeDao()

    private fun api() = apiHolder.api(tokenStore.baseUrl)

    suspend fun upload(
        nodeLocalId: String,
        storage: String,
        uri: Uri,
        fileName: String,
        mimeType: String,
        onProgress: (Float) -> Unit = {},
    ): List<AttachmentEntity> {
        val node = nodeDao.getByLocalId(nodeLocalId)
            ?: throw ApiException(ApiErrorKind.NOT_FOUND, "节点不存在")
        val nodeRemoteId = node.remoteId
            ?: throw ApiException(ApiErrorKind.SERVER, "请先联网同步该节点后再上传附件")

        return withContext(Dispatchers.IO) {
            val tempFile = File(context.cacheDir, "upload-${UUID.randomUUID()}")
            try {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    tempFile.outputStream().use { output -> input.copyTo(output) }
                } ?: throw ApiException(ApiErrorKind.UNKNOWN, "无法读取所选文件")

                val fileBody = tempFile.asRequestBody(mimeType.toMediaTypeOrNull())
                val part = MultipartBody.Part.createFormData(
                    "files",
                    fileName,
                    ProgressRequestBody(fileBody, onProgress),
                )
                val response = safeApiCall {
                    api().uploadAttachment(nodeRemoteId, storage, listOf(part))
                }
                val entities = response.attachments.map { dto ->
                    AttachmentEntity(
                        localId = UUID.randomUUID().toString(),
                        remoteId = dto.id,
                        nodeLocalId = nodeLocalId,
                        originalName = dto.originalName,
                        mimeType = dto.mimeType,
                        size = dto.size,
                        storage = dto.storage,
                        remoteUrl = dto.url,
                        localPath = null,
                        createdAt = dto.createdAt,
                    )
                }
                db.withTransaction { entities.forEach { attachmentDao.upsert(it) } }
                entities
            } finally {
                tempFile.delete()
            }
        }
    }

    suspend fun download(attachment: AttachmentEntity): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "downloads").apply { mkdirs() }
        val target = File(dir, "${attachment.remoteId}-${FileUtil.safeFileName(attachment.originalName)}")
        val body = safeApiCall { api().downloadAttachment(attachment.remoteId) }
        body.use { response ->
            target.outputStream().use { output ->
                response.byteStream().use { it.copyTo(output) }
            }
        }
        attachmentDao.upsert(attachment.copy(localPath = target.absolutePath))
        target
    }

    suspend fun rename(localId: String, newName: String) {
        val attachment = attachmentDao.getByLocalId(localId)
            ?: throw ApiException(ApiErrorKind.NOT_FOUND, "附件不存在")
        val response = safeApiCall {
            api().renameAttachment(attachment.remoteId, RenameAttachmentRequest(newName.trim()))
        }
        attachmentDao.upsert(attachment.copy(originalName = response.attachment.originalName))
    }

    suspend fun delete(localId: String) {
        val attachment = attachmentDao.getByLocalId(localId)
            ?: throw ApiException(ApiErrorKind.NOT_FOUND, "附件不存在")
        safeApiCall { api().deleteAttachment(attachment.remoteId) }
        attachmentDao.deleteByLocalId(localId)
    }
}
