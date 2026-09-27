#!/usr/bin/env python3
"""Mock OpenJev service for testing."""

import json
import sys

def main() -> int:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({
                "request_id": "unknown",
                "error": "invalid JSON",
                "error_kind": "JSONDecodeError",
            }), flush=True)
            continue

        request_id = request.get("request_id", "unknown")
        questions = request.get("questions", {})

        answers = {}
        for qid, question in questions.items():
            criteria = list(question.get("criteria", {}).keys())
            if not criteria:
                continue
            # Always pick the first criterion
            winner = criteria[0]
            probabilities = {c: (1.0 if c == winner else 0.0) for c in criteria}
            answers[qid] = {
                "type": "choice",
                "choice": winner,
                "probabilities": probabilities,
            }

        response = {
            "request_id": request_id,
            "answers": answers,
            "usage": {"input_tokens": 1, "output_tokens": 0},
        }
        image = request.get("image")
        if isinstance(image, dict):
            response["image"] = {"used": True, "tokens": len(image.get("data", ""))}
        print(json.dumps(response), flush=True)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())