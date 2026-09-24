# `semantic_action`

`semantic_action` uses local Laya browser checkpoint to choose and optionally execute browser operations from fresh accessibility snapshots.

## Setup

Install pinned runtime into preferred Python environment:

```sh
~/Development/v_env/bin/python -m pip install -r packages/browseros-agent/packages/browser-mcp/python/requirements-laya.txt
```

Interpreter discovery: `BROWSEROS_LAYA_PYTHON`, nearest BrowserOS `.venv`/`venv`, `~/Development/v_env`, then `python3`. Optional `BROWSEROS_LAYA_DEVICE` selects Torch device. First request downloads pinned `cklxx/laya-browser/v10s` checkpoint (~614 MiB).

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
}
```

Laya cannot generate arbitrary text. Pass `text` when goal may need `TYPE_TEXT` or `SELECT`. Without it, tool pauses with `needs_text` before page mutation.

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

1. Capture fresh accessibility snapshot and BrowserOS refs.
2. Filter goal-relevant page text to 1,500 characters.
3. Build Laya choice questions for operation and each available target kind, with up to 64 target criteria.
4. Send one request to persistent `laya_service.py` subprocess.
5. Validate answer IDs and probability distributions.
6. Multiply operation and target probabilities for effective confidence.
7. Execute safe BrowserOS input primitive, settle, and repeat.

URLs omit query/fragment. Labels are capped. Page content and labels are explicitly untrusted. Existing stale-ref handling remains authoritative.

## Testing

```sh
cd packages/browseros-agent
~/Development/v_env/bin/python -m unittest packages/browser-mcp/python/test_laya_service.py
bun test packages/browser-mcp/src/tools/laya-client.test.ts   packages/browser-mcp/src/tools/semantic-action.test.ts   packages/browser-mcp/src/tools/semantic-action.integration.test.ts
bun run --filter @browseros/browser-mcp typecheck
```

See [`docs/laya-scorer-service.md`](../../../../../docs/laya-scorer-service.md) for model/protocol details.
