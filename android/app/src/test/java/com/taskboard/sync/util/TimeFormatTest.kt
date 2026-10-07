package com.taskboard.sync.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class TimeFormatTest {

    @Test
    fun formatsIsoUtcToLocalDateTime() {
        val expected = Instant.parse("2026-10-07T04:15:00Z")
            .atZone(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.getDefault()))
        assertEquals(expected, TimeFormat.dateTime("2026-10-07T04:15:00.000Z"))
    }

    @Test
    fun returnsEmptyForBlank() {
        assertEquals("", TimeFormat.dateTime(null))
        assertEquals("", TimeFormat.dateTime(""))
        assertEquals("", TimeFormat.dateTime("   "))
    }

    @Test
    fun fallsBackToRawValueWhenUnparseable() {
        assertEquals("not-a-date", TimeFormat.dateTime("not-a-date"))
    }

    @Test
    fun supportsOffsetTimestamps() {
        val formatted = TimeFormat.dateTime("2026-10-07T12:15:00+08:00")
        assertTrue(formatted.isNotBlank())
    }
}
