#!/usr/bin/env python3
"""Persistent JSONL adapter for the local OpenJev decision model (Qwen3.5 NLI)."""

from __future__ import annotations

import base64
import binascii
import inspect
import io
import json
import os
import signal
import sys
import time
from contextlib import redirect_stdout
from types import SimpleNamespace
from typing import Any

MODEL_REPO = "AlexWortega/openjev"
MODEL_SUBFOLDER = os.environ.get("BROWSEROS_OPENJEV_SUBFOLDER") or "qwen3.5-2b-nli-v5"
REVISION = os.environ.get("BROWSEROS_OPENJEV_REVISION") or "main"
DEVICE = os.environ.get("BROWSEROS_OPENJEV_DEVICE") or None
MAX_STATE_CHARS = 50_000
MAX_QUESTIONS = 8
MAX_OPTIONS = 64
TEXT_MAX_TOKENS = 512
# Screenshots are downscaled to this pixel budget before the Qwen image processor
# sees them. Every premise/hypothesis pair carries its own copy of the image
# tokens, so this bounds both latency and memory (401_408 px ≈ 400-512 image
# tokens, depending on the processor's patch size).
IMAGE_MAX_PIXELS = int(os.environ.get("BROWSEROS_OPENJEV_IMAGE_MAX_PIXELS") or 401_408)
IMAGE_BATCH_SIZE = int(os.environ.get("BROWSEROS_OPENJEV_IMAGE_BATCH_SIZE") or 16)
MAX_IMAGE_BASE64_CHARS = 8_000_000
IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
# Used only when the NLI subfolder ships no preprocessor config of its own.
PROCESSOR_REPO = os.environ.get("BROWSEROS_OPENJEV_PROCESSOR_REPO") or "Qwen/Qwen3.5-2B"

_agent: Any = None
_tokenizer: Any = None
_model_path: str | None = None
_vision: tuple[Any, str] | None = None
_stopping = False


def log(event: str, **fields: Any) -> None:
    print(
        json.dumps({"event": event, **fields}, ensure_ascii=False),
        file=sys.stderr,
        flush=True,
    )


def load() -> tuple[Any, Any]:
    global _agent, _tokenizer, _model_path
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
        _model_path = snapshot_path
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


def _forward_parameters(agent: Any) -> Any:
    try:
        return inspect.signature(agent.forward).parameters
    except (TypeError, ValueError):
        return {}


def _accepts_pixels(agent: Any) -> bool:
    parameters = _forward_parameters(agent)
    if "pixel_values" in parameters and "image_grid_thw" in parameters:
        return True
    forwards_kwargs = any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
    )
    return forwards_kwargs and getattr(getattr(agent, "config", None), "vision_config", None) is not None


def _load_image_processor() -> Any:
    from transformers import AutoImageProcessor, AutoProcessor

    sources: list[tuple[str, dict[str, Any]]] = []
    if _model_path:
        sources.append((_model_path, {"subfolder": MODEL_SUBFOLDER}))
    sources.append((PROCESSOR_REPO, {}))
    for source, kwargs in sources:
        for loader in (AutoProcessor, AutoImageProcessor):
            try:
                loaded = loader.from_pretrained(source, **kwargs)
            except Exception:  # noqa: BLE001 - try the next source
                continue
            image_processor = getattr(loaded, "image_processor", loaded)
            if hasattr(image_processor, "merge_size"):
                return image_processor
    return None


def load_vision(agent: Any, tokenizer: Any) -> tuple[Any, str]:
    """Returns (vision support, reason). Support is None when screenshots cannot be used."""
    global _vision
    if _vision is not None:
        return _vision

    def unsupported(reason: str) -> tuple[Any, str]:
        global _vision
        _vision = (None, reason)
        log("vision_unavailable", reason=reason)
        return _vision

    if not _accepts_pixels(agent):
        return unsupported(
            f"{type(agent).__name__}.forward does not accept pixel_values/image_grid_thw"
        )
    tokens = {
        "start": "<|vision_start|>",
        "pad": "<|image_pad|>",
        "end": "<|vision_end|>",
    }
    unk = getattr(tokenizer, "unk_token_id", None)
    for token in tokens.values():
        token_id = tokenizer.convert_tokens_to_ids(token)
        if token_id is None or token_id == unk:
            return unsupported(f"tokenizer has no {token} token")
    with redirect_stdout(sys.stderr):
        image_processor = _load_image_processor()
    if image_processor is None:
        return unsupported("no Qwen image processor could be loaded")

    _vision = (
        SimpleNamespace(
            image_processor=image_processor,
            merge_size=int(image_processor.merge_size),
            pad_token_id=tokenizer.convert_tokens_to_ids(tokens["pad"]),
            # Qwen3.5 computes M-RoPE from these and refuses pixels without them.
            wants_type_ids="mm_token_type_ids" in _forward_parameters(agent),
            **{f"{name}_token": token for name, token in tokens.items()},
        ),
        "",
    )
    log("vision_loaded", processor=type(image_processor).__name__)
    return _vision


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


