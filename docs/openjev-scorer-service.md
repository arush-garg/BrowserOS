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
- `image` is accepted for protocol compatibility but the text backend ignores it and reports `image: {used: false, reason}`. The default checkpoint has no vision weights: `mlx_lm`'s `qwen3_5` loader drops `vision_tower`/`model.visual` tensors during conversion, so all 924 tensors in `mlx--Qwen3.5-4B-4bit` are `language_model.*`. Image input would need an MLX VLM runtime plus a checkpoint converted with its vision tower.
- Page text and labels remain untrusted data; only the caller goal controls behavior.
- The model makes finite choices and cannot generate text. Pass `text` when a goal can require `TYPE_TEXT` or `SELECT`; otherwise the loop pauses with `needs_text` before that text/select step mutates the page.
- Loop stops on DONE, BLOCKED, low confidence, repeated no-progress action, error, or step limit.

## Question types (TypeSafe System One shapes)

All three TypeSafe primitives are served; each is lowered onto the same one-prefill constrained-choice scorer.

| `type` | `criteria` | Answer |
|---|---|---|
| `choice` | `{id: description \| object \| null}` (≤64) | `choice`, `confidence`, `probabilities` |
| `score` | ordered array of 2–10 levels (string or `{what, examples}`) | `score` (expected level), `confidence`, `legend`, `probabilities` |
| `noul` | optional `{true, false}` | `noul` = P(yes) |

`confidence` follows TypeSafe's formulas (Choice: `(p_max − 1/n)/(1 − 1/n)`; Score: 1 − spread around the top level ÷ even spread). `state` may be a string, a BrowserOS page object (`{page, recent_actions}`, browser-action layout), or any other object/array, which is serialized whole into a neutral `INPUT/OPTIONS` prompt (earlier versions silently dropped non-`page` objects).

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

## HTTP endpoint (default): OpenJev router on 127.0.0.1:11435

`semantic_action` talks HTTP to one shared decision endpoint instead of owning a subprocess. The server is the
OpenJev router (`~/Development/openjev-client`, launchd `com.browseros.openjev`, launcher `~/bin/openjev-serve`).
It imports `openjev_service.py` from this directory and runs the MLX model in-process as its first text
backend, falling back to Cloudflare Workers AI `clef-flash`, then OpenRouter `inception/mercury-decide:free`.
Screenshots go to those two vision-capable decision models, because the local checkpoint has no vision weights.
The model loads on the first local request and unloads after `OPENJEV_LOCAL_IDLE_SECONDS` (default 120) idle.

```sh
# POST /v1/systemone {state, questions, image?, model?} -> {model, backend, answers, usage, routing, image?}
# GET  /health -> chains, per-backend configured/budget/cooldown/today's usage
curl -s 127.0.0.1:11435/health | python3 -m json.tool
launchctl kickstart -k gui/$(id -u)/com.browseros.openjev   # after editing openjev_service.py or the router
```

BrowserOS needs no configuration. Optional overrides:

```sh
export BROWSEROS_OPENJEV_URL=http://127.0.0.1:11435   # any /v1/systemone server (Ollama works too)
export BROWSEROS_OPENJEV_ROUTE=local                  # pin a router backend: local | cloudflare | openrouter
export BROWSEROS_OPENJEV_BACKEND=subprocess           # spawn openjev_service.py directly (offline debugging; second copy of weights)
export BROWSEROS_OPENJEV_MAX_OPTIONS=64
```

With `screenshot: true`, the image reaches a vision model and `vision.used` is `true`. Measured 2026-10-19:
a chart image got 4/4 questions right on Cloudflare and on OpenRouter, versus 0/4 with the local text model.

## Tests

```sh
cd packages/browseros-agent
~/Development/v_env/bin/python -m unittest packages/browser-mcp/python/test_openjev_service.py
bun test packages/browser-mcp/src/tools/openjev-client.test.ts packages/browser-mcp/src/tools/openjev-ollama-client.test.ts packages/browser-mcp/src/tools/semantic-action.test.ts packages/browser-mcp/src/tools/semantic-action.integration.test.ts
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
- The HTTP server is the OpenJev router (local MLX in-process + cloud fallback); `openjev_http.py` was removed
- Chrome/CDP is an external dependency
- Documentation covers HTTP contract, lazy load + idle unload, ~/bin/openjev-serve, env selection, tests
- Parent handles launchd installation; do not commit local absolute-path plists