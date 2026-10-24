# `semantic_action`

`semantic_action` uses a local instruct LLM (Qwen3.5-4B, 4-bit, run with `mlx_lm` on Apple silicon) to choose and optionally execute browser operations from fresh accessibility snapshots.

## Setup

Install the runtime into the preferred Python environment:

```sh
~/Development/v_env/bin/python -m pip install -r packages/browseros-agent/packages/browser-mcp/python/requirements-openjev.txt
```

Interpreter discovery: `BROWSEROS_OPENJEV_PYTHON`, nearest BrowserOS `.venv`/`venv`, `~/Development/v_env`, then `python3`.

Model: `BROWSEROS_OPENJEV_MODEL` (default `~/.cache/huggingface/hub/mlx--Qwen3.5-4B-4bit`) points at any mlx_lm-loadable chat model directory. Produce the default with `python -m mlx_lm convert --hf-path Qwen/Qwen3.5-4B --mlx-path ~/.cache/huggingface/hub/mlx--Qwen3.5-4B-4bit -q` (2.2 GB on disk, ~4–5 GB process footprint, ~3–7 s per decision on an M4 Pro). `BROWSEROS_OPENJEV_MAX_TOKENS` (default 3072) caps the prompt; page text is trimmed first. `BROWSEROS_OPENJEV_PREFILL_CHUNK` (default 512) bounds activation memory during prefill.

## Input

```ts
{
  page: number
  goal: string
  text?: string
  maxSteps?: number       // default 6, max 12
  execute?: boolean       // default true
  history?: Array<{
    operation: string
    targetRef?: string
    result?: string
  }>
  screenshot?: boolean    // default false; routed to a vision decision model by the OpenJev router
  success?: Predicate       // optional explicit postcondition for the complete goal. A model DONE decision is accepted only when this predicate matches; otherwise the loop continues or returns assertion_failed.
  assertTimeout?: number    // How long, in ms, to wait for `success` after a DONE decision (default 5000, max 30000)
}
```

Decisions use only the fresh accessibility snapshot and refs. `screenshot: true` still captures a JPEG and sends it, but the current text-only backend reports `{ used: false, reason }` in the result's `screenshot` field.

The model is constrained to choose one of the offered action ids; it never generates free text. Pass `text` when the goal may need `TYPE_TEXT` or `SELECT`. Without it, the tool pauses with `needs_text` before that text/select step mutates the page.

## Operations

- `CLICK`: click offered control/ref.
- `TYPE_TEXT`: focus target and type caller-provided `text`.
- `SELECT`: select caller-provided `text` value.
- `SCROLL_UP` / `SCROLL_DOWN`: scroll three notches.
- `WAIT`: hold until DOM stabilizes or timeout.
- `DONE`: goal visibly satisfied.
- `BLOCKED`: no offered operation can progress.

## Statuses

- `done`, `blocked`: model terminal decision.
- `uncertain`: effective confidence below 40%.
- `needs_text`: chosen text/select operation lacks literal value.
- `no_progress`: same action repeated on unchanged page.
- `max_steps`, `error`: bounded loop stopped.

## Architecture

1. Capture a fresh accessibility snapshot and BrowserOS refs.
2. Filter goal-relevant page text to 4,000 characters.
3. Build one choice question: decision rules + goal as instructions, and up to 64 criteria of the form `CLICK:e12` → `Click link "new"` (plus `SCROLL_UP`, `SCROLL_DOWN`, `WAIT`, `DONE`, `BLOCKED`).
4. Send one request to the OpenJev router at `127.0.0.1:11435` (which runs `openjev_service.py` in-process for text). The service renders one chat prompt (rules, URL, recent actions, page text, candidate list), prefills it once, and reads the answer by walking the token trie of the candidate ids with restricted, renormalised next-token distributions.
5. Validate the answer id and probability distribution (sums to 1 over the criteria).
6. Effective confidence is the chosen id's probability.
7. Execute safe BrowserOS input primitive, settle, and repeat.

URLs omit query/fragment. Labels are capped. Page content and labels are explicitly untrusted. Existing stale-ref handling remains authoritative.

## Testing

```sh
cd packages/browseros-agent
~/Development/v_env/bin/python -m unittest packages/browser-mcp/python/test_openjev_service.py
bun test packages/browser-mcp/src/tools/openjev-client.test.ts   packages/browser-mcp/src/tools/semantic-action.test.ts   packages/browser-mcp/src/tools/semantic-action.integration.test.ts
bun run --filter @browseros/browser-mcp typecheck
```

See [`docs/openjev-scorer-service.md`](../../../../../docs/openjev-scorer-service.md) for model/protocol details.
