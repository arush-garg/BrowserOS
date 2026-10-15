# Local semantic action model service

The `semantic_action` browser MCP tool uses a local instruct LLM to choose the next operation and target from a fresh BrowserOS accessibility snapshot. It can execute a bounded snapshot-predict-act loop or return one advisory decision with `execute: false`.

## Setup

BrowserOS searches from the current directory through its ancestors for `.venv` or `venv`, then tries `~/Development/v_env`, then `python3`. Install the runtime in the selected environment:

```sh
~/Development/v_env/bin/python -m pip install -r   packages/browseros-agent/packages/browser-mcp/python/requirements-openjev.txt
```

Override interpreter, model, or budgets when needed:

```sh
export BROWSEROS_OPENJEV_PYTHON="$HOME/Development/v_env/bin/python"
export BROWSEROS_OPENJEV_MODEL="$HOME/.cache/huggingface/hub/mlx--Qwen3.5-4B-4bit" # any mlx_lm chat model dir
export BROWSEROS_OPENJEV_MAX_TOKENS=3072   # prompt cap; page text is trimmed first
export BROWSEROS_OPENJEV_PREFILL_CHUNK=512 # prefill slice; bounds activation memory
```

The default model is produced locally from the cached `Qwen/Qwen3.5-4B` weights:

```sh
python -m mlx_lm convert --hf-path Qwen/Qwen3.5-4B   --mlx-path ~/.cache/huggingface/hub/mlx--Qwen3.5-4B-4bit -q --q-bits 4 --q-group-size 64
```

It is 2.2 GB on disk, loads in ~2 s, and runs with a ~4–5 GB process footprint (the service sets a 6 GiB MLX memory limit). One decision over a ~2.4k-token prompt takes ~3–7 s on an M4 Pro. Requests reuse one resident Python process and loaded model.

## Behavior

- State contains sanitized URL, recent actions, and goal-relevant page characters (≤4,000).
- The service renders one chat prompt: the question instructions (decision rules + goal) as the system message; URL, recent actions, page text, and the candidate list (`id: description`) as the user message.
- One prefill per decision. The answer is read out by walking the token trie of the candidate ids: at each node the next-token logits are restricted to tokens that continue some candidate and renormalised. The probability of an id is the product along its path, so the probabilities form a true distribution over the criteria (sum to 1). Effective confidence is the chosen id's probability.
- `image` is accepted for protocol compatibility but the text backend ignores it and reports `image: {used: false, reason}`.
- Page text and labels remain untrusted data; only the caller goal controls behavior.
- The model makes finite choices and cannot generate text. Pass `text` when a goal can require `TYPE_TEXT` or `SELECT`; otherwise the loop pauses with `needs_text` before that text/select step mutates the page.
- Loop stops on DONE, BLOCKED, low confidence, repeated no-progress action, error, or step limit.

## JSONL protocol

Request:

```json
{"request_id":"request-1","state":{"page":{"url":"https://example.com","text":"..."},"recent_actions":[]},"questions":{"action":{"type":"choice","instructions":"<rules>\nGOAL: Submit form","criteria":{"CLICK:e3":"Click button \"Submit\"","DONE":"Every requirement in the goal is visibly satisfied."}}}}
```

Response:

```json
{"request_id":"request-1","answers":{"action":{"type":"choice","choice":"CLICK:e3","probabilities":{"CLICK:e3":0.93,"DONE":0.07}}},"usage":{"input_tokens":812,"total_seconds":2.9}}
```

`image` is optional in both directions; `image.used: false` comes with a `reason`. Stdout is protocol-only. Diagnostics go to stderr as JSON events (`model_loaded`, `request_error`).

## Tests

```sh
cd packages/browseros-agent
~/Development/v_env/bin/python -m unittest packages/browser-mcp/python/test_openjev_service.py
bun test packages/browser-mcp/src/tools/openjev-client.test.ts   packages/browser-mcp/src/tools/semantic-action.test.ts   packages/browser-mcp/src/tools/semantic-action.integration.test.ts
```
