diff --git a/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SUExport.h b/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SUExport.h
new file mode 100644
index 0000000000000..3e3f8a1646089
--- /dev/null
+++ b/third_party/sparkle/Sparkle.framework/Versions/B/Headers/SUExport.h
@@ -0,0 +1,18 @@
+//
+//  SUExport.h
+//  Sparkle
+//
+//  Created by Jake Petroules on 2014-08-23.
+//  Copyright (c) 2014 Sparkle Project. All rights reserved.
+//
+
+#ifndef SUEXPORT_H
+#define SUEXPORT_H
+
+#ifdef BUILDING_SPARKLE
+#define SU_EXPORT __attribute__((visibility("default")))
+#else
+#define SU_EXPORT
+#endif
+
+#endif
