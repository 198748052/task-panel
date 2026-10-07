package com.taskboard.sync.data.remote

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * 服务地址由用户在登录时填写，所以 Retrofit 实例按 baseUrl 懒创建并缓存。
 */
class ApiHolder(
    private val client: OkHttpClient,
    private val json: Json,
) {
    private var cachedBaseUrl: String? = null
    private var cached: TaskBoardApi? = null

    @Synchronized
    fun api(baseUrl: String): TaskBoardApi {
        val normalized = normalize(baseUrl)
        check(normalized.isNotBlank()) { "服务地址为空" }
        val existing = cached
        if (existing != null && cachedBaseUrl == normalized) return existing
        val retrofit = Retrofit.Builder()
            .baseUrl(normalized)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
        val created = retrofit.create(TaskBoardApi::class.java)
        cached = created
        cachedBaseUrl = normalized
        return created
    }

    companion object {
        fun normalize(url: String): String {
            val trimmed = url.trim()
            return when {
                trimmed.isEmpty() -> trimmed
                trimmed.endsWith("/") -> trimmed
                else -> "$trimmed/"
            }
        }
    }
}
