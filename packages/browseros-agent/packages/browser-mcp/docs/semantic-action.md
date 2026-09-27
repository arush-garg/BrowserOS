# `semantic_action`

`semantic_action` uses local OpenJev browser checkpoint (Qwen3.5 NLI) to choose and optionally execute browser operations from fresh accessibility snapshots plus a viewport screenshot.

## Setup

Install pinned runtime into preferred Python environment:

```sh
~/Development/v_env/bin/python -m pip install -r packages/browseros-agent/packages/browser-mcp/python/requirements-openjev.txt
```

Interpreter discovery: `BROWSEROS_OPENJEV_PYTHON`, nearest BrowserOS `.venv`/`venv`, `~/Development/v_env`, then `python3`. Optional `BROWSEROS_OPENJEV_DEVICE` selects Torch device. Optional `BROWSEROS_OPENJEV_SUBFOLDER` selects model variant (e.g., `qwen3.5-0.8b-nli-v5`, `qwen3.5-2b-nli-v5`, `qwen3.5-4b-nli-v5`). First request downloads pinned `AlexWortega/openjev` checkpoint (size varies by variant).

Screenshot knobs: `BROWSEROS_OPENJEV_IMAGE_MAX_PIXELS` (default `401408`, ≈400–512 image tokens) caps screenshot resolution; `BROWSEROS_OPENJEV_IMAGE_BATCH_SIZE` (default `16`) caps premise/hypothesis pairs per forward pass when an image is attached; `BROWSEROS_OPENJEV_PROCESSOR_REPO` (default `Qwen/Qwen3.5-2B`) supplies the Qwen image processor when the NLI subfolder ships none.

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
  screenshot?: boolean    // default true
}
```

With `screenshot` on, every decision attaches a fresh 1024x768-bounded JPEG of the viewport. Result `screenshot` reports `{ used, tokens?, reason? }`. Capture failures and checkpoints whose classification head cannot take `pixel_values` fall back to text-only scoring, and the summary says why.

OpenJev cannot generate arbitrary text. Pass `text` when goal may need `TYPE_TEXT` or `SELECT`. Without it, tool pauses with `needs_text` before that text/select step mutates the page.

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

1. Capture fresh accessibility snapshot and BrowserOS refs, plus a viewport JPEG.
2. Filter goal-relevant page text to 1,500 characters.
3. Build OpenJev choice questions for operation and each available target kind, with up to 64 target criteria.
4. Send one request (with base64 `image`) to persistent `openjev_service.py` subprocess. Service runs screenshot through the Qwen image processor, prefixes each premise with `<|vision_start|><|image_pad|>…<|vision_end|>`, and passes `pixel_values`/`image_grid_thw` to the model.
5. Validate answer IDs and probability distributions.
6. Multiply operation and target entailment probabilities for effective confidence.
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
