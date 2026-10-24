#!/usr/bin/env python3
"""Persistent JSONL adapter for the local OpenJev decision model (MLX).

Protocol (one JSON object per line on stdin/stdout, JSON log events on stderr):
  request:  {request_id, state: str | object | array, questions: {<name>: <question>},
             image?: {data, mime_type}}
            question = {type: "choice", instructions, criteria: {<id>: <description|object|null>}}
                     | {type: "score",  instructions, criteria: [<level>, ...]}   (2-10 levels, low->high)
                     | {type: "noul",   instructions, criteria?: {true, false}}
            BrowserOS page states use {page: {url, title, text}, recent_actions}; any other
            state is passed to the model whole.
  response: {request_id, answers: {<name>: <answer>}, usage: {input_tokens, total_seconds},
             image?: {used, reason}}  or  {request_id, error, error_kind}
            answer = {type: "choice", choice, confidence, probabilities}
                   | {type: "score", score, confidence, legend, probabilities}
                   | {type: "noul", noul}
            (TypeSafe System One answer shapes; confidence uses TypeSafe's formulas.)

Backend: an mlx_lm chat model (default Qwen3.5-4B 4-bit, override with
BROWSEROS_OPENJEV_MODEL). Each question costs ONE prefill over the prompt (goal
rules + page text + candidate list). The answer is then read out of the model
by walking the token trie of the candidate ids: at every trie node the next-token
logits are restricted to the tokens that continue some candidate id and
renormalised, so the model can only ever "say" a valid id. The probability of an
id is the product of those restricted probabilities along its token path, which
makes the probabilities a true distribution over the candidates (sum to 1).
Screenshots are accepted but not used: the text backend reports image.used=false.
"""

from __future__ import annotations

import copy
import gc
import json
import os
import signal
import sys
import time
from contextlib import redirect_stdout
from typing import Any, Callable

MODEL_PATH = os.path.expanduser(
    os.environ.get("BROWSEROS_OPENJEV_MODEL")
    or "~/.cache/huggingface/hub/mlx--Qwen3.5-4B-4bit"
)
MAX_PROMPT_TOKENS = int(os.environ.get("BROWSEROS_OPENJEV_MAX_TOKENS") or 3072)
MEMORY_LIMIT_BYTES = 6 * 1024**3
# Prefill runs in slices so activation memory stays bounded; a 2.4k-token prompt
# peaks ~1.2 GB lower at 512 than in one pass, with no measurable slowdown.
PREFILL_CHUNK_TOKENS = int(os.environ.get("BROWSEROS_OPENJEV_PREFILL_CHUNK") or 512)
MAX_STATE_CHARS = 50_000
MAX_QUESTIONS = 8
MAX_OPTIONS = 64
QUESTION_TYPES = ("choice", "score", "noul")
MIN_SCORE_LEVELS = 2
MAX_SCORE_LEVELS = 10
MAX_IMAGE_BASE64_CHARS = 8_000_000
IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
IMAGE_UNSUPPORTED_REASON = "vision not supported by mlx text backend"
END_OF_TURN = "<|im_end|>"
# Page text is cut by tokens until the whole prompt fits; each pass overshoots a
# little so the loop converges even when decoding changes token boundaries.
TRUNCATION_MARGIN_TOKENS = 16
TRUNCATION_MAX_PASSES = 4

_model: Any = None
_tokenizer: Any = None
_stopping = False


def log(event: str, **fields: Any) -> None:
    print(
        json.dumps({"event": event, **fields}, ensure_ascii=False),
        file=sys.stderr,
        flush=True,
    )


