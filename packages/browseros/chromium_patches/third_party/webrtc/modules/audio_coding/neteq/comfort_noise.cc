diff --git a/third_party/webrtc/modules/audio_coding/neteq/comfort_noise.cc b/third_party/webrtc/modules/audio_coding/neteq/comfort_noise.cc
index da94881585d58..59c80212a21f4 100644
--- a/third_party/webrtc/modules/audio_coding/neteq/comfort_noise.cc
+++ b/third_party/webrtc/modules/audio_coding/neteq/comfort_noise.cc
@@ -47,7 +47,7 @@ int ComfortNoise::Generate(size_t requested_length, AudioMultiVector* output) {
              fs_hz_ == 48000);
   // Not adapted for multi-channel yet.
   if (output->Channels() != 1) {
-    RTC_LOG(LS_ERROR) << "No multi-channel support";
+    RTC_DLOG(LS_ERROR) << "No multi-channel support";
     return kMultiChannelNotSupported;
   }

