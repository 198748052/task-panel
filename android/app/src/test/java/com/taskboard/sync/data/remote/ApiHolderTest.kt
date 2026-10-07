package com.taskboard.sync.data.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiHolderTest {

    @Test
    fun normalizeAppendsTrailingSlash() {
        assertEquals("https://tasks.example.com/", ApiHolder.normalize("https://tasks.example.com"))
        assertEquals("https://tasks.example.com/", ApiHolder.normalize("https://tasks.example.com/"))
        assertEquals("https://tasks.example.com/", ApiHolder.normalize("  https://tasks.example.com  "))
    }

    @Test
    fun normalizeKeepsEmptyInputEmpty() {
        assertEquals("", ApiHolder.normalize(""))
        assertEquals("", ApiHolder.normalize("   "))
    }
}