def load() -> tuple[Any, Any]:
    global _model, _tokenizer
    if _model is not None and _tokenizer is not None:
        return _model, _tokenizer

    started = time.perf_counter()
    try:
        import mlx.core as mx
        from mlx_lm import load as mlx_load
    except ImportError as error:
        raise RuntimeError(
            "OpenJev dependencies are not installed. Install mlx and mlx-lm."
        ) from error

    mx.set_memory_limit(MEMORY_LIMIT_BYTES)
    with redirect_stdout(sys.stderr):
        loaded = mlx_load(MODEL_PATH)
    _model, _tokenizer = loaded[0], loaded[1]

    log(
        "model_loaded",
        model=MODEL_PATH,
        backend="mlx_lm",
        elapsed_seconds=round(time.perf_counter() - started, 3),
        active_memory_gb=round(mx.get_active_memory() / 1024**3, 2),
    )
    return _model, _tokenizer


def release_memory() -> None:
    try:
        import mlx.core as mx

        mx.clear_cache()
    except Exception:  # noqa: BLE001 - freeing memory is best effort
        pass


def unload() -> bool:
    """Drop the resident model so its weights can be reclaimed; `load()` reloads."""
    global _model, _tokenizer
    if _model is None and _tokenizer is None:
        return False
    _model, _tokenizer = None, None
    gc.collect()
    release_memory()
    try:
        import mlx.core as mx

        log("model_unloaded", active_memory_gb=round(mx.get_active_memory() / 1024**3, 2))
    except Exception:  # noqa: BLE001 - diagnostics only
        log("model_unloaded")
    return True


def validate_image(message: dict[str, Any]) -> dict[str, str] | None:
    image = message.get("image")
    if image is None:
        return None
    if not isinstance(image, dict):
        raise ValueError("image must be an object")
    data = image.get("data")
    mime_type = image.get("mime_type")
    if not isinstance(data, str) or not data:
        raise ValueError("image.data must be a nonempty base64 string")
    if len(data) > MAX_IMAGE_BASE64_CHARS:
        raise ValueError(f"image.data must be at most {MAX_IMAGE_BASE64_CHARS} characters")
    if mime_type not in IMAGE_MIME_TYPES:
        raise ValueError(f"image.mime_type must be one of {sorted(IMAGE_MIME_TYPES)}")
    return {"data": data, "mime_type": mime_type}


def _validate_options(question_id: str, criteria: Any) -> None:
    if not isinstance(criteria, dict) or not criteria:
        raise ValueError(f"question {question_id!r} criteria must be a nonempty object")
    if len(criteria) > MAX_OPTIONS:
        raise ValueError(
            f"question {question_id!r} supports at most {MAX_OPTIONS} criteria"
        )
    if any(not isinstance(key, str) or not key for key in criteria):
        raise ValueError(f"question {question_id!r} criteria keys must be nonempty strings")
    # TypeSafe contract: descriptions may be a string, a structured object/array
    # (e.g. {"what": ..., "examples": [...]}) or null (the id speaks for itself).
    if any(
        description is not None and not isinstance(description, (str, dict, list))
        for description in criteria.values()
    ):
        raise ValueError(
            f"question {question_id!r} criteria descriptions must be strings, objects, arrays, or null"
        )


def _validate_levels(question_id: str, criteria: Any) -> None:
    if not isinstance(criteria, list) or len(criteria) < MIN_SCORE_LEVELS:
        raise ValueError(
            f"question {question_id!r} score criteria must be an array of at least {MIN_SCORE_LEVELS} levels"
        )
    if len(criteria) > MAX_SCORE_LEVELS:
        raise ValueError(
            f"question {question_id!r} supports at most {MAX_SCORE_LEVELS} score levels"
        )
    if any(not isinstance(level, (str, dict, list)) or not level for level in criteria):
        raise ValueError(
            f"question {question_id!r} score levels must be nonempty strings, objects, or arrays"
        )


def _validate_noul_criteria(question_id: str, criteria: Any) -> None:
    if criteria is None:
        return
    if not isinstance(criteria, dict) or set(criteria) - {"true", "false"}:
        raise ValueError(
            f"question {question_id!r} noul criteria must be an object with only 'true'/'false' keys"
        )
    if any(not isinstance(value, (str, dict, list)) for value in criteria.values()):
        raise ValueError(
            f"question {question_id!r} noul criteria descriptions must be strings, objects, or arrays"
        )


