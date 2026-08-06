diff --git a/third_party/webrtc/modules/audio_coding/neteq/neteq_impl.cc b/third_party/webrtc/modules/audio_coding/neteq/neteq_impl.cc
index f0e96564f7b08..83e10d735a11f 100644
--- a/third_party/webrtc/modules/audio_coding/neteq/neteq_impl.cc
+++ b/third_party/webrtc/modules/audio_coding/neteq/neteq_impl.cc
@@ -825,7 +825,7 @@ int NetEqImpl::GetAudioInternal(AudioFrame* audio_frame,
   }

   if (!got_audio) {
-    RTC_LOG(LS_ERROR) << "audio_frame->samples_per_channel_ ("
+    RTC_DLOG(LS_ERROR) << "audio_frame->samples_per_channel_ ("
                       << audio_frame->samples_per_channel_
                       << ") != output_size_samples_ (" << output_size_samples_
                       << ")";
