### 2026-05-21 LLM Retry/Fallback Middleware

#### Architecture
- Server retry middleware lives in `packages/browseros-agent/apps/server/src/agent/model-retry.ts` and wraps AI SDK `LanguageModelV3` `doGenerate`/`doStream` calls.
- Policy is same-model retry, same-model retry after fixed backoff, then random fallback provider; fallback provider becomes sticky after success.
- `ResolvedAgentConfig.gatewayProviders` carries fallback provider configs; `ai-sdk-agent.ts` wraps v3 models only.

#### Testing Notes
- AI SDK v3 tool tests must pass a `ToolExecutionOptions` object with at least `toolCallId` and `messages`; bare `{}` casts fail `tsc`.
- `LanguageModelV3.doGenerate`/`doStream` return `PromiseLike`, so retry helpers should accept `PromiseLike<T>` operations.

### 2026-05-13 BrowserOS Agent Error Resolution

#### ✅ Fixed Issues
- Removed invalid `this.provider` reference in `convertToOpenAICompatibleChatMessages`
- Replaced with provider-agnostic `omitReasoningContent`
- Implemented 3-tier retry logic for parsing failures: same-model → fallback → failure

#### 🔄 Next Steps
- Add retry logic to `llm-client.ts`
- Add stream parsing guards to `compaction.ts`

#### 🧪 Validation
- Build successful: `bun run build:agent:dev`
- Dev server test showed retry logic activates with:
  `[openai-compatible] doGenerate attempt #2`

### 2026-05-13 Per-Tab Provider Selection Inheritance

#### Architecture
- **Per-tab provider selection** stored in `chatTargetSelectionStorage` (`local:chatTargetSelectionMap`) — `Record<string, SidepanelChatTargetSelection>` keyed by tab ID string
- `useChatRefs` loads/watches per-tab selection via `loadSidepanelChatTargetSelection` / `chatTargetSelectionStorage.watch`
- `ChatSessionProvider` tracks `activeTabId` via `chrome.tabs.onActivated` and passes it to `useChatSession` → `useChatRefs`
- `persistSidepanelChatTargetSelection` writes to `chrome.storage.local` via `@wxt-dev/storage`
- Background script (`entrypoints/background/index.ts`) already cleans up `selectedTextStorage` on `chrome.tabs.onRemoved`

#### ✅ Completed
- Added `chrome.tabs.onCreated` listener in background script to copy provider selection from opener tab to new tab (covers `window.open`, ctrl+click, etc.)
- Import: `chatTargetSelectionStorage` from `@/entrypoints/sidepanel/index/sidepanel-chat-targets`

#### 🔄 Still Needed
- **Agent-created tabs** (via `new_page` tool on server): server has no access to `chrome.storage.local`. Need a messaging path (e.g. `sendServerMessage`-style protocol or SSE event) for the server to notify the extension background to copy the selection from the origin tab to the new tab's Chrome tab ID
- **Tab cleanup**: `chatTargetSelectionStorage` entries for closed tabs are never cleaned up (unlike `selectedTextStorage`). Should add cleanup in the existing `chrome.tabs.onRemoved` listener

#### Key Files
- `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/sidepanel-chat-targets.ts` — storage, persist/load, resolve logic
- `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/useChatRefs.ts` — React hook wiring per-tab selection to chat session
- `packages/browseros-agent/apps/agent/entrypoints/sidepanel/layout/ChatSessionContext.tsx` — `useActiveTabId` + `ChatSessionProvider`
- `packages/browseros-agent/apps/agent/entrypoints/background/index.ts` — background listeners (onRemoved, onCreated)
- `packages/browseros-agent/apps/server/src/tools/navigation.ts` — `new_page` tool (passes `originPageId` for tab grouping)
- `packages/browseros-agent/apps/server/src/browser/browser.ts` — `newPage()` method, `pages` Map (pageId→tabId mapping)