def _validate_question(question_id: Any, question: Any) -> None:
    if not isinstance(question_id, str) or not question_id:
        raise ValueError("question ids must be nonempty strings")
    if not isinstance(question, dict):
        raise ValueError(f"question {question_id!r} must be an object")

    kind = question.get("type")
    if kind not in QUESTION_TYPES:
        raise ValueError(
            f"question {question_id!r} type must be one of {', '.join(QUESTION_TYPES)}"
        )

    instructions = question.get("instructions")
    if not isinstance(instructions, (str, dict, list)) or not instructions:
        raise ValueError(
            f"question {question_id!r} instructions must be a nonempty string, object, or array"
        )
    if kind == "choice":
        _validate_options(question_id, question.get("criteria"))
    elif kind == "score":
        _validate_levels(question_id, question.get("criteria"))
    else:
        _validate_noul_criteria(question_id, question.get("criteria"))


def validate_request(message: Any) -> tuple[str, str | dict[str, Any] | list[Any], dict[str, Any]]:
    if not isinstance(message, dict):
        raise ValueError("request must be a JSON object")

    request_id = message.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("request_id must be a nonempty string")

    state = message.get("state")
    if not isinstance(state, (str, dict, list)):
        raise ValueError("state must be a string, object, or array")
    serialized_state = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    if len(serialized_state) > MAX_STATE_CHARS:
        raise ValueError(
            f"serialized state must be at most {MAX_STATE_CHARS} characters"
        )

    questions = message.get("questions")
    if not isinstance(questions, dict) or not questions:
        raise ValueError("questions must be a nonempty object")
    if len(questions) > MAX_QUESTIONS:
        raise ValueError(f"at most {MAX_QUESTIONS} questions are supported")
    for question_id, question in questions.items():
        _validate_question(question_id, question)

    return request_id, state, questions


# --- Prompt -----------------------------------------------------------------


def _state_parts(state: str | dict[str, Any] | list[Any]) -> tuple[str, str, str, str]:
    """(url, title, recent actions, page text) from the tool state.

    BrowserOS sends {page: {url, title, text}, recent_actions}. Any other object
    or array (the generic TypeSafe contract) is serialized whole as the text, so
    content outside `page` is never silently dropped.
    """
    if not isinstance(state, dict):
        return "", "", "none", state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
    page = state.get("page")
    if not isinstance(page, dict):
        return "", "", "none", json.dumps(state, ensure_ascii=False)
    recent = state.get("recent_actions")
    recent_text = json.dumps(recent, ensure_ascii=False) if recent else "none"
    extra = {key: value for key, value in state.items() if key not in ("page", "recent_actions")}
    text = str(page.get("text") or "")
    if extra:
        text = f"{text}\n\nCONTEXT: {json.dumps(extra, ensure_ascii=False)}".lstrip()
    return (
        str(page.get("url") or ""),
        str(page.get("title") or ""),
        recent_text,
        text,
    )


def _is_page_state(state: str | dict[str, Any] | list[Any]) -> bool:
    return isinstance(state, dict) and isinstance(state.get("page"), dict)


def _instructions_text(instructions: str | dict[str, Any] | list[Any]) -> str:
    if isinstance(instructions, str):
        return instructions
    if isinstance(instructions, list):
        return "\n".join(str(item) for item in instructions)
    return json.dumps(instructions, ensure_ascii=False)


def _chat_prompt(tokenizer: Any, system: str, user: str) -> str:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        return tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False, enable_thinking=False
        )
    except TypeError:  # template without an enable_thinking switch
        return tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False
        )


def _description_text(description: Any) -> str:
    if description is None:
        return ""
    if isinstance(description, str):
        return description
    return json.dumps(description, ensure_ascii=False)


