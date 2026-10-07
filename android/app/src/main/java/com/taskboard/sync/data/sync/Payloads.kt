package com.taskboard.sync.data.sync

import kotlinx.serialization.Serializable

@Serializable
data class CreateTaskPayload(
    val title: String,
    val description: String = "",
    val color: String = "blue",
)

@Serializable
data class UpdateTaskPayload(
    val title: String? = null,
    val description: String? = null,
    val color: String? = null,
    val archived: Boolean? = null,
)

@Serializable
data class DeletePayload(
    val remoteId: Long? = null,
)

@Serializable
data class ReorderPayload(
    val localIds: List<String>,
)

@Serializable
data class CreateNodePayload(
    val taskLocalId: String,
    val title: String,
    val content: String = "",
)

@Serializable
data class UpdateNodePayload(
    val title: String? = null,
    val content: String? = null,
    val done: Boolean? = null,
)
