diff --git a/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SUAppcastItem+Private.h b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SUAppcastItem+Private.h
new file mode 100644
index 0000000000000..ab49b4178fcaa
--- /dev/null
+++ b/third_party/sparkle/Sparkle.framework/Versions/B/PrivateHeaders/SUAppcastItem+Private.h
@@ -0,0 +1,40 @@
+//
+//  SUAppcastItem+Private.h
+//  Sparkle
+//
+//  Created by Mayur Pawashe on 4/30/21.
+//  Copyright © 2021 Sparkle Project. All rights reserved.
+//
+
+#ifndef SUAppcastItem_Private_h
+#define SUAppcastItem_Private_h
+
+#import <Foundation/Foundation.h>
+#import <Sparkle/SUAppcastItem.h>
+
+NS_ASSUME_NONNULL_BEGIN
+
+// Available in SPUAppcastItemStateResolver.h (a private exposed header)
+@class SPUAppcastItemStateResolver;
+@class SUSignatures;
+
+@interface SUAppcastItem (Private) <NSSecureCoding>
+
+/**
+ Initializes with data from a dictionary provided by the RSS class and state resolver
+
+ This initializer method is intended to be marked "private" and discouraged from public usage.
+ This method is available however. Talk to us to describe your use case and if you need to construct appcast items yourself.
+ */
+- (nullable instancetype)initWithDictionary:(NSDictionary *)dict relativeToURL:(NSURL * _Nullable)appcastURL stateResolver:(SPUAppcastItemStateResolver *)stateResolver failureReason:(NSString * _Nullable __autoreleasing *_Nullable)error;
+
+/**
+ The EdDSA and DSA signatures along with their statuses.
+ */
+@property (readonly, nonatomic, nullable) SUSignatures *signatures;
+
+@end
+
+NS_ASSUME_NONNULL_END
+
+#endif /* SUAppcastItem_Private_h */
