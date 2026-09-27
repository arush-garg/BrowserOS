# Local OpenJev semantic actions

The `semantic_action` browser MCP tool uses OpenJev's browser-tuned checkpoint to choose the next operation and target from a fresh BrowserOS accessibility snapshot and viewport screenshot (the Qwen3.5 checkpoint is multimodal). It can execute a bounded snapshot-predict-act loop or return one advisory decision with `execute: false`.

## Setup

BrowserOS searches from the current directory through its ancestors for `.venv` or `venv`, then tries `~/Development/v_env`, then `python3`. Install the pinned runtime in the selected environment:

```sh
~/Development/v_env/bin/python -m pip install -r   packages/browseros-agent/packages/browser-mcp/python/requirements-openjev.txt
```

Override interpreter or Torch device when needed:

```sh
export BROWSEROS_OPENJEV_PYTHON="$HOME/Development/v_env/bin/python"
export BROWSEROS_OPENJEV_DEVICE="mps" # optional; auto-detected when unset
export BROWSEROS_OPENJEV_SUBFOLDER="qwen3.5-2b-nli-v5" # optional; 0.8b, 2b, or 4b variant
```

First request downloads `AlexWortega/openjev` checkpoint `qwen3.5-2b-nli-v5` at pinned revision `main` (about 4-8 GiB depending on variant). Later requests reuse one resident Python process and loaded model.

## Behavior

- State contains sanitized URL, recent actions, and goal-relevant page characters.
- A viewport JPEG rides along as `image` unless the caller passes `screenshot: false`. Image tokens are prepended to every premise; the text budget (512 tokens) is unchanged. If the checkpoint's classification class does not accept `pixel_values`, or the goal is so long that truncation would cut into image tokens, the service scores text-only and reports why.
- Element descriptions live in OpenJev choice criteria, matching NLI cross-encoder format.
- One inference evaluates operation and target questions together via NLI entailment scoring.
- Effective confidence is operation entailment probability multiplied by target entailment probability.
- Page text and labels remain untrusted data; only caller goal controls behavior.
- OpenJev makes finite choices and cannot generate text. Pass `text` when a goal can require `TYPE_TEXT` or `SELECT`; otherwise loop pauses with `needs_text` before that text/select step mutates the page.
- Loop stops on DONE, BLOCKED, low confidence, repeated no-progress action, error, or step limit.

## JSONL protocol

Request:

```json
{"request_id":"request-1","state":{"page":{"url":"https://example.com","text":"..."}},"questions":{"operation":{"type":"choice","instructions":{"goal":"Submit form","rules":"..."},"criteria":{"CLICK":"Click a visible control","DONE":"Goal satisfied"}}},"image":{"data":"<base64>","mime_type":"image/jpeg"}}
```

Response:

```json
{"request_id":"request-1","answers":{"operation":{"type":"choice","choice":"CLICK","probabilities":{"CLICK":0.8,"DONE":0.2}}},"image":{"used":true,"tokens":391}}
```

`image` is optional in both directions; `image.used: false` comes with a `reason`. Stdout is protocol-only. Diagnostics go to stderr.

## Tests

```sh
cd packages/browseros-agent
~/Development/v_env/bin/python -m unittest packages/browser-mcp/python/test_openjev_service.py
bun test packages/browser-mcp/src/tools/openjev-client.test.ts   packages/browser-mcp/src/tools/semantic-action.test.ts   packages/browser-mcp/src/tools/semantic-action.integration.test.ts
```
