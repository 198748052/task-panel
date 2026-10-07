package com.taskboard.sync.data.remote

import com.taskboard.sync.data.remote.dto.LoginRequest
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory

class ApiContractTest {

    private lateinit var server: MockWebServer

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        isLenient = true
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun api(tokenProvider: () -> String?): TaskBoardApi {
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenProvider))
            .build()
        return Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(TaskBoardApi::class.java)
    }

    @Test
    fun loginParsesTokenAndPostsToApiLogin() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"ok":true,"token":"token-123","expiresInMs":2592000000}"""),
        )

        val response = api { null }.login(LoginRequest("admin", "admin123"))

        assertEquals("token-123", response.token)
        val recorded = server.takeRequest()
        assertEquals("/api/login", recorded.path)
    }

    @Test
    fun interceptorAttachesBearerToken() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"tasks":[]}"""),
        )

        api { "token-abc" }.tasks()

        val recorded = server.takeRequest()
        assertEquals("Bearer token-abc", recorded.getHeader("Authorization"))
    }

    @Test
    fun safeApiCallMapsUnauthorized() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"error":"unauthorized"}"""),
        )

        try {
            safeApiCall { api { "expired" }.session() }
            fail("Expected ApiException")
        } catch (e: ApiException) {
            assertEquals(ApiErrorKind.UNAUTHORIZED, e.kind)
            assertEquals(401, e.code)
            assertTrue(e.message!!.isNotBlank())
        }
    }

    @Test
    fun safeApiCallMapsNetworkFailure() = runBlocking {
        server.shutdown()
        try {
            safeApiCall { api { null }.session() }
            fail("Expected ApiException")
        } catch (e: ApiException) {
            assertEquals(ApiErrorKind.NETWORK, e.kind)
        }
    }
}
