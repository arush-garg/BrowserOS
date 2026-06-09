# LLM Retry, Backoff, Fallback Design

## Context
Users report three issues in agent chat:
1) same-model retries never switch to a backup model,
2) chats do not recover after errors,
3) no time-based backoff for 429s.

We will implement a multi-tier retry policy with a fixed backoff and a random fallback provider selection that becomes sticky for the session.

## Goals
- Add a three-tier retry policy for all retryable errors.
- Add fixed backoff delay for the second tier.
- Randomly choose a backup provider from the available provider pool and stick to it for the rest of the session.
- Ensure chat sessions can recover after errors without manual resets.
- Log tier transitions and delays for observability.

## Non-goals
- Adding new UI features (optional retry button wiring is not required).
- Changing tool behavior or agent prompt content.
- Introducing dynamic backoff based on Retry-After headers.

## Current Behavior
- The AI SDK retries parsing errors only; non-parse retryable errors (like 429) do not trigger retries.
- There is no provider-level fallback across the general model stack.
- The gateway marks CREDITS_EXHAUSTED as non-retryable, which prevents retries in the SDK.

## Design

### Retry Policy (All Retryable Errors)
Each request uses three tiers, in order:
1) Tier 1: retry once on the same model with no delay.
2) Tier 2: retry once on the same model after a fixed 1s delay.
3) Tier 3: retry once on a fallback provider (no backoff).

If all tiers fail:
- Return the final error and append: "No backup providers configured" if no fallback pool exists.

### Retryable Error Classification
Treat an error as retryable if any of these are true:
- The error is an API call error with isRetryable === true.
- The error status is 408, 429, or any 5xx.
- The error is a network fetch failure (eg. "fetch failed", "Failed to fetch").

For BrowserOS gateway errors, CREDITS_EXHAUSTED is treated the same as other 429 errors.

### Fixed Backoff Schedule
- Use a fixed 1000ms delay for Tier 2.
- Tier 1 and Tier 3 do not wait.

### Fallback Provider Selection
- Only used when multiple providers are available (BrowserOS gateway config).
- Randomly select from the available provider pool excluding the current provider/model.
- The selected fallback provider becomes sticky for the session.
- If the fallback provider later fails for a retryable error, pick another random provider and stick to it (no limit on switches per session).

### Session and Chat Recovery
- The retry and fallback logic runs inside the model wrapper so a single request can recover without restarting the stream.
- Sessions keep their message history intact; no session reset is required.
- On subsequent user messages, the session continues with the sticky provider.

### Logging
Log each attempt with:
- tier name,
- attempt number,
- delay (if any),
- provider and model.

Log when the session switches providers and when no fallback providers are available.

## Data Flow

### Resolve LLM Config
- When provider is BrowserOS, resolve the gateway config and store the full provider list in the resolved config.
- Include the provider list in the agent config so retries/fallback can select a backup provider.

### Agent Creation
- Wrap the base LanguageModel with a retry/fallback middleware that implements the retry tiers.
- The middleware holds session-level state for the current (sticky) provider choice.
- When switching providers, create a new model using the existing provider factory and the selected provider config.

## Affected Files (Expected)
- packages/browseros-agent/apps/server/src/lib/clients/llm/config.ts (carry provider list from gateway).
- packages/browseros-agent/apps/server/src/lib/clients/llm/types.ts (extend ResolvedLLMConfig).
- packages/browseros-agent/apps/server/src/agent/types.ts (extend ResolvedAgentConfig).
- packages/browseros-agent/apps/server/src/agent/ai-sdk-agent.ts (wrap model with retry/fallback middleware).
- packages/browseros-agent/apps/server/src/agent/provider-factory.ts (support creating models from fallback configs).
- packages/browseros-agent/apps/server/src/lib/browseros-fetch.ts (treat CREDITS_EXHAUSTED as retryable; no isRetryable false).
- packages/browseros-agent/apps/server/src/api/services/chat-service.ts (no behavior change required; ensure errors do not poison session state).

## Testing Plan
- Unit tests for retry policy behavior (tier sequencing, backoff timing, fallback selection, no-backup error message).
- Unit tests for retryable error classification (429, 5xx, fetch errors, CREDITS_EXHAUSTED).
- Integration test for session stickiness and provider switching after failures.

## Open Questions
None.
