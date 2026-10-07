package com.taskboard.sync.ui.theme

import androidx.compose.ui.graphics.Color

/*
 * 与服务端/网页端一致的七种任务颜色，用于卡片左侧色条与颜色圆点。
 */
private val AccentByColor: Map<String, Color> = mapOf(
    "blue" to Color(0xFF2563EB),
    "green" to Color(0xFF16A34A),
    "amber" to Color(0xFFD97706),
    "rose" to Color(0xFFE11D48),
    "violet" to Color(0xFF7C3AED),
    "cyan" to Color(0xFF0891B2),
    "slate" to Color(0xFF475569),
)

val TaskColorOptions: List<String> = AccentByColor.keys.toList()

fun taskAccent(color: String?): Color =
    AccentByColor[color?.lowercase()] ?: AccentByColor.getValue("blue")
