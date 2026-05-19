Tasksheet: Implement four new agent tools for BrowserOS
=====================================================

Overview
--------
This tasksheet describes how to implement four new tools for the BrowserOS agent runtime and how to wire them into the existing AI SDK agent. The goal is to add:

- Subagent spawning tool (`subagent_spawn`) — create and run subagents (LLM jobs) with selectable provider/model; support synchronous runs first and an async job pattern later.
- Code execution tool (`code_execute`) — run short JavaScript or Python snippets safely for reasoning/maths/processing.
- Web fetch tool (`web_fetch`) — perform a search and fetch the first N result page texts.
- Run App Script tool (`run_app_script`) — run Google Apps Script workflows for Google Docs, Sheets and Slides (via Klavis / Apps Script API or browser fallback).

Design Goals & Constraints
-------------------------
- Follow existing tool patterns: use `tool()` from `ai`, `zod` for input schemas, and `executeWithMetrics` / `toModelOutput` helpers from `packages/browseros-agent/apps/server/src/tools/filesystem/utils.ts`.
- Place non-browser tools in the same style as memory tools (clean standalone `createXxxTool()` functions exported from a build-toolset module).
- Integrate tool sets into `packages/browseros-agent/apps/server/src/agent/ai-sdk-agent.ts` by importing and spreading the returned ToolSet.
- Keep changes minimal and clearly scoped. Implement synchronous behaviors first, then provide an async job pattern for subagents.
- Respect compaction and context-window constraints: large tool outputs must be truncated and summarized using existing compaction utilities.

Where to edit / create files
----------------------------
Primary package and directories (all paths are relative to repository root):

- Tool implementations (new):
  - `packages/browseros-agent/apps/server/src/tools/custom/build-toolset.ts`  ← new file exporting the 4 tools
  - `packages/browseros-agent/apps/server/src/tools/custom/subagent.ts`     ← subagent tool implementation
  - `packages/browseros-agent/apps/server/src/tools/custom/code-exec.ts`   ← code-runner tool
  - `packages/browseros-agent/apps/server/src/tools/custom/web-fetch.ts`   ← search+fetch tool
  - `packages/browseros-agent/apps/server/src/tools/custom/run-app-script.ts` ← Google Apps Script tool

- Agent integration:
  - `packages/browseros-agent/apps/server/src/agent/ai-sdk-agent.ts` — import and include the new ToolSet in the tools aggregation and ensure chatMode rules still apply
  - `packages/browseros-agent/apps/server/src/agent/prompt.ts` — update `getCapabilities()`/capabilities section to list new tools
  - `packages/browseros-agent/apps/server/src/tools/tool-label-registry.ts` — add label formatters for `web_fetch`, `subagent_spawn`, `code_execute`, `run_app_script` (UI friendly)

- Support / clients:
  - `packages/browseros-agent/apps/server/src/lib/clients/klavis/apps-script-client.ts` — new client wrapper to call Klavis or Google Apps Script Execution API (recommended)

- Tests & docs:
  - `packages/browseros-agent/apps/server/src/tools/custom/__tests__/` — unit tests for each tool
  - Update `docs/` where relevant; add entry in `docs/` describing new tools and example inputs

Development patterns to reuse
----------------------------
- Look at `packages/browseros-agent/apps/server/src/tools/memory/write.ts` and `packages/browseros-agent/apps/server/src/tools/filesystem/bash.ts` for canonical patterns of `tool()` creation, `zod` schema usage, `executeWithMetrics()` wrapping, and `toModelOutput()` conversion.
- Use `createLanguageModel()` from `packages/browseros-agent/apps/server/src/agent/provider-factory.ts` when the tool must spin up an LLM for a chosen provider (subagent tool).
- For context/compaction use `reduceToolOutputs()` and `createCompactionPrepareStep()` in `packages/browseros-agent/apps/server/src/agent/compaction.ts` as references for truncation and summarization.

Detailed implementation notes (per tool)
--------------------------------------

1) Subagent spawning tool: `subagent_spawn`

Purpose
- Allow the main agent to request a subagent with a given instruction set and provider/model. The subagent runs a brief ToolLoopAgent-like session and returns the result.

