package com.taskboard.sync.util

import org.junit.Assert.assertEquals
import org.junit.Test

class FileUtilTest {

    @Test
    fun safeFileNameReplacesUnsafeCharacters() {
        assertEquals("a_b_c.png", FileUtil.safeFileName("a/b:c.png"))
        assertEquals("file", FileUtil.safeFileName("   "))
    }

    @Test
    fun humanSizeFormatsUnits() {
        assertEquals("512 B", FileUtil.humanSize(512))
        assertEquals("1.0 KB", FileUtil.humanSize(1024))
        assertEquals("1.0 MB", FileUtil.humanSize(1024L * 1024))
        assertEquals("1.5 GB", FileUtil.humanSize((1.5 * 1024 * 1024 * 1024).toLong()))
    }

    @Test
    fun isCleartextDetectsHttp() {
        assertEquals(true, FileUtil.isCleartext("http://192.168.1.10:3000"))
        assertEquals(false, FileUtil.isCleartext("https://tasks.example.com"))
    }
}
