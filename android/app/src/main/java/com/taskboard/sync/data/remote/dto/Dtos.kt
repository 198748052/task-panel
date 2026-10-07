package com.taskboard.sync.data.remote.dto

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/*
 * 后端列表接口把 archived 转成布尔值，而创建/更新接口直接返回数据库原始行（0/1）。
 * 这里做兼容解码，两种形态都能读。
 */
object LenientBooleanSerializer : KSerializer<Boolean> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("LenientBoolean", PrimitiveKind.BOOLEAN)

    override fun deserialize(decoder: Decoder): Boolean {
        val element = (decoder as? kotlinx.serialization.json.JsonDecoder)
            ?.decodeJsonElement()
        if (element is JsonPrimitive) {
            element.booleanOrNull?.let { return it }
            element.intOrNull?.let { return it != 0 }
            return element.content == "1"
        }
        return false
    }

    override fun serialize(encoder: Encoder, value: Boolean) {
        encoder.encodeBoolean(value)
    }
}

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
)

@Serializable
data class LoginResponse(
    val ok: Boolean = true,
    val token: String? = null,
    val expiresInMs: Long? = null,
)

@Serializable
data class SessionResponse(
    val authEnabled: Boolean = true,
    val authed: Boolean = false,
    val maxUploadMb: Int = 0,
    val maxR2UploadMb: Int = 0,
    val retentionDays: Int = 30,
    val r2Enabled: Boolean = false,
    val deployedDir: String? = null,
)

@Serializable
data class SystemResponse(
    val version: String = "",
    val branch: String = "",
    val git: Boolean = false,
)

@Serializable
data class AccountResponse(
    val username: String = "",
)

@Serializable
data class UpdateAccountRequest(
    val username: String,
    val currentPassword: String,
    val newPassword: String? = null,
)

@Serializable
data class UpdateAccountResponse(
    val ok: Boolean = true,
    val username: String = "",
    val token: String? = null,
    val expiresInMs: Long? = null,
)

@Serializable
data class OkResponse(
    val ok: Boolean = true,
    val batch: String? = null,
)

@Serializable
data class SyncResponse(
    val serverTime: String? = null,
    val tasks: List<TaskDto> = emptyList(),
    val trash: List<TrashItemDto> = emptyList(),
    val retentionDays: Int = 30,
    val maxUploadMb: Int = 0,
    val maxR2UploadMb: Int = 0,
    val r2Enabled: Boolean = false,
)

@Serializable
data class TaskDto(
    val id: Long,
    val title: String,
    val description: String = "",
    val color: String = "blue",
    @Serializable(with = LenientBooleanSerializer::class)
    val archived: Boolean = false,
    @SerialName("sort_order") val sortOrder: Double = 0.0,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    val nodes: List<NodeDto> = emptyList(),
)

@Serializable
data class NodeDto(
    val id: Long,
    @SerialName("task_id") val taskId: Long? = null,
    val title: String,
    val content: String = "",
    val done: Boolean = false,
    @SerialName("sort_order") val sortOrder: Double = 0.0,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    val attachments: List<AttachmentDto> = emptyList(),
)

@Serializable
data class AttachmentDto(
    val id: Long,
    @SerialName("node_id") val nodeId: Long? = null,
    @SerialName("original_name") val originalName: String = "",
    @SerialName("mime_type") val mimeType: String = "",
    val size: Long = 0,
    val storage: String = "local",
    val url: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class TrashItemDto(
    val batch: String,
    val type: String = "",
    val title: String = "",
    val parent: String = "",
    @SerialName("deleted_at") val deletedAt: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("days_left") val daysLeft: Int = 0,
    val nodes: Int = 0,
    val attachments: Int = 0,
)

@Serializable
data class TasksResponse(
    val tasks: List<TaskDto> = emptyList(),
)

@Serializable
data class TaskResponse(
    val task: TaskDto,
)

@Serializable
data class NodeResponse(
    val node: NodeDto,
)

@Serializable
data class AttachmentResponse(
    val attachment: AttachmentDto,
)

@Serializable
data class AttachmentUploadResponse(
    val attachments: List<AttachmentDto> = emptyList(),
    val storage: String = "local",
)

@Serializable
data class TrashResponse(
    val items: List<TrashItemDto> = emptyList(),
    val retentionDays: Int = 30,
)

@Serializable
data class CreateTaskRequest(
    val title: String,
    val description: String = "",
    val color: String = "blue",
)

@Serializable
data class UpdateTaskRequest(
    val title: String? = null,
    val description: String? = null,
    val color: String? = null,
    val archived: Boolean? = null,
)

@Serializable
data class CreateNodeRequest(
    val title: String,
    val content: String = "",
)

@Serializable
data class UpdateNodeRequest(
    val title: String? = null,
    val content: String? = null,
    val done: Boolean? = null,
)

@Serializable
data class ReorderRequest(
    val ids: List<Long>,
)

@Serializable
data class RenameAttachmentRequest(
    @SerialName("original_name") val originalName: String,
)
