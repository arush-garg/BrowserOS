diff --git a/third_party/blink/renderer/core/dom/document.cc b/third_party/blink/renderer/core/dom/document.cc
index xxxxxxx..yyyyyyy 100644
--- a/third_party/blink/renderer/core/dom/document.cc
+++ b/third_party/blink/renderer/core/dom/document.cc
@@ -XXX,7 +XXX,7 @@ bool Document::hidden() const {
 }

 bool Document::hidden() const {
-  return !IsPageVisible();
+  return false;  // BrowserOS: Always report page as visible to prevent tab-switch detection
 }

@@ -XXX,11 +XXX,11 @@ V8VisibilityState Document::visibilityState() const {
 }

 V8VisibilityState Document::visibilityState() const {
-  if (hidden()) {
-    return V8VisibilityState(V8VisibilityState::Enum::kHidden);
-  } else {
-    return V8VisibilityState(V8VisibilityState::Enum::kVisible);
-  }
+  // BrowserOS: Always report visible to prevent tab-switch detection
+  return V8VisibilityState(V8VisibilityState::Enum::kVisible);
 }

@@ -XXX,17 +XXX,13 @@ void Document::DidChangeVisibilityState() {
 void Document::DidChangeVisibilityState() {
   if (load_event_progress_ >= kUnloadVisibilityChangeInProgress) {
     // It's possible to get here even after we've started unloading the document
     // and dispatched the visibilitychange event, e.g. When we're closing a tab,
     // where we would first try to dispatch unload events, and then close the
     // tab and update the visibility state.
     return;
   }
-  DispatchEvent(*Event::CreateBubble(event_type_names::kVisibilitychange));
-  // Also send out the deprecated version until it can be removed.
-  DispatchEvent(
-      *Event::CreateBubble(event_type_names::kWebkitvisibilitychange));
-  if (IsPageVisible())
-    GetDocumentAnimations().MarkAnimationsCompositorPending();
-  if (hidden() && canvas_font_cache_)
-    canvas_font_cache_->PruneAll();
-  InteractiveDetector* interactive_detector = InteractiveDetector::From(*this);
-  if (interactive_detector) {
-    interactive_detector->OnPageHiddenChanged(hidden());
-  }
-  GetViewTransitions().DidChangeVisibilityState();
+  // BrowserOS: Suppress visibilitychange events to prevent tab-switch detection
+  // Still run internal bookkeeping for animations/fonts/transitions
+  if (IsPageVisible())
+    GetDocumentAnimations().MarkAnimationsCompositorPending();
+  // Note: canvas_font_cache_->PruneAll() skipped since hidden() always returns false
+  InteractiveDetector* interactive_detector = InteractiveDetector::From(*this);
+  if (interactive_detector) {
+    interactive_detector->OnPageHiddenChanged(false);  // Always report visible
+  }
+  GetViewTransitions().DidChangeVisibilityState();
 }