API (input schema)
- `z.object({
    provider: z.string().optional(),    // provider id (e.g., 'openai', 'anthropic')
    model: z.string().optional(),       // model id (e.g., 'gpt-4o-mini')
    instructions: z.string(),           // system/instruction for subagent
    tools: z.array(z.string()).optional(), // allowlist of tools for the subagent
    maxSteps: z.number().int().optional().default(20),
    runMode: z.enum(['sync','async']).optional().default('sync')
  })`

Implementation steps
- File: `packages/browseros-agent/apps/server/src/tools/custom/subagent.ts`
  - Export `createSubagentTool()` returning `tool({ description, inputSchema, execute })`.
  - Inside `execute`:
    - Resolve provider/model via `createLanguageModel()` passing a `ResolvedAgentConfig` derived from `ctx.session` or tool params.
    - Create a small `ToolLoopAgent`-like invocation using the same `ToolLoopAgent` class used elsewhere (import from `ai` helpers in repo). Options:
      - Use the same `prepareStep`/`compaction` utilities to keep messages small.
      - Limit allowed tools to the passed `tools` allowlist.
    - For `runMode: 'sync'` call `generateText()` or `streamText()` with the created LM and the instruction, collect the final assistant result and return via `ToolResponse.text()`.
    - For `runMode: 'async'` implement a job store (in-memory `Map<string, Job>`) and spawn an async `streamText()` call:
      - Create job id and return a short ack containing `jobId` and polling endpoint option (or a complementary `subagent_get_result` tool to fetch results).
      - Also implement (optional) a `deliver_subagent_result(jobId, result)` internal helper that the agent runtime can call to inject the subagent's final result into the main agent's conversation (see Integration section below).

Important notes about parallel/delayed delivery
- The AI SDK `tool()` execute function is synchronous for a given step. To emulate a delayed tool result mid-run (like a deferred callback), implement two parts:
  1. `subagent_spawn` — creates job and starts subagent async worker (returns jobId immediately).
  2. `subagent_get_result` — separate tool that the main agent can call later to fetch and include the subagent's final output.

Later improvement (tight integration)
- For tighter UX (inject result mid-step without explicit poll), add a small runtime API in the server that can push messages into an agent's `experimental_context` or `pendingToolResults` map and update `prepareStep` to look for pending results and append them to the messages before each LLM call. This requires editing `ToolLoopAgent` initialization logic in `ai-sdk-agent.ts`.

2) Code execution tool: `code_execute`

Purpose
- Run short snippets of safe JavaScript or Python for calculation, data transformation, or simple text generation.

API (input schema)
- `z.object({
    language: z.enum(['javascript','python']),
    code: z.string(),
    timeoutSec: z.number().int().optional().default(5),
    sandboxMode: z.boolean().optional().default(true)
  })`

Implementation steps
- File: `packages/browseros-agent/apps/server/src/tools/custom/code-exec.ts`
  - Export `createCodeExecutionTool()`.
  - Implementation pattern:
    - Use `executeWithMetrics()` wrapper.
    - For `javascript`: use Bun/Node to run `node -e '...'` or run inside `vm` module for tighter sandboxing. Prefer the existing pattern in `bash.ts` using `Bun.spawn`/`child_process.spawn` but with strict `timeoutSec` and resource limits.
    - For `python`: run `python3 -c '...'` similarly via `Bun.spawn` or `child_process.spawn`.
    - Capture stdout/stderr, truncate to configured maxima (use `truncateTail()` helper pattern in `bash.ts`).
    - Return results through `toModelOutput()` so the agent sees `{ text, isError }`.

Security & safety
- Always sandbox unusual code. For JS prefer `vm` (Node's VM) with timeouts and memory limits when possible; otherwise require `sandboxMode=false` flag for dangerous execution.

3) Web fetch tool: `web_fetch`

Purpose
- Given a query and N, perform a search (Google/Brave) and return page text for the first N results.

API (input schema)
- `z.object({ query: z.string(), n: z.number().int().min(1).max(10).optional().default(3), engine: z.enum(['google','brave','duckduckgo']).optional().default('brave') })`

