#!/usr/bin/env python3
"""Deterministic JSONL mock for Laya client tests."""

import json
import sys
from typing import Any


def answer_question(question: dict[str, Any]) -> dict[str, Any]:
    question_type = question["type"]
    if question_type == "noul":
        return {
            "type": "noul",
            "noul": 1.0,
            "confidence": 1.0,
            "answer_confidence": 1.0,
            "action": {"act_probability": 1.0},
        }

    criteria = question["criteria"]
    labels = list(criteria) if isinstance(criteria, dict) else range(len(criteria))
    selected = next(iter(labels))
    probabilities = {
        str(label): 1.0 if label == selected else 0.0 for label in labels
    }
    answer: dict[str, Any] = {
        "type": question_type,
        question_type: selected,
        "confidence": 1.0,
        "answer_confidence": 1.0,
        "probabilities": probabilities,
        "action": {"act_probability": 1.0},
    }
    if question_type == "score":
        answer["legend"] = {
            str(index): description for index, description in enumerate(criteria)
        }
    return answer


for line in sys.stdin:
    try:
        request = json.loads(line)
        answers = {
            question_id: answer_question(question)
            for question_id, question in request["questions"].items()
        }
        print(
            json.dumps(
                {
                    "request_id": request["request_id"],
                    "answers": answers,
                    "usage": {"input_tokens": len(answers), "output_tokens": 0},
                }
            ),
            flush=True,
        )
    except Exception as error:
        print(
            json.dumps(
                {
                    "request_id": "unknown",
                    "error": str(error),
                    "error_kind": type(error).__name__,
                }
            ),
            flush=True,
        )
