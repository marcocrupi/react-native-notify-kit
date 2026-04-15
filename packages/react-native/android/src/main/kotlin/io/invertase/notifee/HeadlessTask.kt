/*
 * This software has been integrated, with great appreciation, from the
 * react-native-background-geolocation library, and was originally authored by
 * Chris Scott @ TransistorSoft. It is published in that repository under this license,
 * included here in it's entirety
 *
 * https://github.com/transistorsoft/react-native-background-geolocation/blob/master/LICENSE
 *
 * ----
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Chris Scott
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
package io.invertase.notifee

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import app.notifee.core.EventSubscriber
import com.facebook.infer.annotation.Assertions
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class HeadlessTask {

    private val mTaskQueue = ArrayList<TaskConfig>()
    private val mIsReactContextInitialized = AtomicBoolean(false)
    private val mWillDrainTaskQueue = AtomicBoolean(false)
    private val mIsInitializingReactContext = AtomicBoolean(false)
    private val mIsHeadlessJsTaskListenerRegistered = AtomicBoolean(false)

    fun stopAllTasks() {
        for (task in mTaskQueue) {
            onFinishHeadlessTask(task.taskId)
        }
    }

    fun onFinishHeadlessTask(taskId: Int) {
        if (!mIsReactContextInitialized.get()) {
            Log.w(HEADLESS_TASK_NAME, "$taskId found no ReactContext")
            return
        }
        val reactContext = getReactContext(EventSubscriber.getContext())
        if (reactContext != null) {
            synchronized(mTaskQueue) {
                val taskConfig = mTaskQueue.find { it.taskId == taskId }
                if (taskConfig != null) {
                    val headlessJsTaskContext = HeadlessJsTaskContext.getInstance(reactContext)
                    headlessJsTaskContext.finishTask(taskConfig.reactTaskId)
                } else {
                    Log.w(HEADLESS_TASK_NAME, "Failed to find task: $taskId")
                }
            }
        } else {
            Log.w(
                HEADLESS_TASK_NAME,
                "Failed to finishHeadlessTask: $taskId -- HeadlessTask onFinishHeadlessTask " +
                    "failed to find a ReactContext. This is unexpected",
            )
        }
    }

    @Throws(AssertionError::class)
    fun startTask(context: Context, taskConfig: TaskConfig) {
        UiThreadUtil.assertOnUiThread()

        synchronized(mTaskQueue) {
            mTaskQueue.add(taskConfig)
        }

        if (!mIsReactContextInitialized.get()) {
            createReactContextAndScheduleTask(context)
        } else {
            invokeStartTask(getReactContext(context)!!, taskConfig)
        }
    }

    @Synchronized
    private fun invokeStartTask(reactContext: ReactContext, taskConfig: TaskConfig) {
        if (taskConfig.reactTaskId > 0) {
            Log.w(HEADLESS_TASK_NAME, "Task already invoked <IGNORED>: $this")
            return
        }
        val headlessJsTaskContext = HeadlessJsTaskContext.getInstance(reactContext)
        try {
            if (mIsHeadlessJsTaskListenerRegistered.compareAndSet(false, true)) {
                headlessJsTaskContext.addTaskEventListener(object : HeadlessJsTaskEventListener {
                    override fun onHeadlessJsTaskStart(taskId: Int) {}

                    override fun onHeadlessJsTaskFinish(taskId: Int) {
                        synchronized(mTaskQueue) {
                            if (mTaskQueue.isEmpty()) return

                            val config = mTaskQueue.find { it.reactTaskId == taskId }
                            if (config != null) {
                                Log.d(HEADLESS_TASK_NAME, "completed taskId: ${config.taskId}")
                                mTaskQueue.remove(config)
                                config.callback?.call()
                            } else {
                                Log.w(HEADLESS_TASK_NAME, "Failed to find taskId: $taskId")
                            }
                        }
                    }
                })
            }
            val rnTaskId = headlessJsTaskContext.startTask(taskConfig.taskConfig)
            taskConfig.reactTaskId = rnTaskId
            Log.d(HEADLESS_TASK_NAME, "launched taskId: $rnTaskId")
        } catch (e: IllegalStateException) {
            Log.e(HEADLESS_TASK_NAME, e.message, e)
        }
    }

    private fun createReactContextAndScheduleTask(context: Context) {
        val reactContext = getReactContext(context)
        if (reactContext != null && !mIsInitializingReactContext.get()) {
            mIsReactContextInitialized.set(true)
            drainTaskQueue(reactContext)
            return
        }
        if (mIsInitializingReactContext.compareAndSet(false, true)) {
            Log.d(HEADLESS_TASK_NAME, "initialize ReactContext")
            val reactHost = getReactHost(context)
            val callback = object : ReactInstanceEventListener {
                override fun onReactContextInitialized(reactCtx: ReactContext) {
                    mIsReactContextInitialized.set(true)
                    drainTaskQueue(reactCtx)
                    try {
                        val removeMethod = reactHost!!.javaClass.getMethod(
                            "removeReactInstanceEventListener",
                            ReactInstanceEventListener::class.java,
                        )
                        removeMethod.invoke(reactHost, this)
                    } catch (e: Exception) {
                        Log.e(HEADLESS_TASK_NAME, "reflection error A: $e", e)
                    }
                }
            }
            try {
                val addMethod = reactHost!!.javaClass.getMethod(
                    "addReactInstanceEventListener",
                    ReactInstanceEventListener::class.java,
                )
                addMethod.invoke(reactHost, callback)
                val startMethod = reactHost.javaClass.getMethod("start")
                startMethod.invoke(reactHost)
            } catch (e: Exception) {
                Log.e(HEADLESS_TASK_NAME, "reflection error ReactHost start: ${e.message}", e)
            }
        }
    }

    private fun drainTaskQueue(reactContext: ReactContext) {
        if (mWillDrainTaskQueue.compareAndSet(false, true)) {
            Handler(Looper.getMainLooper()).postDelayed(
                {
                    synchronized(mTaskQueue) {
                        for (taskConfig in mTaskQueue) {
                            invokeStartTask(reactContext, taskConfig)
                        }
                    }
                },
                500,
            )
        }
    }

    class TaskConfig(
        val taskName: String,
        private val taskTimeout: Long,
        params: WritableMap,
        val callback: GenericCallback?,
    ) {
        val taskId: Int = getNextTaskId()
        var reactTaskId: Int = 0
        private val params: WritableMap

        init {
            val copied = params.copy()
            copied.putInt("taskId", taskId)
            this.params = copied
        }

        val taskConfig: HeadlessJsTaskConfig
            get() = HeadlessJsTaskConfig(taskName, params, taskTimeout, true)
    }

    fun interface GenericCallback {
        fun call()
    }

    companion object {
        private const val HEADLESS_TASK_NAME = "NotifeeHeadlessJS"
        private const val TASK_TIMEOUT = 60000
        private val sLastTaskId = AtomicInteger(0)

        @JvmStatic
        @Synchronized
        fun getNextTaskId(): Int = sLastTaskId.incrementAndGet()

        @JvmStatic
        fun getReactHost(context: Context): Any? {
            val appContext = context.applicationContext
            return try {
                val method = appContext.javaClass.getMethod("getReactHost")
                method.invoke(appContext)
            } catch (e: Exception) {
                null
            }
        }

        @JvmStatic
        @SuppressLint("VisibleForTests")
        fun getReactContext(context: Context): ReactContext? {
            val reactHost = getReactHost(context)
            Assertions.assertNotNull(reactHost, "getReactHost() is null in New Architecture")
            try {
                val method = reactHost!!.javaClass.getMethod("getCurrentReactContext")
                return method.invoke(reactHost) as? ReactContext
            } catch (e: Exception) {
                Log.e(
                    HEADLESS_TASK_NAME,
                    "Reflection error getCurrentReactContext: ${e.message}",
                    e,
                )
            }
            return null
        }
    }
}
