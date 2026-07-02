// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/browseros/core/browseros_prefs.h"

#include "base/logging.h"
#include "base/values.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/actions/chrome_action_id.h"
#include "chrome/common/pref_names.h"
#include "components/pref_registry/pref_registry_syncable.h"
#include "components/prefs/pref_service.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/mojom/themes.mojom.h"

namespace browseros {

void RegisterProfilePrefs(user_prefs::PrefRegistrySyncable* registry) {
  // Toolbar visibility prefs
  registry->RegisterBooleanPref(prefs::kShowLLMChat, true);
  registry->RegisterBooleanPref(prefs::kShowLLMHub, true);
  registry->RegisterBooleanPref(prefs::kShowToolbarLabels, true);

  // Vertical tabs pref
  registry->RegisterBooleanPref(prefs::kVerticalTabsEnabled, true);

  // AI Provider prefs (profile-scoped)
  registry->RegisterStringPref(prefs::kProviders, "");
  registry->RegisterStringPref(prefs::kCustomProviders, "[]");
  registry->RegisterStringPref(prefs::kDefaultProviderId, "");

  // NTP focus pref
  registry->RegisterBooleanPref(prefs::kNtpFocusContent, false);
}

void RegisterLocalStatePrefs(PrefRegistrySimple* registry) {
  // AI Provider prefs in Local State so they are shared across profiles.
  registry->RegisterStringPref(prefs::kProviders, "");
  registry->RegisterStringPref(prefs::kCustomProviders, "[]");
  registry->RegisterStringPref(prefs::kDefaultProviderId, "");

  // Third-party LLM panel prefs (list + selected index) in Local State.
  registry->RegisterListPref("browseros.third_party_llm.providers",
                             base::Value::List());
  registry->RegisterIntegerPref("browseros.third_party_llm.selected_provider", 0);
}

// Copy-only, idempotent migration: if Local State lacks BrowserOS provider
// prefs but any loaded profile has them, copy the first profile value into
// Local State so prefs become shared across profiles.
void MigrateProviderPrefsIfNeeded() {
  PrefService* local_state = g_browser_process->local_state();
  if (!local_state) {
    VLOG(1) << "[browseros] No Local State available for migration";
    return;
  }

  // If Local State already has a non-empty providers value (or pref not
  // registered), there's nothing to migrate.
  if (!local_state->FindPreference(prefs::kProviders) ||
      !local_state->GetString(prefs::kProviders).empty()) {
    VLOG(1) << "[browseros] Local State providers present or pref missing; skipping migration";
    return;
  }

  ProfileManager* profile_manager = g_browser_process->profile_manager();
  if (!profile_manager) {
    VLOG(1) << "[browseros] No ProfileManager available for prefs migration";
    return;
  }

  for (Profile* profile : profile_manager->GetLoadedProfiles()) {
    if (!profile || profile->IsOffTheRecord())
      continue;

    PrefService* prefs = profile->GetPrefs();
    if (!prefs)
      continue;

    const std::string value = prefs->GetString(prefs::kProviders);
    if (!value.empty()) {
      // Copy providers JSON string (copy-only; do not delete profile entries)
      local_state->SetString(prefs::kProviders, value);
      VLOG(1) << "[browseros] Migrated browseros.providers to Local State from profile: "
              << profile->GetPath().value();

      // Also copy custom providers and default id if present
      const std::string custom = prefs->GetString(prefs::kCustomProviders);
      if (!custom.empty())
        local_state->SetString(prefs::kCustomProviders, custom);
      const std::string def = prefs->GetString(prefs::kDefaultProviderId);
      if (!def.empty())
        local_state->SetString(prefs::kDefaultProviderId, def);

      // Copy third_party_llm providers list if profile has a list and Local
      // State list is empty.
      if (local_state->FindPreference("browseros.third_party_llm.providers") &&
          local_state->GetList("browseros.third_party_llm.providers").empty()) {
        const base::Value& list = prefs->GetValue("browseros.third_party_llm.providers");
        if (list.is_list() && !list.GetList().empty()) {
          local_state->Set("browseros.third_party_llm.providers", list.Clone());
        }
      }

      // Migration done (copy-only). Stop after first successful copy.
      return;
    }
  }

  VLOG(1) << "[browseros] No profile had provider prefs to migrate";
}

bool ShouldShowLLMChat(PrefService* pref_service) {
  return pref_service->GetBoolean(prefs::kShowLLMChat);
}

bool ShouldShowLLMHub(PrefService* pref_service) {
  return pref_service->GetBoolean(prefs::kShowLLMHub);
}

bool ShouldShowToolbarLabels(PrefService* pref_service) {
  return pref_service->GetBoolean(prefs::kShowToolbarLabels);
}

bool IsVerticalTabsEnabled(PrefService* pref_service) {
  return pref_service->GetBoolean(prefs::kVerticalTabsEnabled);
}

void SyncVerticalTabsPref(PrefService* pref_service) {
  const bool browseros_enabled =
      pref_service->GetBoolean(prefs::kVerticalTabsEnabled);
  const PrefService::Preference* upstream_pref =
      pref_service->FindPreference(::prefs::kVerticalTabsEnabled);
  if (upstream_pref && upstream_pref->IsDefaultValue()) {
    pref_service->SetBoolean(::prefs::kVerticalTabsEnabled, browseros_enabled);
  }
}

void SyncDefaultTheme(PrefService* pref_service) {
  const PrefService::Preference* user_color_pref =
      pref_service->FindPreference(::prefs::kUserColor);
  if (user_color_pref && user_color_pref->IsDefaultValue()) {
    pref_service->SetInteger(::prefs::kUserColor,
                             static_cast<int>(SkColorSetRGB(136, 136, 136)));
    pref_service->SetString(::prefs::kCurrentThemeID,
                            "user_color_theme_id");
    pref_service->SetInteger(
        ::prefs::kBrowserColorVariant,
        static_cast<int>(ui::mojom::BrowserColorVariant::kNeutral));
  }
}

bool IsNtpFocusContentEnabled(PrefService* pref_service) {
  return pref_service->GetBoolean(prefs::kNtpFocusContent);
}

const char* GetVisibilityPrefForAction(actions::ActionId id) {
  switch (id) {
    case kActionSidePanelShowThirdPartyLlm:
      return prefs::kShowLLMChat;
    case kActionSidePanelShowClashOfGpts:
      return prefs::kShowLLMHub;
    default:
      return nullptr;
  }
}

bool ShouldShowToolbarAction(actions::ActionId id, PrefService* pref_service) {
  const char* pref_key = GetVisibilityPrefForAction(id);
  if (!pref_key) {
    return true;  // No pref means always show
  }
  return pref_service->GetBoolean(pref_key);
}

}  // namespace browseros
	// AI Provider prefs
	registry->RegisterStringPref(prefs::kProviders, "");
	registry->RegisterStringPref(prefs::kCustomProviders, "[]");
	registry->RegisterStringPref(prefs::kDefaultProviderId, "");
}