Implementation steps
- File: `packages/browseros-agent/apps/server/src/tools/custom/web-fetch.ts`
  - Export `createWebFetchTool()`.
  - Handler approach (preferred and reliable): use the `ctx.browser` (ToolContext) to open pages and run browser flows similar to existing browser tools:
    1. Create a new page/tab with `ctx.browser`.
    2. Navigate to search engine URL with the encoded query (e.g., `https://search.brave.com/search?q=...`).
    3. Use `evaluate_script`-style JS to extract top result links (title + href). Example evaluation snippet provided in code.
    4. For each top N URL: `navigate_page` → `get_page_content` (or use page.evaluate to extract visible text) and collect the results.
    5. Apply `reduceToolOutputs()` style truncation per result to avoid flooding the context; return a JSON structure: `{ results: [{title, url, textSnippet}], meta: {count, query} }` and a human summary text for agent consumption.

Alternative non-browser approach
- Use a search API (Brave Search / Google Custom Search / SerpAPI) if available. If using a paid API, put secrets into the same config place used by provider-factory and Klavis clients.

4) Run App Script tool: `run_app_script`

Purpose
- Execute Apps Script actions for Google Docs/Sheets/Slides. This can be implemented in two forms: server-side Apps Script Execution API (recommended) or client-side DOM/script injection fallback.

API (input schema)
- `z.object({
    app: z.enum(['docs','sheets','slides']),
    script: z.string(),             // Apps Script code body or function name to call
    scriptParams: z.any().optional(),
    runAs: z.string().optional()    // optional account/authz override
  })`

Implementation steps (recommended server-side via Klavis / API)
- Create `packages/browseros-agent/apps/server/src/lib/clients/klavis/apps-script-client.ts` with methods:
  - `runAppsScript(userId, scriptPayload)` — calls Klavis (or directly the Google Apps Script Execution API) using user's OAuth tokens and returns execution result.
  - Implement exponential retry and error parsing like other clients in `/lib/clients`.
- Tool implementation in `run-app-script.ts`
  - Export `createRunAppScriptTool()`.
  - In `execute`: forward the call to `apps-script-client.runAppsScript()` with appropriate `app` and `script` parameters.
  - Normalize returned data and return via `toModelOutput()`.

Fallback (browser-side) approach
- If no server API is available, implement a conservative DOM-based fallback in the tool handler that uses `ctx.browser` to open the target document and run limited DOM-manipulation JS via `page.evaluate()` to perform the requested change. This is fragile and requires the user to be authenticated in the browser session.

Integration steps (where to include the ToolSet)
------------------------------------------------
1. Create `packages/browseros-agent/apps/server/src/tools/custom/build-toolset.ts`:
   - Export `buildCustomToolSet(ctx?)` returning an object shaped like other ToolSet modules, e.g. `{ subagent_spawn: createSubagentTool(), code_execute: createCodeExecutionTool(), web_fetch: createWebFetchTool(), run_app_script: createRunAppScriptTool() }`.

