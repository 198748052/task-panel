package com.taskboard.sync.data.repository

import android.content.ContentResolver
import android.net.Uri
import com.taskboard.sync.data.remote.ApiErrorKind
import com.taskboard.sync.data.remote.ApiException
import com.taskboard.sync.data.remote.ApiHolder
import com.taskboard.sync.data.remote.TokenStore
import com.taskboard.sync.data.remote.safeApiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ExportRepository(
    private val apiHolder: ApiHolder,
    private val tokenStore: TokenStore,
) {
    private fun api() = apiHolder.api(tokenStore.baseUrl)

    suspend fun exportTo(resolver: ContentResolver, uri: Uri) {
        withContext(Dispatchers.IO) {
            val body = safeApiCall { api().export() }
            body.use { response ->
                val output = resolver.openOutputStream(uri)
                    ?: throw ApiException(ApiErrorKind.UNKNOWN, "无法写入目标文件")
                output.use { out -> response.byteStream().use { it.copyTo(out) } }
            }
        }
    }
}
