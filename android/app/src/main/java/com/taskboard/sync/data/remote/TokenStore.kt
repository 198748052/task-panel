package com.taskboard.sync.data.remote

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

private const val ENCRYPTED_FILE = "task_board_secure"
private const val PLAIN_FILE = "task_board_plain"
private const val KEY_BASE_URL = "base_url"
private const val KEY_TOKEN = "session_token"

/**
 * 保存服务地址与会话令牌。优先使用 Android 加密存储；个别设备加密存储初始化失败时
 * 回退到应用私有目录的普通存储，保证功能可用。
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = createPrefs(context)

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_BASE_URL, value.trim()).apply()
        }

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) {
            val editor = prefs.edit()
            if (value.isNullOrBlank()) editor.remove(KEY_TOKEN) else editor.putString(KEY_TOKEN, value)
            editor.apply()
        }

    fun clearToken() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }
}

private fun createPrefs(context: Context): SharedPreferences = try {
    val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    EncryptedSharedPreferences.create(
        context,
        ENCRYPTED_FILE,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
} catch (t: Throwable) {
    context.getSharedPreferences(PLAIN_FILE, Context.MODE_PRIVATE)
}
