#!/usr/bin/env python3
"""Persistent JSONL adapter for the local Laya browser decision model."""

from __future__ import annotations

import json
import os
import signal
import sys
import time
from contextlib import redirect_stdout
from typing import Any

MODEL = "cklxx/laya-browser"
REVISION = "4219958196e2c566c141688c773e08da10c1ff3b"
MODEL_SUBFOLDER = "v10s"
DEVICE = os.environ.get("BROWSEROS_LAYA_DEVICE") or None
MAX_STATE_CHARS = 50_000
MAX_QUESTIONS = 4
MAX_OPTIONS = 64

_agent: Any = None
_stopping = False


def log(event: str, **fields: Any) -> None:
    print(
        json.dumps({"event": event, **fields}, ensure_ascii=False),
        file=sys.stderr,
        flush=True,
    )


def load() -> Any:
    global _agent
    if _agent is not None:
        return _agent

    started = time.perf_counter()
    try:
        from huggingface_hub import snapshot_download
        import laya
    except ImportError as error:
        raise RuntimeError(
            "Laya dependencies are not installed. Install requirements-laya.txt in "
            "the Python environment used by BrowserOS."
        ) from error

    with redirect_stdout(sys.stderr):
        snapshot_path = snapshot_download(
            repo_id=MODEL,
            revision=REVISION,
            allow_patterns=[f"{MODEL_SUBFOLDER}/*"],
        )
        loaded_agent = laya.load(
            snapshot_path, subfolder=MODEL_SUBFOLDER, device=DEVICE
        )

    head_max_len = loaded_agent.cfg.get("head_max_len_train")
    if not isinstance(head_max_len, int) or isinstance(head_max_len, bool) or head_max_len < 1:
        raise RuntimeError(
            "Laya model config must contain a positive integer head_max_len_train"
        )

    loaded_agent.cfg["head_max_len"] = head_max_len
    _agent = loaded_agent
    log(
        "model_loaded",
        model=MODEL,
        revision=REVISION,
        device=DEVICE,
        head_max_len=head_max_len,
        elapsed_seconds=round(time.perf_counter() - started, 3),
    )
    return _agent


def _validate_options(question_id: str, criteria: Any) -> None:
    if not isinstance(criteria, dict) or not criteria:
        raise ValueError(f"question {question_id!r} criteria must be a nonempty object")
    if len(criteria) > MAX_OPTIONS:
        raise ValueError(
            f"question {question_id!r} supports at most {MAX_OPTIONS} criteria"
        )
    if any(not isinstance(key, str) or not key for key in criteria):
        raise ValueError(f"question {question_id!r} criteria keys must be nonempty strings")
    if any(not isinstance(description, str) for description in criteria.values()):
        raise ValueError(f"question {question_id!r} criteria descriptions must be strings")


def _validate_question(question_id: Any, question: Any) -> None:
    if not isinstance(question_id, str) or not question_id:
        raise ValueError("question ids must be nonempty strings")
    if not isinstance(question, dict):
        raise ValueError(f"question {question_id!r} must be an object")

    if question.get("type") != "choice":
        raise ValueError(f"question {question_id!r} type must be choice")

    instructions = question.get("instructions")
    if not isinstance(instructions, (str, dict, list)) or not instructions:
        raise ValueError(
            f"question {question_id!r} instructions must be a nonempty string, object, or array"
        )
    _validate_options(question_id, question.get("criteria"))


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


def _validate_answers(answers: Any, questions: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(answers, dict):
        raise RuntimeError("Laya result is missing answers")
    for question_id in questions:
        answer = answers.get(question_id)
        if not isinstance(answer, dict) or answer.get("type") != "choice":
            raise RuntimeError(f"Laya answer {question_id!r} must be a choice object")
        if not isinstance(answer.get("choice"), str):
            raise RuntimeError(f"Laya answer {question_id!r} choice must be a string")
        probabilities = answer.get("probabilities")
        if not isinstance(probabilities, dict) or any(
            not isinstance(value, (int, float)) or isinstance(value, bool)
            for value in probabilities.values()
        ):
            raise RuntimeError(
                f"Laya answer {question_id!r} must contain numeric probabilities"
            )
    return answers


def predict(state: str | dict[str, Any] | list[Any], questions: dict[str, Any]) -> dict[str, Any]:
    agent = load()
    with redirect_stdout(sys.stderr):
        result = agent.predict(state, questions)
    if not isinstance(result, dict):
        raise RuntimeError("Laya returned a non-object result")

    # Laya 0.3.20 returns an envelope, while some compatible runners return the
    # answers mapping directly. Preserve the model's answer fields either way.
    raw_answers = result.get("answers", result)
    answers = _validate_answers(raw_answers, questions)
    response = {"answers": answers}
    usage = result.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise RuntimeError("Laya usage must be an object")
        response["usage"] = usage
    return response


def respond(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False), flush=True)


def handle_line(line: str) -> None:
    request_id = "unknown"
    try:
        message = json.loads(line)
        request_id, state, questions = validate_request(message)
        result = predict(state, questions)
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


def stop(_signum: int, _frame: Any) -> None:
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