2. Edit `packages/browseros-agent/apps/server/src/agent/ai-sdk-agent.ts`:
   - Import the new `buildCustomToolSet()`.
   - After `filesystemTools` / `memoryTools` aggregation, merge custom tools: `const tools = { ...browserTools, ...externalMcpTools, ...filesystemTools, ...memoryTools, ...customTools }`.
   - Respect `chatMode` restrictions if needed (e.g., don't enable `code_execute` in chat-only sessions).

3. Edit `packages/browseros-agent/apps/server/src/agent/prompt.ts`:
   - In `getCapabilities()` add the new tool short descriptions so the system prompt lists them under capabilities. Follow existing formatting conventions.

4. Edit `packages/browseros-agent/apps/server/src/tools/tool-label-registry.ts`:
   - Add label formatters for the tools for UI history: e.g. `web_fetch` prints `Fetched {n} results for “query”`, `subagent_spawn` prints `Launched subagent ({provider}/{model})`, `code_execute` prints `Executed code (language)`, `run_app_script` prints `Ran Apps Script on {app}`.

Context window & compaction guidance
-----------------------------------
- Tool outputs (especially `web_fetch` and `code_execute`) can produce large text. Use the existing `reduceToolOutputs()` function from `packages/browseros-agent/apps/server/src/agent/compaction.ts` when producing results. If your tool returns structured JSON with long `text` fields, include a short `summary` field (first ~1000 chars) and a `full` field stored in `experimental_context` or `toolOutputs` store to be retrieved later if needed.
- For `subagent_spawn`: only include the subagent summary in immediate tool output, and store full transcript in an internal store keyed by `jobId` to avoid filling the token window. Add a note in the returned tool output about where to fetch full logs (e.g., `subagent_get_result` or a server URL).

Testing & verification
----------------------
- Unit tests: add tests to `packages/browseros-agent/apps/server/src/tools/custom/__tests__` using the existing test harnesses. Mock `ctx.browser` and Klavis client responses.
- Manual test commands (developer): from repo root run:

```bash
cd packages/browseros-agent/apps/server
bun install
bun run build:dev
# run unit tests (repo test command depend on the project)
```

- Quick runtime tests:
  - Start the agent server and invoke a simple `code_execute` call to run `1+2` in Python and expect `3`.
  - Invoke `web_fetch` with `query='browseros agent'` and `n=2` and confirm two result entries with titles + snippets.
  - For `run_app_script` test, create a simple Apps Script that returns `Hello from Apps Script` and run via Klavis test user tokens.

Rollout suggestions
-------------------
- Implement tools in this order: `code_execute` (smallest), `web_fetch`, `subagent_spawn` (more complex), `run_app_script` (requires OAuth/Klavis work).
- Release each tool behind a feature flag or `toolApprovalConfig` requiring developer or admin approval before being available to end users.

Docs & examples to include
-------------------------
- Add `docs/tools/subagent.md`, `docs/tools/code-exec.md`, `docs/tools/web-fetch.md`, `docs/tools/run-app-script.md` with example tool input and expected outputs.
- Provide a short example agent session that uses `web_fetch` then `code_execute` to process the fetched text.

Open questions & future improvements
----------------------------------
- Do we want fully asynchronous subagent results injected automatically into the main agent's step stream (requires runtime message injection; see integration suggestions)?
- For `run_app_script`, which auth model will we use in production (Klavis vs direct Google OAuth server-to-server)? Choose the method that matches the rest of the repo's Klavis usage.
- Consider adding a server-side job queue (Redis/DB) for long-running subagents.

Appendix: Quick code skeletons
----------------------------
- See the repository examples for `tool()` usage: `packages/browseros-agent/apps/server/src/tools/memory/write.ts` and `packages/browseros-agent/apps/server/src/tools/filesystem/bash.ts`.

Example skeleton for `createCodeExecutionTool()` (pseudo):

```ts
export function createCodeExecutionTool() {
  return tool({
    description: 'Run JavaScript or Python code (short, sandboxed)',
    inputSchema: z.object({ language: z.enum(['javascript','python']), code: z.string(), timeoutSec: z.number().optional() }),
    execute: (params, ctx, response) => executeWithMetrics('code_execute', async () => {
      // spawn child process or run VM, gather stdout/stderr
      return toModelOutput({ text: outputText, isError });
    })
  })
}
```

Delivery checklist (developer)
------------------------------
 - [ ] Create `tools/custom/*` files and `build-toolset.ts` exporting the ToolSet
 - [ ] Implement `subagent_spawn` synchronous flow and job store for async mode
 - [ ] Implement `code_execute` using safe sandboxing
 - [ ] Implement `web_fetch` using browser context and `ctx.browser`
 - [ ] Implement `run_app_script` using `apps-script-client` (Klavis) and build fallback
 - [ ] Wire ToolSet into `ai-sdk-agent.ts` and add capability strings to `prompt.ts`
 - [ ] Add label formatters to `tool-label-registry.ts`
 - [ ] Add tests, docs, and run `bun run build:dev` to verify

If you want, I can now scaffold the files (basic exports and skeletons) in the repo so you can iterate on them; tell me to scaffold and I'll create the file stubs next.

-- end of tasksheet
