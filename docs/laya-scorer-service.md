# Local Laya semantic actions

The `semantic_action` browser MCP tool uses Laya's browser-tuned checkpoint to choose the next operation and target from a fresh BrowserOS accessibility snapshot. It can execute a bounded snapshot-predict-act loop or return one advisory decision with `execute: false`.

## Setup

BrowserOS searches from the current directory through its ancestors for `.venv` or `venv`, then tries `~/Development/v_env`, then `python3`. Install the pinned runtime in the selected environment:

```sh
~/Development/v_env/bin/python -m pip install -r   packages/browseros-agent/packages/browser-mcp/python/requirements-laya.txt
```

Override interpreter or Torch device when needed:

```sh
export BROWSEROS_LAYA_PYTHON="$HOME/Development/v_env/bin/python"
export BROWSEROS_LAYA_DEVICE="mps" # optional; auto-detected when unset
```

First request downloads `cklxx/laya-browser` checkpoint `v10s` at pinned revision `4219958196e2c566c141688c773e08da10c1ff3b` (about 614 MiB). Later requests reuse one resident Python process and loaded model.

## Behavior

- State contains sanitized URL, recent actions, and 1,500 goal-relevant page characters.
- Element descriptions live in Laya choice criteria, matching browser-checkpoint training format.
- One inference evaluates operation and target questions together.
- Effective confidence is operation probability multiplied by target probability.
- Page text and labels remain untrusted data; only caller goal controls behavior.
- Laya makes finite choices and cannot generate text. Pass `text` when a goal can require `TYPE_TEXT` or `SELECT`; otherwise loop pauses with `needs_text` before that text/select step mutates the page.
- Loop stops on DONE, BLOCKED, low confidence, repeated no-progress action, error, or step limit.

## JSONL protocol

Request:

```json
{"request_id":"request-1","state":{"page":{"url":"https://example.com","text":"..."}},"questions":{"operation":{"type":"choice","instructions":{"goal":"Submit form","rules":"..."},"criteria":{"CLICK":"Click a visible control","DONE":"Goal satisfied"}}}}
```

Response:

```json
{"request_id":"request-1","answers":{"operation":{"type":"choice","choice":"CLICK","probabilities":{"CLICK":0.8,"DONE":0.2}}},"usage":{"input_tokens":120,"output_tokens":0}}
```

Stdout is protocol-only. Diagnostics go to stderr.

## Tests

```sh
cd packages/browseros-agent
~/Development/v_env/bin/python -m unittest packages/browser-mcp/python/test_laya_service.py
bun test packages/browser-mcp/src/tools/laya-client.test.ts   packages/browser-mcp/src/tools/semantic-action.test.ts   packages/browser-mcp/src/tools/semantic-action.integration.test.ts
```
