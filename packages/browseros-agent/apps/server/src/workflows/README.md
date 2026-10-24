# Workflows / skills / model routing

Dependency-free, browser-free core for template workflows, persistent
context bundles, scheduled workflows, subagent fan-out, triggerable
per-site skills, and model routing with budgets.

## Modules

- `types.ts` — shared types.
- `templates.ts` — built-in templates (`market-map`, `competitor-readout`,
  `vendor-ranking`, `lead-scoring`), `templateToWorkflow` (slot
  substitution, missing-required-input errors), `trajectoryToWorkflow`
  ("turn this run into a workflow": step outputs are dropped, credential
  shaped inputs are dropped), `validateWorkflow`.
- `context.ts` — `createContextBundle` (exclusions always win over sites),
  `resolveRunContext` (deep-copied bundle reused verbatim on every run,
  so scheduled runs never re-prompt for criteria / sites / tone /
  destination).
- `scheduler.ts` — `nextRunAfter` (hourly / daily / weekly / custom
  interval, UTC-based with an optional timezone offset), `triggerMatches`
  (sheet-row / email / manual), `isDurableBlock` /
  `decideRunOutcome` (login / 2FA / bot-check / connector-reconnect
  becomes `paused-blocked` with the next run still scheduled, never a
  permanent failure), `InMemoryWorkflowRunStore` (newest-first, capped).
- `fanout.ts` — `shardList` (balanced shards, isolated `worker-N-tab`
  ids), `runFanOut` (parallel workers, deep-copied context per worker,
  one failing worker does not kill the others), `mergeResults`
  (synthesis: concatenate in worker order, deduplicate by caller key,
  first occurrence wins).
- `skills.ts` — `parseSkillMarkdown` (frontmatter: name, trigger
  always / keyword / task / site, keywords, tasks, sites),
  `selectSkills` (always-on first, then triggered, in input order;
  inactive skills are never injected), `renderSkillsPrompt`.
- `routing.ts` — `routeStep` (text → cheap model, vision → vision
  model), `BudgetTracker` (max steps / retries / tokens / cost / duration
  ceilings; abort is sticky and clean), `formatMeter` / `runMeterView`
  (the run-view data model: steps, tokens, cost, elapsed, progress %).
- `run-plan.ts` — `buildRunPlan` ties the above together for one run:
  validated workflow + reused context + active skills + routes + budgets.
  It never touches a browser tab.

## Deliberately not in this branch

- No credits system, no payment code (budgets are cost ceilings only).
- No `semantic_action` / OpenJev files (Hermes's scope, untouched).
- No live-browser execution, no sidepanel UI wiring, no persistent
  (DB) workflow store, no scheduler daemon. Those are wiring steps on
  top of this core: the agent loop calls `buildRunPlan`, executes
  `workflow.steps` / `runFanOut` workers against real tabs, records
  runs via `decideRunOutcome`, and the sidepanel renders
  `runMeterView`. Until that wiring lands, live-browser behaviour is
  untested here — this VM has no Chrome.

## Tests

`apps/server/tests/workflows/` — 30 tests, `bun test` (see test files).
