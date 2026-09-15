diff --git a/third_party/blink/renderer/core/page/focus_controller.cc b/third_party/blink/renderer/core/page/focus_controller.cc
index xxxxxxx..yyyyyyy 100644
--- a/third_party/blink/renderer/core/page/focus_controller.cc
+++ b/third_party/blink/renderer/core/page/focus_controller.cc
@@ -XXX,7 +XXX,11 @@ void FocusController::DispatchEventsOnWindowAndFocusedElement(
 void FocusController::DispatchEventsOnWindowAndFocusedElement(
     Document* document,
     Element* focused_element,
     bool focused) {
   if (page_->Paused())
     return;

+  // BrowserOS: Suppress window-level focus/blur events to prevent tab-switch detection
+  // Element-level events (blur/focus/focusin/focusout on elements) are still dispatched
+  // since those are needed for form interactions, but window.focus/window.blur are suppressed
+  if (focused) {
+    // When gaining focus, skip window focus event but still focus element
+    if (focused_element) {
+      focused_element->SetFocused(true);
+      DispatchFocusEvent(*document, *focused_element);
+    }
+    return;
+  } else {
+    // When losing focus, skip window blur event but still blur element
+    if (focused_element) {
+      focused_element->SetFocused(false);
+      DispatchBlurEvent(*document, *focused_element);
+    }
+    return;
+  }
+
   if (!focused) {
     // If we have a focused element we should dispatch blur on it before we blur
     // the window.
     if (focused_element) {
       focused_element->SetFocused(false);
       DispatchBlurEvent(*document, *focused_element);
     }
     // Dispatch blur on the window.
-    document->domWindow()->DispatchEvent(*Event::Create(event_type_names::kBlur));
   } else {
     // If we're focusing, dispatch focus on the window first.
-    document->domWindow()->DispatchEvent(*Event::Create(event_type_names::kFocus));
     if (focused_element) {
       focused_element->SetFocused(true);
       DispatchFocusEvent(*document, *focused_element);
     }
   }
 }
@@ -XXX,9 +XXX,13 @@ void FocusController::SetFocusedFrame(LocalFrame* frame) {
     // Also notify the old frame's owner element of blur interest
     old_frame->Owner()->HandleInterestForHoverOrFocus(
         Element::InterestSource::kBlur);
   }

-  old_frame->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kBlur));
+  // BrowserOS: Suppress window blur event on frame switch to prevent tab-switch detection
+  // old_frame->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kBlur));

   focused_frame_ = frame;

-  focused_frame_->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kFocus));
+  // BrowserOS: Suppress window focus event on frame switch to prevent tab-switch detection
+  // focused_frame_->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kFocus));

   focused_frame_->DidFocus();

@@ -XXX,7 +XXX,11 @@ void FocusController::SetFocusedFrame(LocalFrame* frame) {
     new_frame->Owner()->HandleInterestForHoverOrFocus(
         Element::InterestSource::kFocus);
   }

-  old_frame->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kBlur));
+  // BrowserOS: Suppress window blur event on frame switch to prevent tab-switch detection
+  // old_frame->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kBlur));

   focused_frame_ = frame;

-  focused_frame_->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kFocus));
+  // BrowserOS: Suppress window focus event on frame switch to prevent tab-switch detection
+  // focused_frame_->DomWindow()->DispatchEvent(*Event::Create(event_type_names::kFocus));
 }