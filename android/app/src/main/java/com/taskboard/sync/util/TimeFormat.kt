package com.taskboard.sync.util

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object TimeFormat {

    private val formatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.getDefault())

    fun dateTime(iso: String?): String {
        if (iso.isNullOrBlank()) return ""
        val instant = try {
            Instant.parse(iso)
        } catch (e: Exception) {
            try {
                OffsetDateTime.parse(iso).toInstant()
            } catch (e2: Exception) {
                return iso
            }
        }
        return instant.atZone(ZoneId.systemDefault()).format(formatter)
    }
}