def _user_message(
    url: str, title: str, recent: str, text: str, criteria: dict[str, Any]
) -> str:
    candidates = "\n".join(
        f"{key}: {_description_text(description)}" if description is not None else key
        for key, description in criteria.items()
    )
    return (
        f"URL: {url}\n"
        f"PAGE TITLE: {title or 'none'}\n"
        f"RECENT ACTIONS: {recent}\n"
        f"PAGE TEXT:\n{text}\n\n"
        f"CANDIDATE ACTIONS (id: description):\n{candidates}\n\n"
        "Answer with exactly one id."
    )


def _generic_user_message(text: str, criteria: dict[str, Any]) -> str:
    options = "\n".join(
        f"{key}: {_description_text(description)}" if description is not None else key
        for key, description in criteria.items()
    )
    return f"INPUT:\n{text}\n\nOPTIONS (id: description):\n{options}\n\nAnswer with exactly one id."


def build_prompt_ids(
    tokenizer: Any,
    instructions: str | dict[str, Any] | list[Any],
    state: str | dict[str, Any] | list[Any],
    criteria: dict[str, Any],
    max_tokens: int = MAX_PROMPT_TOKENS,
) -> list[int]:
    """Chat prompt token ids, with page text cut (never the rules/candidates) to fit max_tokens.

    Page states (BrowserOS) keep the browser-action layout; any other state uses a
    neutral INPUT/OPTIONS layout so generic decisions are not framed as clicks.
    """
    page_state = _is_page_state(state)
    url, title, recent, text = _state_parts(state)
    if page_state:
        system = f"{_instructions_text(instructions)}\nReply with only the id of the chosen action."
    else:
        system = f"{_instructions_text(instructions)}\nReply with only the id of the chosen option."

    def encode(page_text: str) -> list[int]:
        user = (
            _user_message(url, title, recent, page_text, criteria)
            if page_state
            else _generic_user_message(page_text, criteria)
        )
        return list(tokenizer.encode(_chat_prompt(tokenizer, system, user)))

    ids = encode(text)
    if len(ids) <= max_tokens:
        return ids

    text_ids = list(tokenizer.encode(text)) if text else []
    for _ in range(TRUNCATION_MAX_PASSES):
        overflow = len(ids) - max_tokens + TRUNCATION_MARGIN_TOKENS
        keep = len(text_ids) - overflow
        if keep <= 0:
            break
        text_ids = text_ids[:keep]
        ids = encode(tokenizer.decode(text_ids))
        if len(ids) <= max_tokens:
            return ids
    raise ValueError(
        f"prompt needs {len(ids)} tokens even without page text; limit is {max_tokens}"
    )


# --- Constrained choice ------------------------------------------------------


class _TrieNode:
    __slots__ = ("children", "choice")

    def __init__(self) -> None:
        self.children: dict[int, _TrieNode] = {}
        self.choice: str | None = None


def _branches(node: _TrieNode) -> bool:
    """Whether any node at or below `node` offers more than one continuation."""
    return len(node.children) > 1 or any(_branches(child) for child in node.children.values())


def build_trie(sequences: dict[str, list[int]]) -> _TrieNode:
    root = _TrieNode()
    for choice, tokens in sequences.items():
        node = root
        for token in tokens:
            node = node.children.setdefault(token, _TrieNode())
        node.choice = choice
    return root


