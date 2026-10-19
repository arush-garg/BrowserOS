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
- `image` is accepted for protocol compatibility but the text backend ignores it and reports `image: {used: false, reason}`.
- Page text and labels remain untrusted data; only the caller goal controls behavior.
- The model makes finite choices and cannot generate text. Pass `text` when a goal can require `TYPE_TEXT` or `SELECT`; otherwise the loop pauses with `needs_text` before that text/select step mutates the page.
- Loop stops on DONE, BLOCKED, low confidence, repeated no-progress action, error, or step limit.

## JSONL protocol

Request:

```json
{"request_id":"request-1","state":{"page":{"url":"https://example.com","text":"..."},"recent_actions":[]},"questions":{"action":{"type":"choice","instructions":"<rules>\nGOAL: Submit form","criteria":{"CLICK:e3":"Click button \\"Submit\\\"","DONE":"Every requirement in the goal is visibly satisfied."}}}}
```

Response:

```json
{"request_id":"request-1","answers":{"action":{"type":"choice","choice":"CLICK:e3","probabilities":{"CLICK:e3":0.93,"DONE":0.07}}},"usage":{"input_tokens":812,"total_seconds":2.9}}
```

`image` is optional in both directions; `image.used: false` comes with a `reason`. Stdout is protocol-only. Diagnostics go to stderr as JSON events (`model_loaded`, `request_error`).

## HTTP endpoint (Jev / Ollama `/v1/systemone` contract)

The same model can be served over HTTP so that BrowserOS talks to a URL instead of owning a subprocess, and so the model behind the URL can be swapped (Ollama decision models, a remote Jev-compatible API) without a code change. The model loads on the first request and is unloaded after 30 s without traffic (`--idle-seconds`), so the ~3 GB footprint is only held while decisions are flowing. Cold request ≈ +3–8 s for the load.

```sh
openjev-serve                      # ~/bin launcher -> python/openjev_http.py, 127.0.0.1:11435
openjev-serve --idle-seconds 120   # keep warm longer; 0 = never unload; --preload loads at start
# POST /v1/systemone {model?, state, questions} -> {model, answers, usage}; GET /health
```

Point the server at it:

```sh
export BROWSEROS_OPENJEV_BACKEND=ollana                     # HTTP transport (openjev-ollama-client.ts)
export BROWSEROS_OPENJEV_OLLAMA_URL=http://127.0.0.1:11435  # or http://127.0.0.1:11434 for Ollama itself
export BROWSEROS_OPENJEV_OLLAMA_MODEL=openjev               # model name forwarded in the request
export BROWSEROS_OPENJEV_MAX_OPTIONS=64                     # lower to 24 for Ollama's tev1
export BROWSEROS_OPENJEV_MAX_STATE_TEXT=4000                # lower to ~1500 for tev1's 2048-token prompt cap
```

Measured (M4 Pro, 7 advisory goals): the HTTP path scores identically to the subprocess (7/7, median 6.6 s) because it is the same model; Ollama's `tev1:0.8b` was 5/7 at 0.8 s/decision but is capped at 24 criteria and 2048 prompt tokens, and `strands-decider` failed to load in Ollama 0.40.6 (`missing embedding weight`). Unset `BROWSEROS_OPENJEV_BACKEND` to return to the resident subprocess.

## Tests

```sh
cd packages/browseros-agent
~/Development/v_env/bin/python -m unittest packages/browser-mcp/python/test_openjev_service.py
bun test packages/browser-mcp/src/tools/openjev-client.test.ts   packages/browser-mcp/src/tools/semantic-action.test.ts   packages/browser-mcp/src/tools/semantic-action.integration.test.ts
```

## Jev Framework Documentation

### Memory Footprint Characteristics
- Cold start: ~16 MB
- Post-unload: ~378-396 MB  
- Warm state: ~2.8 GB
- Peak usage: ~6.3 GB

### Local Launchd Services
Parent installs local launchd labels:
- `com.browseros.openjev` (RunAtLoad/KeepAlive, logs ~/Library/Logs/BrowserOS)
- `com.browseros.dev-server` (RunAtLoad/KeepAlive, logs ~/Library/Logs/BrowserOS)

### BrowserOS Server Command
Exact NODE_ENV=development command:
```bash
/opt/homebrew/bin/bun --watch --env-file=.env.development src/index.ts --config ../../config.dev.json cwd apps/server
```

### Important Notes
- Compatible HTTP wrapper uses MLX (NOT Ollama serving model directly)
- Chrome/CDP is an external dependency
- Documentation covers HTTP contract, lazy load +30s idle unload, ~/bin/openjev-serve, env selection, tests
- Parent handles launchd installation; do not commit local absolute-path plists