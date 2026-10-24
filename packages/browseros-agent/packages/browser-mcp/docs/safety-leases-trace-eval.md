# Safety / leases / trace / eval (`feat/safety-leases-trace-eval`)

Pure policy modules in `src/tools/`, plus one reachable MCP tool.
None of these modules drive the browser themselves — they gate,
record, or verify what the agent loop does.

## Modules

- `risk-gate.ts` — `gradeAction()` (LOW/MEDIUM/HIGH, unknown kinds
  fail closed to HIGH) and `ApprovalStore`. A HIGH action returns a
  pending approval card showing the exact payload; `consumeApproval`
  authorises exactly one action with exactly that payload, one-shot,
  and approvals expire (default 10 min).
- `cart-review.ts` — `CartReviewStore`: a review captures the full
  verified cart (merchant, items, variants, quantities, shipping,
  taxes, fees, exact total, currency, payment method, commitments,
  live-checked flag). Any material change supersedes the approval and
  forces a fresh review; a non-live-checked cart never authorises
  payment (a listing is not availability). `IrreversibleActionStore`:
  `submitted-not-confirmed` is terminal until an external
  reconciliation lookup resolves it — `recordAttempt` throws on any
  retry while the outcome is unknown, so double orders are a hard
  error, not a warning.
- `page-lease.ts` — canonical `PageLease` record
  `{ page, owner, acquiredAt, expiresAt, releasedAt? }` (same shape as
  the Rust ownership-claims layer, which should adopt this TTL
  semantics next — it is NOT rewritten in this branch).
  `MemoryPageLeaseStore` (default, used by `tabs`) and
  `FilePageLeaseStore` (JSON file + lock directory, so a second
  process or a restarted server sees leases and expiry frees them).
  Default TTL 30 min; `tabs acquire` accepts `ttlMs`.
- `task-trace.ts` — `TaskTrace`: append-only timeline of llm-turn,
  tool-decision (+confidence), ax-diff, screenshot (metadata only,
  never image bytes), cdp-error, approval, cart-review, lease, note.
  Credential-like fields are redacted at append time. Serialises to
  JSONL for replay/debugging.
- `eval-harness.ts` — deterministic eval: `FakeBrowser` + `runEvalCase`
  / `runEvalSuite` + golden cases (form-fill, multi-tab comparison,
  checkout-up-to-payment). Payment actions fail a case by design.
  `PageDriver` is the seam for a future live CDP driver.
- `safety.ts` — the `safety` MCP tool exposing gate/approve/reject/
  pending, cart_start/cart_approve/cart_check, trace_append/
  trace_render, registered in `registry.ts`. Stores are per-process,
  matching the MCP server model.

## What is NOT done here (gaps, by design)

- Live-browser tests: this VM has no Chrome, so only the fake-driver
  eval runs here. Live CDP runs, a real `PageDriver` adapter, and
  wiring the gate into the agent loop (so HIGH actions cannot bypass
  `safety gate`) are follow-ups, not claims.
- Rust lease unification beyond the canonical record shape + TTL
  semantics documented in `page-lease.ts`.
- `git rm --cached` for already-tracked `browseros-server.log*` /
  `.bun-build` files: `.gitignore` in this branch stops *new* copies
  being committed; tracked copies remain tracked (history preserved).
  Untracking them is a separate, reviewable step.
- `semantic_action` and its OpenJev clients are untouched — that is
  Hermes's scope (see the forbidden-files list in the branch task).
