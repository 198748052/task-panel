package com.taskboard.sync.data.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import java.io.IOException

enum class ApiErrorKind {
    UNAUTHORIZED,
    NOT_FOUND,
    CONFLICT,
    NETWORK,
    SERVER,
    UNKNOWN,
}

class ApiException(
    val kind: ApiErrorKind,
    message: String,
    val code: Int? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

private val messageJson = Json { ignoreUnknownKeys = true }

/**
 * 统一把网络/HTTP 异常映射成 ApiException，调用方按 kind 分支处理。
 */
suspend fun <T> safeApiCall(block: suspend () -> T): T {
    return try {
        block()
    } catch (e: ApiException) {
        throw e
    } catch (e: HttpException) {
        val kind = when (e.code()) {
            401 -> ApiErrorKind.UNAUTHORIZED
            404 -> ApiErrorKind.NOT_FOUND
            409 -> ApiErrorKind.CONFLICT
            else -> ApiErrorKind.SERVER
        }
        throw ApiException(kind, parseMessage(e) ?: "请求失败（HTTP ${e.code()}）", e.code(), e)
    } catch (e: IOException) {
        throw ApiException(ApiErrorKind.NETWORK, "网络不可用", null, e)
    } catch (e: kotlinx.serialization.SerializationException) {
        throw ApiException(ApiErrorKind.UNKNOWN, "响应解析失败", null, e)
    }
}

private fun parseMessage(e: HttpException): String? {
    return try {
        val body = e.response()?.errorBody()?.string()
        if (body.isNullOrBlank()) {
            null
        } else {
            messageJson.parseToJsonElement(body)
                .jsonObject["message"]
                ?.jsonPrimitive
                ?.contentOrNull
        }
    } catch (t: Throwable) {
        null
    }
}