def _decode_image(image: dict[str, str]) -> Any:
    from PIL import Image

    try:
        raw = base64.b64decode(image["data"], validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("image.data is not valid base64") from error
    decoded = Image.open(io.BytesIO(raw)).convert("RGB")
    width, height = decoded.size
    if width * height > IMAGE_MAX_PIXELS:
        scale = (IMAGE_MAX_PIXELS / (width * height)) ** 0.5
        decoded = decoded.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            Image.Resampling.BICUBIC,
        )
    return decoded


def _prepare_vision(vision: Any, image: dict[str, str]) -> dict[str, Any]:
    with redirect_stdout(sys.stderr):
        processed = vision.image_processor(images=[_decode_image(image)], return_tensors="pt")
    grid = processed["image_grid_thw"]
    image_tokens = int(grid.prod()) // (vision.merge_size**2)
    return {
        "pixel_values": processed["pixel_values"],
        "image_grid_thw": grid,
        "image_tokens": image_tokens,
        # Same expansion the Qwen processor performs for one image placeholder.
        "prefix": f"{vision.start_token}{vision.pad_token * image_tokens}{vision.end_token}",
    }


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


def _score_pairs(
    agent: Any,
    tokenizer: Any,
    premises: list[str],
    hypotheses: list[str],
    vision: Any = None,
    visual: dict[str, Any] | None = None,
) -> Any:
    """Entailment scores per pair, or None if truncation cut into the image tokens."""
    import numpy as np
    import torch

    device = next(agent.parameters()).device
    if visual is None:
        batch_size = len(premises)
        max_length = TEXT_MAX_TOKENS
    else:
        batch_size = max(1, IMAGE_BATCH_SIZE)
        # Keep the text budget the model was tuned on; image tokens ride on top.
        max_length = TEXT_MAX_TOKENS + visual["image_tokens"] + 2
        premises = [f"{visual['prefix']}{premise}" for premise in premises]

    chunks = []
    with redirect_stdout(sys.stderr):
        for offset in range(0, len(premises), batch_size):
            inputs = tokenizer(
                premises[offset : offset + batch_size],
                hypotheses[offset : offset + batch_size],
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=max_length,
            )
            if visual is not None:
                rows = inputs["input_ids"].shape[0]
                image_counts = (inputs["input_ids"] == vision.pad_token_id).sum(dim=-1)
                if bool((image_counts != visual["image_tokens"]).any()):
                    return None
                # Qwen VL batches flatten patches across samples, one grid row per image.
                inputs["pixel_values"] = torch.cat([visual["pixel_values"]] * rows).to(
                    device, dtype=agent.dtype
                )
                inputs["image_grid_thw"] = visual["image_grid_thw"].repeat(rows, 1)
                if vision.wants_type_ids:
                    # Same marking as ProcessorMixin.create_mm_token_type_ids: image=1, text=0.
                    inputs["mm_token_type_ids"] = (
                        inputs["input_ids"] == vision.pad_token_id
                    ).int()
            inputs = {k: v.to(device) for k, v in inputs.items()}

            with torch.no_grad():
                logits = agent(**inputs).logits  # [batch, 3] NLI classes
                chunks.append(torch.softmax(logits.float(), dim=-1).cpu().numpy())
    return np.concatenate(chunks)


def predict(
    state: str | dict[str, Any] | list[Any],
    questions: dict[str, Any],
    image: dict[str, str] | None = None,
) -> dict[str, Any]:
    agent, tokenizer = load()
    premise = _build_premise(state)

    premises: list[str] = []
    hypotheses: list[str] = []
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
            premises.append(premise)
            hypotheses.append(_hypothesis_from_criterion(criterion_key, criterion_desc, context))
            pair_meta.append((question_id, criterion_key))

    if not premises:
        raise RuntimeError("No valid premise-hypothesis pairs generated")

    probs = None
    image_report: dict[str, Any] | None = None
    if image is not None:
        vision, reason = load_vision(agent, tokenizer)
        visual = None
        if vision is not None:
            try:
                visual = _prepare_vision(vision, image)
            except Exception as error:  # noqa: BLE001 - a bad screenshot degrades to text-only
                reason = f"screenshot could not be processed: {error}"
                log("image_error", error_kind=type(error).__name__, error=str(error))
        if visual is not None:
            probs = _score_pairs(agent, tokenizer, premises, hypotheses, vision, visual)
            if probs is None:
                reason = "goal text too long to keep the screenshot tokens"
                log("image_truncated", image_tokens=visual["image_tokens"])
            else:
                image_report = {"used": True, "tokens": visual["image_tokens"]}
        image_report = image_report or {"used": False, "reason": reason}
    if probs is None:
        probs = _score_pairs(agent, tokenizer, premises, hypotheses)

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

    response: dict[str, Any] = {"answers": answers}
    if image_report is not None:
        response["image"] = image_report
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