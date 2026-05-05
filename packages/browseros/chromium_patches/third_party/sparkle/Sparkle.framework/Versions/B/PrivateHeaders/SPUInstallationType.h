diff --git a/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUInstallationType.h b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUInstallationType.h
new file mode 100644
index 0000000000000..2c6e5561954fb
--- /dev/null
+++ b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SPUInstallationType.h
@@ -0,0 +1,19 @@
+//
+//  SPUInstallationType.h
+//  Sparkle
+//
+//  Created by Mayur Pawashe on 7/24/16.
+//  Copyright © 2016 Sparkle Project. All rights reserved.
+//
+
+#ifndef SPUInstallationType_h
+#define SPUInstallationType_h
+
+#define SPUInstallationTypeApplication @"application" // the default installation type for ordinary application updates
+#define SPUInstallationTypeGuidedPackage @"package" // the preferred installation type for package installations
+#define SPUInstallationTypeInteractivePackage @"interactive-package" // the deprecated installation type; use guided package instead
+
+#define SPUInstallationTypesArray (@[SPUInstallationTypeApplication, SPUInstallationTypeGuidedPackage, SPUInstallationTypeInteractivePackage])
+#define SPUValidInstallationType(x) ((x != nil) && [SPUInstallationTypesArray containsObject:(NSString * _Nonnull)x])
+
+#endif /* SPUInstallationType_h */
