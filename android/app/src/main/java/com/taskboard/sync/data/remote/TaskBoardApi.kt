package com.taskboard.sync.data.remote

import com.taskboard.sync.data.remote.dto.AccountResponse
import com.taskboard.sync.data.remote.dto.AttachmentResponse
import com.taskboard.sync.data.remote.dto.AttachmentUploadResponse
import com.taskboard.sync.data.remote.dto.CreateNodeRequest
import com.taskboard.sync.data.remote.dto.CreateTaskRequest
import com.taskboard.sync.data.remote.dto.LoginRequest
import com.taskboard.sync.data.remote.dto.LoginResponse
import com.taskboard.sync.data.remote.dto.NodeResponse
import com.taskboard.sync.data.remote.dto.OkResponse
import com.taskboard.sync.data.remote.dto.RenameAttachmentRequest
import com.taskboard.sync.data.remote.dto.ReorderRequest
import com.taskboard.sync.data.remote.dto.SessionResponse
import com.taskboard.sync.data.remote.dto.SyncResponse
import com.taskboard.sync.data.remote.dto.SystemResponse
import com.taskboard.sync.data.remote.dto.TaskResponse
import com.taskboard.sync.data.remote.dto.TasksResponse
import com.taskboard.sync.data.remote.dto.TrashResponse
import com.taskboard.sync.data.remote.dto.UpdateAccountRequest
import com.taskboard.sync.data.remote.dto.UpdateAccountResponse
import com.taskboard.sync.data.remote.dto.UpdateNodeRequest
import com.taskboard.sync.data.remote.dto.UpdateTaskRequest
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface TaskBoardApi {

    @GET("api/session")
    suspend fun session(): SessionResponse

    @POST("api/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("api/logout")
    suspend fun logout(): OkResponse

    @GET("api/account")
    suspend fun account(): AccountResponse

    @PUT("api/account")
    suspend fun updateAccount(@Body body: UpdateAccountRequest): UpdateAccountResponse

    @GET("api/system")
    suspend fun system(): SystemResponse

    @GET("api/sync")
    suspend fun sync(): SyncResponse

    @GET("api/tasks")
    suspend fun tasks(): TasksResponse

    @POST("api/tasks")
    suspend fun createTask(@Body body: CreateTaskRequest): TaskResponse

    @PATCH("api/tasks/{id}")
    suspend fun updateTask(@Path("id") id: Long, @Body body: UpdateTaskRequest): TaskResponse

    @DELETE("api/tasks/{id}")
    suspend fun deleteTask(@Path("id") id: Long): OkResponse

    @POST("api/tasks/reorder")
    suspend fun reorderTasks(@Body body: ReorderRequest): OkResponse

    @POST("api/tasks/{id}/nodes")
    suspend fun createNode(@Path("id") taskId: Long, @Body body: CreateNodeRequest): NodeResponse

    @PATCH("api/nodes/{id}")
    suspend fun updateNode(@Path("id") id: Long, @Body body: UpdateNodeRequest): NodeResponse

    @DELETE("api/nodes/{id}")
    suspend fun deleteNode(@Path("id") id: Long): OkResponse

    @POST("api/nodes/reorder")
    suspend fun reorderNodes(@Body body: ReorderRequest): OkResponse

    @Multipart
    @POST("api/nodes/{id}/attachments")
    suspend fun uploadAttachment(
        @Path("id") nodeId: Long,
        @Query("storage") storage: String,
        @Part files: List<MultipartBody.Part>,
    ): AttachmentUploadResponse

    @Streaming
    @GET("api/attachments/{id}")
    suspend fun downloadAttachment(@Path("id") id: Long): ResponseBody

    @PATCH("api/attachments/{id}")
    suspend fun renameAttachment(
        @Path("id") id: Long,
        @Body body: RenameAttachmentRequest,
    ): AttachmentResponse

    @DELETE("api/attachments/{id}")
    suspend fun deleteAttachment(@Path("id") id: Long): OkResponse

    @GET("api/trash")
    suspend fun trash(): TrashResponse

    @POST("api/trash/empty")
    suspend fun emptyTrash(): OkResponse

    @POST("api/trash/{batch}/restore")
    suspend fun restoreTrash(@Path("batch") batch: String): OkResponse

    @DELETE("api/trash/{batch}")
    suspend fun purgeTrash(@Path("batch") batch: String): OkResponse

    @Streaming
    @GET("api/export")
    suspend fun export(): ResponseBody
}
