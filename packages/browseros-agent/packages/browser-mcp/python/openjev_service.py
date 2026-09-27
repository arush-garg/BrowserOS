#!/usr/bin/env python3
"""Persistent JSONL adapter for the local OpenJev decision model (Qwen3.5 NLI)."""

from __future__ import annotations

import json
import os
import signal
import sys
import time
from contextlib import redirect_stdout
from typing import Any

MODEL_REPO = "AlexWortega/openjev"
MODEL_SUBFOLDER = os.environ.get("BROWSEROS_OPENJEV_SUBFOLDER") or "qwen3.5-2b-nli-v5"
REVISION = os.environ.get("BROWSEROS_OPENJEV_REVISION") or "main"
DEVICE = os.environ.get("BROWSEROS_OPENJEV_DEVICE") or None
MAX_STATE_CHARS = 50_000
MAX_QUESTIONS = 8
MAX_OPTIONS = 64

_agent: Any = None
_tokenizer: Any = None
_stopping = False


def log(event: str, **fields: Any) -> None:
    print(
        json.dumps({"event": event, **fields}, ensure_ascii=False),
        file=sys.stderr,
        flush=True,
    )


def load() -> tuple[Any, Any]:
    global _agent, _tokenizer
    if _agent is not None and _tokenizer is not None:
        return _agent, _tokenizer

    started = time.perf_counter()
    try:
        from huggingface_hub import snapshot_download
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        import torch
    except ImportError as error:
        raise RuntimeError(
            "OpenJev dependencies are not installed. Install transformers, torch, huggingface_hub."
        ) from error

    with redirect_stdout(sys.stderr):
        snapshot_path = snapshot_download(
            repo_id=MODEL_REPO,
            revision=REVISION,
            allow_patterns=[f"{MODEL_SUBFOLDER}/*"],
        )
        _tokenizer = AutoTokenizer.from_pretrained(snapshot_path, subfolder=MODEL_SUBFOLDER)
        _agent = AutoModelForSequenceClassification.from_pretrained(
            snapshot_path,
            subfolder=MODEL_SUBFOLDER,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
        )
        if DEVICE:
            _agent = _agent.to(DEVICE)
        elif torch.backends.mps.is_available():
            _agent = _agent.to("mps")
        _agent.eval()

    log(
        "model_loaded",
        model=MODEL_REPO,
        revision=REVISION,
        subfolder=MODEL_SUBFOLDER,
        device=DEVICE or ("mps" if torch.backends.mps.is_available() else "cpu"),
        elapsed_seconds=round(time.perf_counter() - started, 3),
    )
    return _agent, _tokenizer


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
        raise RuntimeError("OpenJev result is missing answers")
    for question_id in questions:
        answer = answers.get(question_id)
        if not isinstance(answer, dict) or answer.get("type") != "choice":
            raise RuntimeError(f"OpenJev answer {question_id!r} must be a choice object")
        if not isinstance(answer.get("choice"), str):
            raise RuntimeError(f"OpenJev answer {question_id!r} choice must be a string")
        probabilities = answer.get("probabilities")
        if not isinstance(probabilities, dict) or any(
            not isinstance(value, (int, float)) or isinstance(value, bool)
            for value in probabilities.values()
        ):
            raise RuntimeError(
                f"OpenJev answer {question_id!r} must contain numeric probabilities"
            )
    return answers


def _build_premise(state: str | dict[str, Any] | list[Any]) -> str:
    """Convert Laya state to premise text for NLI."""
    if isinstance(state, dict):
        page = state.get("page", {})
        url = page.get("url", "")
        text = page.get("text", "")
        recent_actions = state.get("recent_actions", [])
        action_str = "; ".join(
            f"{a.get('operation', '')}:{a.get('targetRef', '')}" for a in recent_actions[-5:]
        )
        return f"Page: {url}\nContent: {text}\nRecent: {action_str}"
    return str(state)


def _hypothesis_from_criterion(criterion: str, description: str, context: str = "") -> str:
    """Convert a criterion (operation or target) to an NLI hypothesis."""
    return f"{context} {criterion}: {description}".strip()


def predict(state: str | dict[str, Any] | list[Any], questions: dict[str, Any]) -> dict[str, Any]:
    import torch
    import numpy as np

    agent, tokenizer = load()
    premise = _build_premise(state)

    # Build all premise-hypothesis pairs
    pairs = []
    pair_meta = []  # (question_id, criterion_key)
    
    for question_id, question in questions.items():
        criteria = question.get("criteria", {})
        context = ""
        if isinstance(question.get("instructions"), dict):
            context = question["instructions"].get("goal", "")
        elif isinstance(question.get("instructions"), str):
            context = question["instructions"]
        elif isinstance(question.get("instructions"), list):
            context = " ".join(str(x) for x in question["instructions"])

        for criterion_key, criterion_desc in criteria.items():
            hypothesis = _hypothesis_from_criterion(criterion_key, criterion_desc, context)
            pairs.append((premise, hypothesis))
            pair_meta.append((question_id, criterion_key))

    if not pairs:
        raise RuntimeError("No valid premise-hypothesis pairs generated")

    # Batch inference
    with redirect_stdout(sys.stderr):
        inputs = tokenizer(
            [p[0] for p in pairs],
            [p[1] for p in pairs],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512,
        )
        device = next(agent.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = agent(**inputs)
            logits = outputs.logits  # [batch, 3] for entailment/contradiction/neutral
            probs = torch.softmax(logits, dim=-1).cpu().numpy()

    # Laya expects choice probabilities. Map NLI: entailment=positive, contradiction=negative, neutral=neutral
    # For operation choice: higher entailment = more likely correct operation
    # For target choice: higher entailment = better target match
    answers = {}
    for (question_id, criterion_key), prob in zip(pair_meta, probs):
        # prob[0]=entailment, prob[1]=neutral, prob[2]=contradiction (verify label order)
        # Use entailment probability as the "choice" score
        entailment_score = float(prob[0])
        
        if question_id not in answers:
            answers[question_id] = {"type": "choice", "choice": "", "probabilities": {}}
        
        answers[question_id]["probabilities"][criterion_key] = entailment_score

    # Pick the highest entailment as the choice for each question
    for question_id, answer in answers.items():
        if answer["probabilities"]:
            best = max(answer["probabilities"].items(), key=lambda x: x[1])
            answer["choice"] = best[0]
            # Normalize probabilities to sum to 1
            total = sum(answer["probabilities"].values())
            if total > 0:
                for k in answer["probabilities"]:
                    answer["probabilities"][k] /= total

    response = {"answers": answers}
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