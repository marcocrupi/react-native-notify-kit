package io.invertase.notifee

import com.facebook.react.bridge.WritableMap
import org.junit.Test
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.times
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`

class HeadlessTaskConfigTest {

    // Regression guard for invertase/notifee#266: the init block must copy the caller's
    // WritableMap before mutating it, otherwise a later .copy() on the already-consumed map crashes.
    @Test
    fun taskConfig_copiesParamsBeforeMutating_keepsCallerMapPristine() {
        val original = mock(WritableMap::class.java)
        val copy = mock(WritableMap::class.java)
        `when`(original.copy()).thenReturn(copy)

        HeadlessTask.TaskConfig(
            "NotifeeHeadlessJS",
            60_000L,
            original,
            null,
        )

        verify(original, never()).putInt(anyString(), anyInt())
        verify(original, times(1)).copy()
        verify(copy, times(1)).putInt(anyString(), anyInt())
    }
}
