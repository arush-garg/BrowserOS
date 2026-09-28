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

    def test_protocol_emits_openjev_answers(self) -> None:
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
        }
        output = io.StringIO()

        with patch.object(SERVICE, "predict", return_value=result) as predict, redirect_stdout(
            output
        ):
            SERVICE.handle_line(json.dumps(request))

        predict.assert_called_once_with("page", request["questions"])
        self.assertEqual(
            json.loads(output.getvalue()),
            {"request_id": "one", "answers": result["answers"]},
        )

    def test_predict_normalizes_entailment_into_choice_probabilities(self) -> None:
        questions = {
            "operation": {
                "type": "choice",
                "instructions": {"goal": "Finish"},
                "criteria": {"WAIT": "wait", "DONE": "done"},
            }
        }
        with patch.object(SERVICE, "load", return_value=("agent", "tokenizer")), patch.object(
            SERVICE, "_score_pairs", return_value=[[0.2, 0.4, 0.4], [0.6, 0.2, 0.2]]
        ) as score:
            result = SERVICE.predict({"page": {"text": "page"}}, questions)

        premises, hypotheses = score.call_args.args[2:4]
        self.assertEqual(premises, ["Page: \nContent: page\nRecent: "] * 2)
        self.assertEqual(hypotheses, ["Finish WAIT: wait", "Finish DONE: done"])
        answer = result["answers"]["operation"]
        self.assertEqual(answer["choice"], "DONE")
        self.assertAlmostEqual(answer["probabilities"]["WAIT"], 0.25)
        self.assertAlmostEqual(answer["probabilities"]["DONE"], 0.75)

    def test_predict_reads_entailment_column_from_label2id(self) -> None:
        questions = {
            "operation": {
                "type": "choice",
                "instructions": {"goal": "Finish"},
                "criteria": {"WAIT": "wait", "DONE": "done"},
            }
        }
        # OpenJev checkpoints: contradiction=0, entailment=1, neutral=2.
        agent = SimpleNamespace(
            config=SimpleNamespace(
                label2id={"contradiction": 0, "entailment": 1, "neutral": 2}
            )
        )
        scores = [[0.9, 0.05, 0.05], [0.1, 0.8, 0.1]]
        with patch.object(SERVICE, "load", return_value=(agent, "tokenizer")), patch.object(
            SERVICE, "_score_pairs", return_value=scores
        ):
            result = SERVICE.predict({"page": {"text": "page"}}, questions)

        answer = result["answers"]["operation"]
        self.assertEqual(answer["choice"], "DONE")
        self.assertAlmostEqual(answer["probabilities"]["DONE"], 0.8 / 0.85)

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


