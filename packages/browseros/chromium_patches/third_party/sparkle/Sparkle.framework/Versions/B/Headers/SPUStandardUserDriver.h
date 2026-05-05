diff --git a/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SPUStandardUserDriver.h b/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SPUStandardUserDriver.h
new file mode 100644
index 0000000000000..f8d5ef09ad895
--- /dev/null
+++ b/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SPUStandardUserDriver.h
@@ -0,0 +1,47 @@
+//
+//  SPUStandardUserDriver.h
+//  Sparkle
+//
+//  Created by Mayur Pawashe on 2/14/16.
+//  Copyright © 2016 Sparkle Project. All rights reserved.
+//
+
+#import <Foundation/Foundation.h>
+
+#if defined(BUILDING_SPARKLE_SOURCES_EXTERNALLY)
+// Ignore incorrect warning
+#pragma clang diagnostic push
+#pragma clang diagnostic ignored "-Wquoted-include-in-framework-header"
+#import "SPUUserDriver.h"
+#import "SUExport.h"
+#pragma clang diagnostic pop
+#else
+#import <Sparkle/SPUUserDriver.h>
+#import <Sparkle/SUExport.h>
+#endif
+
+NS_ASSUME_NONNULL_BEGIN
+
+@protocol SPUStandardUserDriverDelegate;
+
+/**
+ Sparkle's standard built-in user driver for updater interactions
+ */
+SU_EXPORT @interface SPUStandardUserDriver : NSObject <SPUUserDriver>
+
+/**
+ Initializes a Sparkle's standard user driver for user update interactions
+ 
+ @param hostBundle The target bundle of the host that is being updated.
+ @param delegate The optional delegate to this user driver.
+ */
+- (instancetype)initWithHostBundle:(NSBundle *)hostBundle delegate:(nullable id<SPUStandardUserDriverDelegate>)delegate;
+
+/**
+ Use initWithHostBundle:delegate: instead.
+ */
+- (instancetype)init NS_UNAVAILABLE;
+
+@end
+
+NS_ASSUME_NONNULL_END
