diff --git a/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SUVersionComparisonProtocol.h b/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SUVersionComparisonProtocol.h
new file mode 100644
index 0000000000000..8d22d7a9f90d7
--- /dev/null
+++ b/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SUVersionComparisonProtocol.h
@@ -0,0 +1,42 @@
+//
+//  SUVersionComparisonProtocol.h
+//  Sparkle
+//
+//  Created by Andy Matuschak on 12/21/07.
+//  Copyright 2007 Andy Matuschak. All rights reserved.
+//
+
+#ifndef SUVERSIONCOMPARISONPROTOCOL_H
+#define SUVERSIONCOMPARISONPROTOCOL_H
+
+#import <Foundation/Foundation.h>
+
+#if defined(BUILDING_SPARKLE_SOURCES_EXTERNALLY)
+// Ignore incorrect warning
+#pragma clang diagnostic push
+#pragma clang diagnostic ignored "-Wquoted-include-in-framework-header"
+#import "SUExport.h"
+#pragma clang diagnostic pop
+#else
+#import <Sparkle/SUExport.h>
+#endif
+
+NS_ASSUME_NONNULL_BEGIN
+
+/**
+    Provides version comparison facilities for Sparkle.
+*/
+@protocol SUVersionComparison
+
+/**
+    An abstract method to compare two version strings.
+
+    Should return NSOrderedAscending if b > a, NSOrderedDescending if b < a,
+    and NSOrderedSame if they are equivalent.
+*/
+- (NSComparisonResult)compareVersion:(NSString *)versionA toVersion:(NSString *)versionB; // *** MAY BE CALLED ON NON-MAIN THREAD!
+
+@end
+
+NS_ASSUME_NONNULL_END
+#endif
