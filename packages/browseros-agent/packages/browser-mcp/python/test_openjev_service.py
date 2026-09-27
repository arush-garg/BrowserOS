import importlib.util
import io
import json
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

MODULE_PATH = Path(__file__).with_name("openjev_service.py")
SPEC = importlib.util.spec_from_file_location("openjev_service", MODULE_PATH)
assert SPEC and SPEC.loader
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class OpenJevServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        setattr(SERVICE, "_agent", None)
        setattr(SERVICE, "_tokenizer", None)

    def test_validation_rejects_bad_request_shapes(self) -> None:
        with self.assertRaisesRegex(ValueError, "request must"):
            SERVICE.validate_request([])
        with self.assertRaisesRegex(ValueError, "request_id must"):
            SERVICE.validate_request({"state": "page", "questions": {}})
        with self.assertRaisesRegex(ValueError, "state must"):
            SERVICE.validate_request(
                {"request_id": "one", "state": None, "questions": {}}
            )
        with self.assertRaisesRegex(ValueError, "questions must"):
            SERVICE.validate_request(
                {"request_id": "one", "state": "page", "questions": []}
            )

    def test_validation_accepts_structured_instructions(self) -> None:
        for instructions in ({"goal": "Choose"}, ["Choose", "carefully"]):
            with self.subTest(instructions=instructions):
                _, _, questions = SERVICE.validate_request(
                    {
                        "request_id": "one",
                        "state": "page",
                        "questions": {
                            "operation": {
                                "type": "choice",
                                "instructions": instructions,
                                "criteria": {"WAIT": "wait", "DONE": "done"},
                            }
                        },
                    }
                )
                self.assertEqual(questions["operation"]["instructions"], instructions)

    def test_validation_rejects_invalid_question_boundaries(self) -> None:
        with self.assertRaisesRegex(ValueError, "nonempty"):
            SERVICE.validate_request(
                {"request_id": "one", "state": "page", "questions": {"": {}}}
            )
        with self.assertRaisesRegex(ValueError, "at most"):
            SERVICE.validate_request(
                {
                    "request_id": "one",
                    "state": "page",
                    "questions": {
                        str(index): {
                            "type": "choice",
                            "instructions": "Choose",
                            "criteria": {"WAIT": "wait"},
                        }
                        for index in range(SERVICE.MAX_QUESTIONS + 1)
                    },
                }
            )
        with self.assertRaisesRegex(ValueError, "type must be choice"):
            SERVICE.validate_request(
                {
                    "request_id": "one",
                    "state": "page",
                    "questions": {
                        "operation": {
                            "type": "score",
                            "instructions": "Score",
                            "criteria": {"0": "bad", "1": "good"},
                        }
                    },
                }
            )

    def test_validation_rejects_oversized_state_and_invalid_criteria(self) -> None:
        question = {
            "type": "choice",
            "instructions": "Choose",
            "criteria": {"WAIT": "wait"},
        }
        with self.assertRaisesRegex(ValueError, "serialized state"):
            SERVICE.validate_request(
                {
                    "request_id": "one",
                    "state": "x" * (SERVICE.MAX_STATE_CHARS + 1),
                    "questions": {"operation": question},
                }
            )
        with self.assertRaisesRegex(ValueError, "descriptions must be strings"):
            SERVICE.validate_request(
                {
                    "request_id": "one",
                    "state": "page",
                    "questions": {
                        "operation": {**question, "criteria": {"WAIT": 1}}
                    },
                }
            )

    def test_protocol_emits_openjev_answers_and_usage(self) -> None:
        request = {
            "request_id": "one",
            "state": "page",
            "questions": {
                "operation": {
                    "type": "choice",
                    "instructions": "Choose the next action",
                    "criteria": {"WAIT": "wait", "DONE": "done"},
                }
            },
        }
        result = {
            "answers": {
                "operation": {
                    "type": "choice",
                    "choice": "WAIT",
                    "probabilities": {"WAIT": 0.8, "DONE": 0.2},
                }
            },
            "usage": {"input_tokens": 12, "output_tokens": 0},
        }
        output = io.StringIO()
        agent = Mock()
        agent.cfg = {"head_max_len": 144}
        agent.predict.return_value = result

        with patch.object(SERVICE, "load", return_value=agent), redirect_stdout(output):
            SERVICE.handle_line(json.dumps(request))

        agent.predict.assert_called_once_with("page", request["questions"])
        self.assertEqual(
            json.loads(output.getvalue()),
            {
                "request_id": "one",
                "answers": result["answers"],
                "usage": result["usage"],
            },
        )

    def test_predict_allows_missing_usage_and_validates_choice_answers(self) -> None:
        agent = Mock()
        agent.cfg = {"head_max_len": 144}
        agent.predict.return_value = {
            "answers": {
                "operation": {
                    "type": "choice",
                    "choice": "WAIT",
                    "probabilities": {"WAIT": 1.0},
                }
            }
        }
        questions = {
            "operation": {
                "type": "choice",
                "instructions": "Choose",
                "criteria": {"WAIT": "wait"},
            }
        }
        with patch.object(SERVICE, "load", return_value=agent):
            self.assertEqual(
                SERVICE.predict("page", questions),
                {"answers": agent.predict.return_value["answers"]},
            )

        agent.predict.return_value["answers"]["operation"]["probabilities"] = {
            "WAIT": "certain"
        }
        with patch.object(SERVICE, "load", return_value=agent), self.assertRaisesRegex(
            RuntimeError, "numeric probabilities"
        ):
            SERVICE.predict("page", questions)

    def test_errors_stay_in_protocol_and_diagnostics_use_stderr(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        with redirect_stdout(stdout), redirect_stderr(stderr):
            SERVICE.handle_line("not-json")

        response = json.loads(stdout.getvalue())
        diagnostic = json.loads(stderr.getvalue())
        self.assertEqual(response["request_id"], "unknown")
        self.assertEqual(response["error_kind"], "JSONDecodeError")
        self.assertEqual(diagnostic["event"], "request_error")


class MockServiceTests(unittest.TestCase):
    def test_signal_handler_exits_instead_of_blocking_on_stdin(self) -> None:
        with self.assertRaises(SystemExit):
            SERVICE.stop(15, None)

    def test_mock_returns_valid_openjev_response(self) -> None:
        request = {
            "request_id": "mock-one",
            "state": "page",
            "questions": {
                "operation": {
                    "type": "choice",
                    "instructions": "Choose",
                    "criteria": {"CLICK": "click", "WAIT": "wait"},
                },
                "target": {
                    "type": "choice",
                    "instructions": {"goal": "Choose target"},
                    "criteria": {"e1": "First target", "e2": "Second target"},
                },
            },
        }
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("mock_openjev_service.py"))],
            input=json.dumps(request) + "\n",
            capture_output=True,
            check=True,
            text=True,
        )

        response = json.loads(completed.stdout)
        self.assertEqual(response["request_id"], "mock-one")
        self.assertEqual(response["answers"]["operation"]["choice"], "CLICK")
        self.assertEqual(response["answers"]["target"]["choice"], "e1")
        self.assertEqual(response["usage"]["output_tokens"], 0)