class VisionTests(unittest.TestCase):
    QUESTIONS = {
        "operation": {
            "type": "choice",
            "instructions": {"goal": "Click First"},
            "criteria": {"CLICK": "click", "DONE": "done"},
        }
    }

    def setUp(self) -> None:
        setattr(SERVICE, "_vision", None)

    def tearDown(self) -> None:
        setattr(SERVICE, "_vision", None)

    def test_validate_image_accepts_supported_screenshots(self) -> None:
        self.assertIsNone(SERVICE.validate_image({}))
        self.assertEqual(
            SERVICE.validate_image({"image": {"data": "aGk=", "mime_type": "image/jpeg"}}),
            {"data": "aGk=", "mime_type": "image/jpeg"},
        )

    def test_validate_image_rejects_bad_shapes(self) -> None:
        with self.assertRaisesRegex(ValueError, "image must be an object"):
            SERVICE.validate_image({"image": "aGk="})
        with self.assertRaisesRegex(ValueError, "nonempty base64"):
            SERVICE.validate_image({"image": {"data": "", "mime_type": "image/png"}})
        with self.assertRaisesRegex(ValueError, "mime_type"):
            SERVICE.validate_image({"image": {"data": "aGk=", "mime_type": "image/gif"}})
        with self.assertRaisesRegex(ValueError, "at most"):
            SERVICE.validate_image(
                {
                    "image": {
                        "data": "a" * (SERVICE.MAX_IMAGE_BASE64_CHARS + 1),
                        "mime_type": "image/png",
                    }
                }
            )

    def test_handle_line_forwards_the_screenshot(self) -> None:
        request = {
            "request_id": "one",
            "state": "page",
            "questions": self.QUESTIONS,
            "image": {"data": "aGk=", "mime_type": "image/png"},
        }
        result = {"answers": {}, "image": {"used": True, "tokens": 4}}
        output = io.StringIO()
        with patch.object(SERVICE, "predict", return_value=result) as predict, redirect_stdout(
            output
        ):
            SERVICE.handle_line(json.dumps(request))

        predict.assert_called_once_with(
            "page", self.QUESTIONS, {"data": "aGk=", "mime_type": "image/png"}
        )
        self.assertEqual(json.loads(output.getvalue())["image"], result["image"])

    def test_accepts_pixels_requires_vision_inputs(self) -> None:
        class TextOnly:
            def forward(self, input_ids=None, attention_mask=None):
                pass

        class Vision:
            def forward(self, input_ids=None, pixel_values=None, image_grid_thw=None):
                pass

        class KwargsWithVisionConfig:
            config = SimpleNamespace(vision_config={"depth": 1})

            def forward(self, input_ids=None, **kwargs):
                pass

        self.assertFalse(SERVICE._accepts_pixels(TextOnly()))
        self.assertTrue(SERVICE._accepts_pixels(Vision()))
        self.assertTrue(SERVICE._accepts_pixels(KwargsWithVisionConfig()))

    def test_load_vision_reports_and_caches_text_only_checkpoints(self) -> None:
        class TextOnly:
            def forward(self, input_ids=None):
                pass

        with redirect_stderr(io.StringIO()) as stderr:
            first = SERVICE.load_vision(TextOnly(), Mock())
            second = SERVICE.load_vision(TextOnly(), Mock())

        self.assertIsNone(first[0])
        self.assertIn("pixel_values", first[1])
        self.assertIs(first, second)
        self.assertEqual(json.loads(stderr.getvalue())["event"], "vision_unavailable")

    def test_load_vision_expands_qwen_image_tokens(self) -> None:
        class Vision:
            def forward(self, input_ids=None, pixel_values=None, image_grid_thw=None):
                pass

        vocab = {"<|vision_start|>": 10, "<|image_pad|>": 11, "<|vision_end|>": 12}
        tokenizer = SimpleNamespace(unk_token_id=0, convert_tokens_to_ids=vocab.get)
        image_processor = Mock(merge_size=2)
        image_processor.return_value = {
            "pixel_values": "pixels",
            "image_grid_thw": SimpleNamespace(prod=lambda: 1 * 4 * 6),
        }
        with patch.object(
            SERVICE, "_load_image_processor", return_value=image_processor
        ), patch.object(SERVICE, "_decode_image", return_value="decoded"), redirect_stderr(
            io.StringIO()
        ):
            vision, reason = SERVICE.load_vision(Vision(), tokenizer)
            visual = SERVICE._prepare_vision(vision, {"data": "", "mime_type": "image/png"})

        self.assertEqual(reason, "")
        self.assertEqual(vision.pad_token_id, 11)
        self.assertFalse(vision.wants_type_ids)
        self.assertEqual(visual["image_tokens"], 6)
        self.assertEqual(
            visual["prefix"], "<|vision_start|>" + "<|image_pad|>" * 6 + "<|vision_end|>"
        )
        image_processor.assert_called_once_with(images=["decoded"], return_tensors="pt")

    def test_predict_falls_back_to_text_when_vision_is_unsupported(self) -> None:
        scores = [[0.9, 0.05, 0.05], [0.1, 0.45, 0.45]]
        with patch.object(SERVICE, "load", return_value=("agent", "tokenizer")), patch.object(
            SERVICE, "load_vision", return_value=(None, "no pixels")
        ), patch.object(SERVICE, "_score_pairs", return_value=scores) as score:
            result = SERVICE.predict(
                {"page": {"text": "page"}},
                self.QUESTIONS,
                {"data": "aGk=", "mime_type": "image/png"},
            )

        score.assert_called_once()
        self.assertEqual(len(score.call_args.args), 4)
        self.assertEqual(result["answers"]["operation"]["choice"], "CLICK")
        self.assertEqual(result["image"], {"used": False, "reason": "no pixels"})

    def test_predict_scores_with_the_screenshot_when_supported(self) -> None:
        scores = [[0.2, 0.4, 0.4], [0.8, 0.1, 0.1]]
        visual = {"image_tokens": 6, "prefix": "<img>"}
        with patch.object(SERVICE, "load", return_value=("agent", "tokenizer")), patch.object(
            SERVICE, "load_vision", return_value=("vision", "")
        ), patch.object(SERVICE, "_prepare_vision", return_value=visual), patch.object(
            SERVICE, "_score_pairs", return_value=scores
        ) as score:
            result = SERVICE.predict(
                {"page": {"text": "page"}},
                self.QUESTIONS,
                {"data": "aGk=", "mime_type": "image/png"},
            )

        self.assertEqual(score.call_args.args[4:], ("vision", visual))
        self.assertEqual(result["answers"]["operation"]["choice"], "DONE")
        self.assertEqual(result["image"], {"used": True, "tokens": 6})

    def test_predict_falls_back_to_text_when_the_screenshot_is_corrupt(self) -> None:
        scores = [[0.9, 0.05, 0.05], [0.1, 0.45, 0.45]]
        with patch.object(SERVICE, "load", return_value=("agent", "tokenizer")), patch.object(
            SERVICE, "load_vision", return_value=("vision", "")
        ), patch.object(
            SERVICE, "_prepare_vision", side_effect=OSError("cannot identify image file")
        ), patch.object(SERVICE, "_score_pairs", return_value=scores) as score, redirect_stderr(
            io.StringIO()
        ):
            result = SERVICE.predict(
                {"page": {"text": "page"}},
                self.QUESTIONS,
                {"data": "aGk=", "mime_type": "image/png"},
            )

        self.assertEqual(len(score.call_args.args), 4)
        self.assertEqual(
            result["image"],
            {"used": False, "reason": "screenshot could not be processed: cannot identify image file"},
        )

    def test_predict_without_image_reports_nothing(self) -> None:
        with patch.object(SERVICE, "load", return_value=("agent", "tokenizer")), patch.object(
            SERVICE, "_score_pairs", return_value=[[0.5, 0.25, 0.25], [0.5, 0.25, 0.25]]
        ):
            result = SERVICE.predict({"page": {"text": "page"}}, self.QUESTIONS)
        self.assertNotIn("image", result)


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
        loaded = Mock()
        loaded.eval.return_value = loaded
        fake_hub = SimpleNamespace(snapshot_download=Mock(return_value="/cache/model"))
        fake_transformers = SimpleNamespace(
            AutoModelForSequenceClassification=SimpleNamespace(
                from_pretrained=Mock(return_value=loaded)
            ),
            AutoTokenizer=SimpleNamespace(from_pretrained=Mock(return_value="tokenizer")),
        )
        fake_torch = SimpleNamespace(
            float16="float16",
            backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)),
        )

        with patch.dict(
            "sys.modules",
            {
                "huggingface_hub": fake_hub,
                "transformers": fake_transformers,
                "torch": fake_torch,
            },
        ), patch.object(SERVICE, "DEVICE", None), redirect_stderr(io.StringIO()):
            first = SERVICE.load()
            second = SERVICE.load()

        self.assertEqual(first, (loaded, "tokenizer"))
        self.assertEqual(second, first)
        fake_hub.snapshot_download.assert_called_once_with(
            repo_id=SERVICE.MODEL_REPO,
            revision=SERVICE.REVISION,
            allow_patterns=[f"{SERVICE.MODEL_SUBFOLDER}/*"],
        )
        fake_transformers.AutoModelForSequenceClassification.from_pretrained.assert_called_once()
        fake_transformers.AutoTokenizer.from_pretrained.assert_called_once()
        self.assertEqual(SERVICE._model_path, "/cache/model")

if __name__ == "__main__":
    unittest.main()