def trie_probabilities(
    root: _TrieNode,
    state: Any,
    weigh: Callable[[Any, list[int]], list[float]],
    advance: Callable[[Any, list[int]], Any],
    clone: Callable[[Any], Any],
) -> dict[str, float]:
    """Exact probability of every id: product of restricted softmaxes along its path.

    `state` must already describe the root position. The model is only consulted at
    real branch points; forced edges (a single continuation) cost nothing and are
    fed in one batch when the next branch point needs fresh logits.
      weigh(state, tokens)    -> next-token probabilities over `tokens`, summing to 1
      advance(state, tokens)  -> state after feeding `tokens` (may mutate and return it)
      clone(state)            -> independent copy, taken before a sibling mutates it
    """
    probabilities: dict[str, float] = {}

    def walk(node: _TrieNode, node_state: Any, pending: list[int], mass: float) -> None:
        tokens = sorted(node.children)
        if len(tokens) == 1:
            child = node.children[tokens[0]]
            if child.choice is not None:
                probabilities[child.choice] = mass
            if child.children:
                walk(child, node_state, [*pending, tokens[0]], mass)
            return
        if pending:
            node_state = advance(node_state, pending)
        weights = weigh(node_state, tokens)
        # Only subtrees that branch again will read the state; the last of them may
        # take it over, earlier ones get a copy before anyone mutates it.
        needy = [token for token in tokens if _branches(node.children[token])]
        for token, weight in zip(tokens, weights):
            child = node.children[token]
            if child.choice is not None:
                probabilities[child.choice] = mass * weight
            if child.children:
                if token not in needy:
                    child_state = None
                else:
                    child_state = node_state if token == needy[-1] else clone(node_state)
                walk(child, child_state, [token], mass * weight)

    walk(root, state, [], 1.0)
    return probabilities


def _end_token(tokenizer: Any) -> int:
    ids = tokenizer.encode(END_OF_TURN, add_special_tokens=False)
    if len(ids) == 1:
        return int(ids[0])
    eos = getattr(tokenizer, "eos_token_id", None)
    if eos is None:
        raise RuntimeError(f"tokenizer has no single {END_OF_TURN} token")
    return int(eos)


def score_choices(
    model: Any, tokenizer: Any, prompt_ids: list[int], choices: list[str]
) -> dict[str, float]:
    """One prefill, then a few cached decode steps over the trie of candidate ids."""
    import mlx.core as mx
    from mlx_lm.models.cache import make_prompt_cache

    end = _end_token(tokenizer)
    sequences = {
        choice: [*tokenizer.encode(choice, add_special_tokens=False), end]
        for choice in choices
    }

    def log_probs(logits: Any) -> Any:
        logits = logits.astype(mx.float32)
        return logits - mx.logsumexp(logits, axis=-1, keepdims=True)

    def step(cache: Any, tokens: list[int]) -> Any:
        row = log_probs(model(mx.array(tokens)[None], cache=cache)[0, -1])
        mx.eval(row)
        return row

    def weigh(state: list[Any], tokens: list[int]) -> list[float]:
        return mx.softmax(state[1][mx.array(tokens)]).tolist()

    def advance(state: list[Any], tokens: list[int]) -> list[Any]:
        state[1] = step(state[0], tokens)
        return state

    def clone(state: list[Any]) -> list[Any]:
        return [copy.deepcopy(state[0]), state[1]]

    cache = make_prompt_cache(model)
    chunk = max(1, PREFILL_CHUNK_TOKENS)
    for offset in range(0, len(prompt_ids), chunk):
        row = step(cache, prompt_ids[offset : offset + chunk])
    root = build_trie(sequences)
    return trie_probabilities(root, [cache, row], weigh, advance, clone)


def _choose(probabilities: dict[str, float]) -> str:
    return max(probabilities.items(), key=lambda item: item[1])[0]


def choice_confidence(probabilities: list[float]) -> float:
    """TypeSafe Choice confidence: top probability above an even split, scaled to [0, 1]."""
    n = len(probabilities)
    if n < 2:
        return 1.0
    return max(0.0, min(1.0, (max(probabilities) - 1 / n) / (1 - 1 / n)))


def score_confidence(probabilities: list[float]) -> float:
    """TypeSafe Score confidence: spread around the top level vs. an even spread."""
    n = len(probabilities)
    top = probabilities.index(max(probabilities))
    spread = sum(p * abs(i - top) for i, p in enumerate(probabilities))
    even_spread = sum(abs(i - (n - 1) / 2) for i in range(n)) / n
    return max(0.0, min(1.0, 1 - spread / even_spread))


def _level_text(level: Any) -> str:
    if isinstance(level, dict) and isinstance(level.get("what"), str):
        examples = level.get("examples")
        if isinstance(examples, list) and examples:
            return f"{level['what']} (e.g. {'; '.join(str(e) for e in examples)})"
        return level["what"]
    return _description_text(level)