class ModelLoadingTests(unittest.TestCase):
    def setUp(self) -> None:
        setattr(SERVICE, "_agent", None)
        setattr(SERVICE, "_tokenizer", None)

    def test_load_downloads_pinned_snapshot_once(self) -> None:
        loaded = SimpleNamespace(cfg={"head_max_len_train": 144})
        fake_hub = SimpleNamespace(snapshot_download=Mock(return_value="/cache/model"))
        fake_transformers = SimpleNamespace(
            AutoModelForSequenceClassification=Mock(return_value=loaded),
            AutoTokenizer=Mock(return_value="tokenizer"),
        )

        with patch.dict(
            "sys.modules",
            {"huggingface_hub": fake_hub, "transformers": fake_transformers},
        ):
            first = SERVICE.load()
            second = SERVICE.load()

        self.assertIs(first, loaded)
        self.assertIs(second, loaded)
        fake_hub.snapshot_download.assert_called_once_with(
            repo_id=SERVICE.MODEL_REPO,
            revision=SERVICE.REVISION,
            allow_patterns=[f"{SERVICE.MODEL_SUBFOLDER}/*"],
        )
        fake_transformers.AutoModelForSequenceClassification.assert_called_once()
        fake_transformers.AutoTokenizer.assert_called_once()


if __name__ == "__main__":
    unittest.main()