diff --git a/components/os_crypt/common/keychain_password_mac.mm b/components/os_crypt/common/keychain_password_mac.mm
index f240dc22ee391..805f7e3f37a5b 100644
--- a/components/os_crypt/common/keychain_password_mac.mm
+++ b/components/os_crypt/common/keychain_password_mac.mm
@@ -18,6 +18,7 @@
 #include "base/strings/string_view_util.h"
 #include "base/types/expected.h"
 #include "build/branding_buildflags.h"
+#include "components/os_crypt/common/browseros_product_buildflags.h"
 #include "crypto/apple/keychain_v2.h"
 #include "third_party/abseil-cpp/absl/cleanup/cleanup.h"

@@ -38,8 +39,18 @@
 const char kDefaultServiceName[] = "Chrome Safe Storage";
 const char kDefaultAccountName[] = "Chrome";
 #else
-const char kDefaultServiceName[] = "Chromium Safe Storage";
-const char kDefaultAccountName[] = "Chromium";
+#if BUILDFLAG(BROWSEROS_PRODUCT_BROWSERCLAW)
+const char kDefaultServiceName[] = "BrowserClaw Safe Storage";
+const char kDefaultAccountName[] = "BrowserClaw";
+// Legacy Keychain names from before the BrowserClaw rebrand. Users who
+// ran BrowserOS before the rename will have their encryption key stored
+// under these names; GetPasswordImpl falls back to them before generating
+// a new random key that would orphan all saved passwords.
+const char kLegacyServiceName[] = "BrowserOS Safe Storage";
+const char kLegacyAccountName[] = "BrowserOS";
+#else
+const char kDefaultServiceName[] = "BrowserOS Safe Storage";
+const char kDefaultAccountName[] = "BrowserOS";
+#endif
 #endif

 // These values are persisted to logs. Entries should not be renumbered and
@@ -97,7 +108,22 @@
   if (password.error() == errSecItemNotFound) {
     uma_result = FindGenericPasswordResult::kPasswordNotFound;
+#if BUILDFLAG(BROWSEROS_PRODUCT_BROWSERCLAW)
+    // Migration shim: before generating a fresh random key (which would make
+    // all existing passwords unreadable), check for the legacy "BrowserOS
+    // Safe Storage" entry used by BrowserOS before the product was renamed.
+    auto legacy =
+        keychain.FindGenericPassword(kLegacyServiceName, kLegacyAccountName);
+    if (legacy.has_value()) {
+      std::string pw = std::string(base::as_string_view(*legacy));
+      // Store under the canonical name so subsequent launches skip this path.
+      OSStatus store_err =
+          keychain.AddGenericPassword(service_name, account_name,
+                                      base::as_byte_span(pw));
+      if (store_err == noErr) {
+        return pw;
+      }
+    }
+#endif
     return AddRandomPasswordToKeychain(keychain, service_name, account_name);
   }