# Each question type is lowered onto the same constrained-choice scorer:
#   choice -> the caller's ids
#   score  -> level numbers "0".."n-1", answer = expected level
#   noul   -> "yes"/"no", answer = P(yes)
NOUL_INSTRUCTION = "Answer yes or no."


def _lower_question(question: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    kind = question["type"]
    instructions = question["instructions"]
    if kind == "choice":
        return instructions, question["criteria"]
    if kind == "score":
        levels = question["criteria"]
        text = _instructions_text(instructions)
        rules = f"{text}\nRate on the ordered scale below; level 0 is the low end, level {len(levels) - 1} the high end."
        return rules, {str(i): _level_text(level) for i, level in enumerate(levels)}
    criteria = question.get("criteria") or {}
    text = _instructions_text(instructions)
    return f"{text}\n{NOUL_INSTRUCTION}", {
        "yes": _level_text(criteria["true"]) if "true" in criteria else "yes, true",
        "no": _level_text(criteria["false"]) if "false" in criteria else "no, false",
    }


def _answer(question: dict[str, Any], probabilities: dict[str, float]) -> dict[str, Any]:
    kind = question["type"]
    if kind == "choice":
        return {
            "type": "choice",
            "choice": _choose(probabilities),
            "confidence": round(choice_confidence(list(probabilities.values())), 4),
            "probabilities": probabilities,
        }
    if kind == "score":
        levels = question["criteria"]
        ordered = [probabilities[str(i)] for i in range(len(levels))]
        return {
            "type": "score",
            "score": round(sum(i * p for i, p in enumerate(ordered)), 4),
            "confidence": round(score_confidence(ordered), 4),
            "legend": {str(i): level for i, level in enumerate(levels)},
            "probabilities": {str(i): p for i, p in enumerate(ordered)},
        }
    return {"type": "noul", "noul": round(probabilities["yes"], 4)}


def predict(
    state: str | dict[str, Any] | list[Any],
    questions: dict[str, Any],
    image: dict[str, str] | None = None,
) -> dict[str, Any]:
    model, tokenizer = load()
    started = time.perf_counter()

    answers: dict[str, Any] = {}
    input_tokens = 0
    for question_id, question in questions.items():
        instructions, criteria = _lower_question(question)
        prompt_ids = build_prompt_ids(tokenizer, instructions, state, criteria)
        input_tokens += len(prompt_ids)
        probabilities = score_choices(model, tokenizer, prompt_ids, list(criteria))
        answers[question_id] = _answer(question, probabilities)

    total_seconds = round(time.perf_counter() - started, 3)
    log("predicted", input_tokens=input_tokens, total_seconds=total_seconds)
    response: dict[str, Any] = {
        "answers": answers,
        "usage": {"input_tokens": input_tokens, "total_seconds": total_seconds},
    }
    if image is not None:
        response["image"] = {"used": False, "reason": IMAGE_UNSUPPORTED_REASON}
    return response


def respond(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False), flush=True)


def handle_line(line: str) -> None:
    request_id = "unknown"
    try:
        message = json.loads(line)
        request_id, state, questions = validate_request(message)
        image = validate_image(message)
        result = predict(state, questions, image) if image else predict(state, questions)
        respond({"request_id": request_id, **result})
    except Exception as error:
        log(
            "request_error",
            request_id=request_id,
            error_kind=type(error).__name__,
            error=str(error),
        )
        respond(
            {
                "request_id": request_id,
                "error": str(error),
                "error_kind": type(error).__name__,
            }
        )
    finally:
        release_memory()


def stop(_signum: int, _frame: Any) -> None:
    # Drop the weights before exiting so Metal buffers are released promptly.
    global _model, _tokenizer
    _model = None
    _tokenizer = None
    release_memory()
    raise SystemExit(0)


def main() -> int:
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    for raw_line in sys.stdin:
        if _stopping:
            break
        line = raw_line.strip()
        if line:
            handle_line(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
