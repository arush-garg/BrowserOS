diff --git a/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUGentleUserDriverReminders.h b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUGentleUserDriverReminders.h
new file mode 100644
index 0000000000000..a509e0e07c0a8
--- /dev/null
+++ b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUGentleUserDriverReminders.h
@@ -0,0 +1,22 @@
+//
+//  SPUGentleUserDriverReminders.h
+//  Sparkle
+//
+//  Copyright © 2022 Sparkle Project. All rights reserved.
+//
+
+#ifndef SPUGentleUserDriverReminders_h
+#define SPUGentleUserDriverReminders_h
+
+/**
+ A private protocol for user drivers implementing gentle scheduled reminders
+ */
+@protocol SPUGentleUserDriverReminders
+
+- (void)logGentleScheduledUpdateReminderWarningIfNeeded;
+
+- (void)resetTimeSinceOpportuneUpdateNotice;
+
+@end
+
+#endif /* SPUGentleUserDriverReminders_h */
