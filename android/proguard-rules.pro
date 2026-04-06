# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

-printmapping javasource.map
-renamesourcefileattribute SourceFile
-keepattributes Exceptions,InnerClasses,Signature,Deprecated,SourceFile,LineNumberTable,EnclosingMethod

# Preserve all annotations.
-keepattributes *Annotation*

# Keep the classes/members we need for client functionality.
-keep @interface androidx.annotation.Keep { *; }
-keep @androidx.annotation.Keep class * { *; }
-keepclasseswithmembers class * {
  @androidx.annotation.Keep <fields>;
}
-keepclasseswithmembers class * {
  @androidx.annotation.Keep <methods>;
}

# Keep the classes/members we need for client functionality.
-keep @interface app.notifee.core.KeepForSdk { *; }
-keep @app.notifee.core.KeepForSdk class * { *; }
-keepclasseswithmembers class * {
  @app.notifee.core.KeepForSdk <fields>;
}
-keepclasseswithmembers class * {
  @app.notifee.core.KeepForSdk <methods>;
}

# Preserve all .class method names.
-keepclassmembernames class * {
    java.lang.Class class$(java.lang.String);
    java.lang.Class class$(java.lang.String, boolean);
}

# Preserve all native method names and the names of their classes.
-keepclasseswithmembernames class * {
    native <methods>;
}

# Preserve the special static methods that are required in all enumeration
# classes.
-keepclassmembers class * extends java.lang.Enum {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# --------------------------------
#            LIBRARIES
# --------------------------------

# Work Manager
-keepclassmembers class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context,androidx.work.WorkerParameters);
}

# EventBus
-keepclassmembers class * {
    @org.greenrobot.eventbus.Subscribe <methods>;
}
-keep enum org.greenrobot.eventbus.ThreadMode { *; }

# Only required if you use AsyncExecutor
-keepclassmembers class * extends org.greenrobot.eventbus.util.ThrowableFailureEvent {
    <init>(java.lang.Throwable);
}

# InitProvider is subclassed by the RN bridge module (NotifeeInitProvider).
# R8 must not finalize its methods, otherwise the bridge cannot override onCreate().
-keep class app.notifee.core.InitProvider { *; }
-keeppackagenames app.notifee.core.**

# -----
-repackageclasses 'n.o.t.i.f.e.e'
