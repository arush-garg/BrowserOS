diff --git a/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUUserAgent+Private.h b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUUserAgent+Private.h
new file mode 100644
index 0000000000000..392fccb40c365
--- /dev/null
+++ b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUUserAgent+Private.h
@@ -0,0 +1,29 @@
+//
+//  SPUUserAgent+Private.h
+//  Sparkle
+//
+//  Created by Mayur Pawashe on 11/12/21.
+//  Copyright © 2021 Sparkle Project. All rights reserved.
+//
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
+@class SUHost;
+
+SU_EXPORT NSString *SPUMakeUserAgentWithHost(SUHost *responsibleHost, NSString * _Nullable displayNameSuffix);
+
+SU_EXPORT NSString *SPUMakeUserAgentWithBundle(NSBundle *responsibleBundle, NSString * _Nullable displayNameSuffix);
+
+NS_ASSUME_NONNULL_END
