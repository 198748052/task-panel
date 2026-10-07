package com.taskboard.sync.data.repository

import com.taskboard.sync.data.remote.ApiHolder
import com.taskboard.sync.data.remote.TokenStore
import com.taskboard.sync.data.remote.dto.TrashItemDto
import com.taskboard.sync.data.remote.safeApiCall

class TrashRepository(
    private val apiHolder: ApiHolder,
    private val tokenStore: TokenStore,
) {
    private fun api() = apiHolder.api(tokenStore.baseUrl)

    suspend fun list(): List<TrashItemDto> = safeApiCall { api().trash() }.items

    suspend fun restore(batch: String) {
        safeApiCall { api().restoreTrash(batch) }
    }

    suspend fun purge(batch: String) {
        safeApiCall { api().purgeTrash(batch) }
    }

    suspend fun empty() {
        safeApiCall { api().emptyTrash() }
    }
}
