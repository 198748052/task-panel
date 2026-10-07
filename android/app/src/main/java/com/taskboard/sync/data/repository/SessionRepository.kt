package com.taskboard.sync.data.repository

import androidx.room.withTransaction
import com.taskboard.sync.data.local.AppDatabase
import com.taskboard.sync.data.local.entity.SyncMetaEntity
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.remote.ApiHolder
import com.taskboard.sync.data.remote.TokenStore
import com.taskboard.sync.data.remote.dto.LoginRequest
import com.taskboard.sync.data.remote.dto.UpdateAccountRequest
import com.taskboard.sync.data.remote.safeApiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SessionRepository(
    private val db: AppDatabase,
    private val apiHolder: ApiHolder,
    private val tokenStore: TokenStore,
) {
    private val metaDao = db.syncMetaDao()

    private fun api() = apiHolder.api(tokenStore.baseUrl)

    val baseUrl: String get() = tokenStore.baseUrl
    val hasSession: Boolean get() = !tokenStore.token.isNullOrBlank()
    val hasBaseUrl: Boolean get() = tokenStore.baseUrl.isNotBlank()

    fun saveBaseUrl(url: String) {
        tokenStore.baseUrl = url.trim()
    }

    suspend fun login(url: String, username: String, password: String) {
        val normalized = ApiHolder.normalize(url)
        if (normalized.isBlank()) {
            throw ApiException(ApiErrorKind.UNKNOWN, "请填写服务地址")
        }
        tokenStore.baseUrl = normalized
        val response = safeApiCall { api().login(LoginRequest(username.trim(), password)) }
        val token = response.token
        if (token.isNullOrBlank()) {
            throw ApiException(ApiErrorKind.UNKNOWN, "服务未返回会话令牌，请确认后端已更新")
        }
        tokenStore.token = token
    }

    suspend fun logout() {
        try {
            safeApiCall { api().logout() }
        } catch (_: Exception) {
            // 令牌为无状态签名，服务端失败也继续清理本地
        }
        tokenStore.clearToken()
        withContext(Dispatchers.IO) {
            db.clearAllTables()
        }
    }

    suspend fun fetchUsername(): String = safeApiCall { api().account() }.username

    suspend fun refreshServerInfo() {
        val session = safeApiCall { api().session() }
        val system = runCatching { safeApiCall { api().system() } }.getOrNull()
        db.withTransaction {
            val existing = metaDao.get()
            metaDao.upsert(
                SyncMetaEntity(
                    id = 1,
                    lastSyncAt = existing?.lastSyncAt,
                    serverVersion = system?.version ?: existing?.serverVersion ?: "",
                    serverBranch = system?.branch ?: existing?.serverBranch ?: "",
                    maxUploadMb = session.maxUploadMb,
                    maxR2UploadMb = session.maxR2UploadMb,
                    r2Enabled = session.r2Enabled,
                    retentionDays = session.retentionDays,
                ),
            )
        }
    }

    suspend fun changeAccount(username: String, currentPassword: String, newPassword: String?) {
        val response = safeApiCall {
            api().updateAccount(UpdateAccountRequest(username.trim(), currentPassword, newPassword))
        }
        val token = response.token
        if (!token.isNullOrBlank()) {
            tokenStore.token = token
        }
    }
}
