# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.taskboard.sync.**$$serializer { *; }
-keepclassmembers class com.taskboard.sync.** { *** Companion; }
-keepclasseswithmembers class com.taskboard.sync.** { kotlinx.serialization.KSerializer serializer(...); }

# Retrofit
-keepattributes Signature, RuntimeVisibleAnnotations
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**

-dontwarn com.google.errorprone.annotations.**