void RegisterLocalStatePrefs(PrefRegistrySimple* registry) {
	// AI Provider prefs in Local State so they are shared across profiles.
	registry->RegisterStringPref(prefs::kProviders, "");
	registry->RegisterStringPref(prefs::kCustomProviders, "[]");
	registry->RegisterStringPref(prefs::kDefaultProviderId, "");
}

bool ShouldShowLLMChat(PrefService* pref_service) {
	return pref_service->GetBoolean(prefs::kShowLLMChat);
}
diff --git a/chrome/browser/browseros/core/browseros_prefs.cc b/chrome/browser/browseros/core/browseros_prefs.cc
new file mode 100644
index 0000000000000..c47c0fad94dda
--- /dev/null
+++ b/chrome/browser/browseros/core/browseros_prefs.cc
@@ -0,0 +1,106 @@
+// Copyright 2025 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#include "chrome/browser/browseros/core/browseros_prefs.h"
+
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/ui/actions/chrome_action_id.h"
+#include "chrome/common/pref_names.h"
+#include "components/pref_registry/pref_registry_syncable.h"
+#include "third_party/skia/include/core/SkColor.h"
+#include "ui/base/mojom/themes.mojom.h"
+
+namespace browseros {
+
+void RegisterProfilePrefs(user_prefs::PrefRegistrySyncable* registry) {
+  // Toolbar visibility prefs
+  registry->RegisterBooleanPref(prefs::kShowLLMChat, true);
+  registry->RegisterBooleanPref(prefs::kShowAssistant, true);
+  registry->RegisterBooleanPref(prefs::kShowToolbarLabels, true);
+
+  // Vertical tabs pref
+  registry->RegisterBooleanPref(prefs::kVerticalTabsEnabled, true);
+
+  // AI Provider prefs
+  registry->RegisterStringPref(prefs::kProviders, "");
+  registry->RegisterStringPref(prefs::kCustomProviders, "[]");
+  registry->RegisterStringPref(prefs::kDefaultProviderId, "");
+
+  // NTP focus pref
+  registry->RegisterBooleanPref(prefs::kNtpFocusContent, false);
+  registry->RegisterBooleanPref(prefs::kOnboardingCompleted, false);
+}
+
+bool ShouldShowLLMChat(PrefService* pref_service) {
+  return pref_service->GetBoolean(prefs::kShowLLMChat);
+}
+
+bool ShouldShowAssistant(PrefService* pref_service) {
+  return pref_service->GetBoolean(prefs::kShowAssistant);
+}
+
+bool ShouldShowToolbarLabels(PrefService* pref_service) {
+  return pref_service->GetBoolean(prefs::kShowToolbarLabels);
+}
+
+bool IsVerticalTabsEnabled(PrefService* pref_service) {
+  return pref_service->GetBoolean(prefs::kVerticalTabsEnabled);
+}
+
+void SyncVerticalTabsPref(PrefService* pref_service) {
+  const bool browseros_enabled =
+      pref_service->GetBoolean(prefs::kVerticalTabsEnabled);
+  const PrefService::Preference* upstream_pref =
+      pref_service->FindPreference(::prefs::kVerticalTabsEnabled);
+  if (upstream_pref && upstream_pref->IsDefaultValue()) {
+    pref_service->SetBoolean(::prefs::kVerticalTabsEnabled, browseros_enabled);
+  }
+}
+
+void SyncDefaultTheme(PrefService* pref_service) {
+  const PrefService::Preference* user_color_pref =
+      pref_service->FindPreference(::prefs::kUserColor);
+  if (user_color_pref && user_color_pref->IsDefaultValue()) {
+    pref_service->SetInteger(::prefs::kUserColor,
+                             static_cast<int>(SkColorSetRGB(136, 136, 136)));
+    pref_service->SetString(::prefs::kCurrentThemeID,
+                            "user_color_theme_id");
+    pref_service->SetInteger(
+        ::prefs::kBrowserColorVariant,
+        static_cast<int>(ui::mojom::BrowserColorVariant::kNeutral));
+  }
+}
+
+bool IsNtpFocusContentEnabled(PrefService* pref_service) {
+  return pref_service->GetBoolean(prefs::kNtpFocusContent);
+}
+
+const char* GetVisibilityPrefForAction(actions::ActionId id) {
+  switch (id) {
+    case kActionSidePanelShowThirdPartyLlm:
+      return prefs::kShowLLMChat;
+    case kActionBrowserOSAgent:
+      return prefs::kShowAssistant;
+    default:
+      return nullptr;
+  }
+}
+
+bool ShouldShowToolbarAction(actions::ActionId id, PrefService* pref_service) {
+  const char* pref_key = GetVisibilityPrefForAction(id);
+  if (!pref_key) {
+    return true;  // No pref means always show
+  }
+  return pref_service->GetBoolean(pref_key);
+}
+
+bool ShouldPinBrowserOSExtension(const std::string& extension_id,
+                                 PrefService* pref_service) {
+  if (extension_id == kAgentExtensionId) {
+    return ShouldShowAssistant(pref_service);
+  }
+  return IsBrowserOSPinnedExtension(extension_id);
+}
+
+}  // namespace browseros
