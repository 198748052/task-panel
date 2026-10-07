package com.taskboard.sync.data.local

import androidx.room.Embedded
import androidx.room.Relation
import com.taskboard.sync.data.local.entity.AttachmentEntity
import com.taskboard.sync.data.local.entity.NodeEntity
import com.taskboard.sync.data.local.entity.TaskEntity

data class NodeWithAttachments(
    @Embedded val node: NodeEntity,
    @Relation(parentColumn = "localId", entityColumn = "nodeLocalId")
    val attachments: List<AttachmentEntity>,
)

data class TaskWithNodes(
    @Embedded val task: TaskEntity,
    @Relation(
        entity = NodeEntity::class,
        parentColumn = "localId",
        entityColumn = "taskLocalId",
    )
    val nodes: List<NodeWithAttachments>,
)
