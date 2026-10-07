package com.taskboard.sync.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/*
 * 应用统一使用白色主题：整体浅色底、白色卡片，不跟随系统深色模式。
 */
private val LightColors = lightColorScheme(
    primary = Color(0xFF2563EB),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFEFF4FF),
    onPrimaryContainer = Color(0xFF1E3A8A),
    secondary = Color(0xFF4C6EF5),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEEF1FF),
    onSecondaryContainer = Color(0xFF26307A),
    tertiaryContainer = Color(0xFFFFF4E5),
    onTertiaryContainer = Color(0xFF8A5200),
    background = Color(0xFFF5F6F8),
    onBackground = Color(0xFF1F2328),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1F2328),
    surfaceVariant = Color(0xFFF3F4F6),
    onSurfaceVariant = Color(0xFF6B7280),
    outline = Color(0xFFE5E7EB),
    outlineVariant = Color(0xFFEDEFF2),
    error = Color(0xFFDC2626),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFDECEC),
    onErrorContainer = Color(0xFF7F1D1D),
)

@Composable
fun TaskBoardTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        content = content,
    )
}
