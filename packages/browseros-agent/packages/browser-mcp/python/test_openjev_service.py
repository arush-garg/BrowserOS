import importlib.util
import io
import json
import math
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

QUESTIONS = {
    "operation": {
        "type": "choice",
        "instructions": "Choose the next action",
        "criteria": {"WAIT": "wait", "DONE": "done"},
    }
}


class FakeTokenizer:
    """Whitespace 'tokenizer': one token per word, ids are positions in a growing vocab."""

    def __init__(self) -> None:
        self.vocab: dict[str, int] = {}
        self.words: list[str] = []

    def encode(self, text: str, add_special_tokens: bool = True) -> list[int]:
        ids = []
        for word in text.split():
            if word not in self.vocab:
                self.vocab[word] = len(self.words)
                self.words.append(word)
            ids.append(self.vocab[word])
        return ids

    def decode(self, ids: list[int]) -> str:
        return " ".join(self.words[i] for i in ids)

    def apply_chat_template(self, messages, add_generation_prompt, tokenize, **kwargs) -> str:
        assert add_generation_prompt and not tokenize
        return "\n".join(f"{m['role']}: {m['content']}" for m in messages) + "\nassistant:"


class ValidationTests(unittest.TestCase):
    def test_validation_rejects_bad_request_shapes(self) -> None:
        with self.assertRaisesRegex(ValueError, "request must"):
            SERVICE.validate_request([])
        with self.assertRaisesRegex(ValueError, "request_id must"):
            SERVICE.validate_request({"state": "page", "questions": {}})
        with self.assertRaisesRegex(ValueError, "state must"):
            SERVICE.validate_request({"request_id": "one", "state": None, "questions": {}})
        with self.assertRaisesRegex(ValueError, "questions must"):
            SERVICE.validate_request({"request_id": "one", "state": "page", "questions": []})

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
        with self.assertRaisesRegex(ValueError, "type must be one of"):
            SERVICE.validate_request(
                {
                    "request_id": "one",
                    "state": "page",
                    "questions": {
                        "operation": {
                            "type": "rank",
                            "instructions": "Score",
                            "criteria": {"0": "bad", "1": "good"},
                        }
                    },
                }
            )
        with self.assertRaisesRegex(ValueError, "score criteria must be an array"):
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
        with self.assertRaisesRegex(ValueError, "noul criteria"):
            SERVICE.validate_request(
                {
                    "request_id": "one",
                    "state": "page",
                    "questions": {
                        "q": {"type": "noul", "instructions": "Is it?", "criteria": {"maybe": "x"}}
                    },
                }
            )

    def test_validation_rejects_oversized_state_and_invalid_criteria(self) -> None:
        question = QUESTIONS["operation"]
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
                    "questions": {"operation": {**question, "criteria": {"WAIT": 1}}},
                }
            )

    def test_validate_image_accepts_and_rejects(self) -> None:
        self.assertIsNone(SERVICE.validate_image({}))
        image = {"data": "aGk=", "mime_type": "image/jpeg"}
        self.assertEqual(SERVICE.validate_image({"image": image}), image)
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


class ProtocolTests(unittest.TestCase):
    def test_protocol_emits_openjev_answers(self) -> None:
        request = {"request_id": "one", "state": "page", "questions": QUESTIONS}
        result = {
            "answers": {
                "operation": {
                    "type": "choice",
                    "choice": "WAIT",
                    "probabilities": {"WAIT": 0.8, "DONE": 0.2},
                }
            },
            "usage": {"input_tokens": 3, "total_seconds": 0.1},
        }
        output = io.StringIO()
        with patch.object(SERVICE, "predict", return_value=result) as predict, redirect_stdout(
            output
        ):
            SERVICE.handle_line(json.dumps(request))

        predict.assert_called_once_with("page", QUESTIONS)
        self.assertEqual(json.loads(output.getvalue()), {"request_id": "one", **result})

    def test_handle_line_forwards_the_screenshot(self) -> None:
        image = {"data": "aGk=", "mime_type": "image/png"}
        request = {"request_id": "one", "state": "page", "questions": QUESTIONS, "image": image}
        result = {"answers": {}, "image": {"used": False, "reason": "no"}}
        output = io.StringIO()
        with patch.object(SERVICE, "predict", return_value=result) as predict, redirect_stdout(
            output
        ):
            SERVICE.handle_line(json.dumps(request))

        predict.assert_called_once_with("page", QUESTIONS, image)
        self.assertEqual(json.loads(output.getvalue())["image"], result["image"])

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


class PredictTests(unittest.TestCase):
    def test_predict_scores_each_question_and_picks_the_most_probable_id(self) -> None:
        tokenizer = FakeTokenizer()
        with patch.object(SERVICE, "load", return_value=("model", tokenizer)), patch.object(
            SERVICE, "score_choices", return_value={"WAIT": 0.25, "DONE": 0.75}
        ) as score:
            result = SERVICE.predict({"page": {"url": "u", "text": "hello"}}, QUESTIONS)

        answer = result["answers"]["operation"]
        self.assertEqual(answer["type"], "choice")
        self.assertEqual(answer["choice"], "DONE")
        self.assertEqual(answer["probabilities"], {"WAIT": 0.25, "DONE": 0.75})
        self.assertGreater(result["usage"]["input_tokens"], 0)
        self.assertIn("total_seconds", result["usage"])
        self.assertNotIn("image", result)
        self.assertEqual(score.call_args.args[3], ["WAIT", "DONE"])

    def test_predict_reports_image_unused(self) -> None:
        with patch.object(SERVICE, "load", return_value=("model", FakeTokenizer())), patch.object(
            SERVICE, "score_choices", return_value={"WAIT": 0.5, "DONE": 0.5}
        ):
            result = SERVICE.predict(
                "page", QUESTIONS, {"data": "aGk=", "mime_type": "image/png"}
            )
        self.assertEqual(
            result["image"],
            {"used": False, "reason": "vision not supported by mlx text backend"},
        )

    def test_choice_answer_carries_typesafe_confidence(self) -> None:
        with patch.object(SERVICE, "load", return_value=("model", FakeTokenizer())), patch.object(
            SERVICE, "score_choices", return_value={"WAIT": 0.25, "DONE": 0.75}
        ):
            answer = SERVICE.predict("page", QUESTIONS)["answers"]["operation"]
        # (0.75 - 1/2) / (1 - 1/2)
        self.assertAlmostEqual(answer["confidence"], 0.5)

    def test_score_question_returns_expected_level_legend_and_confidence(self) -> None:
        levels = ["Cosmetic", {"what": "Degraded", "examples": ["works in Chrome"]}, "Blocking"]
        question = {"sev": {"type": "score", "instructions": "How severe?", "criteria": levels}}
        with patch.object(SERVICE, "load", return_value=("model", FakeTokenizer())), patch.object(
            SERVICE, "score_choices", return_value={"0": 0.0, "1": 0.57, "2": 0.43}
        ) as score:
            answer = SERVICE.predict("bug report", question)["answers"]["sev"]
        self.assertEqual(score.call_args.args[3], ["0", "1", "2"])
        self.assertEqual(answer["type"], "score")
        self.assertAlmostEqual(answer["score"], 1.43)
        # TypeSafe docs example: (0, 0.57, 0.43) -> 0.355
        self.assertAlmostEqual(answer["confidence"], 0.355, places=3)
        self.assertEqual(answer["legend"]["1"], levels[1])
        self.assertEqual(answer["probabilities"], {"0": 0.0, "1": 0.57, "2": 0.43})

    def test_noul_question_returns_probability_of_yes(self) -> None:
        question = {"q": {"type": "noul", "instructions": "Is it urgent?"}}
        with patch.object(SERVICE, "load", return_value=("model", FakeTokenizer())), patch.object(
            SERVICE, "score_choices", return_value={"yes": 0.9, "no": 0.1}
        ) as score:
            answer = SERVICE.predict("now please", question)["answers"]["q"]
        self.assertEqual(score.call_args.args[3], ["yes", "no"])
        self.assertEqual(answer, {"type": "noul", "noul": 0.9})

    def test_validation_accepts_typesafe_question_shapes(self) -> None:
        SERVICE.validate_request(
            {
                "request_id": "one",
                "state": {"ticket": "refund please"},
                "questions": {
                    "c": {"type": "choice", "instructions": "Dept?", "criteria": {"billing": None, "returns": {"what": "returns"}}},
                    "s": {"type": "score", "instructions": "Mood?", "criteria": ["Calm", "Angry"]},
                    "n": {"type": "noul", "instructions": "Refund?", "criteria": {"true": "asks", "false": "no"}},
                    "n2": {"type": "noul", "instructions": "Refund?"},
                },
            }
        )


class StateTests(unittest.TestCase):
    CRITERIA = {"a": "first", "b": "second"}

    def test_object_state_without_page_reaches_the_prompt(self) -> None:
        tokenizer = FakeTokenizer()
        ids = SERVICE.build_prompt_ids(
            tokenizer, "Pick", {"user_message": "convert json to yaml"}, self.CRITERIA
        )
        prompt = tokenizer.decode(ids)
        self.assertIn("convert json to yaml", prompt)
        self.assertIn("INPUT:", prompt)
        self.assertNotIn("PAGE TEXT", prompt)
        self.assertIn("chosen option.", prompt)

    def test_page_state_keeps_extra_top_level_fields(self) -> None:
        tokenizer = FakeTokenizer()
        state = {"page": {"url": "u", "text": "body"}, "goal": "buy milk"}
        prompt = tokenizer.decode(SERVICE.build_prompt_ids(tokenizer, "Pick", state, self.CRITERIA))
        self.assertIn("PAGE TEXT: body", prompt)
        self.assertIn("buy milk", prompt)

    def test_null_description_renders_bare_id(self) -> None:
        tokenizer = FakeTokenizer()
        prompt = tokenizer.decode(
            SERVICE.build_prompt_ids(tokenizer, "Pick", "x", {"alpha": None, "beta": "b"})
        )
        self.assertIn("alpha beta: b", prompt)


class PromptTests(unittest.TestCase):
    CRITERIA = {"CLICK:e1": "Click link one", "DONE": "finished"}

    def test_prompt_layout_follows_the_documented_format(self) -> None:
        tokenizer = FakeTokenizer()
        state = {
            "page": {"url": "https://x.test", "title": "Example", "text": "Header"},
            "recent_actions": [{"operation": "CLICK"}],
        }
        ids = SERVICE.build_prompt_ids(tokenizer, "RULES goal", state, self.CRITERIA)
        prompt = tokenizer.decode(ids)
        self.assertIn("system: RULES goal Reply with only the id of the chosen action.", prompt)
        self.assertIn(
            'URL: https://x.test PAGE TITLE: Example RECENT ACTIONS: [{"operation": "CLICK"}]',
            prompt,
        )
        self.assertIn("PAGE TEXT: Header", prompt)
        self.assertIn("CLICK:e1: Click link one DONE: finished Answer with exactly one id.", prompt)

    def test_missing_recent_actions_render_as_none(self) -> None:
        tokenizer = FakeTokenizer()
        ids = SERVICE.build_prompt_ids(
            tokenizer, {"goal": "g"}, {"page": {"text": "t"}}, self.CRITERIA
        )
        self.assertIn("RECENT ACTIONS: none", tokenizer.decode(ids))

    def test_page_text_is_truncated_to_the_token_budget_but_candidates_survive(self) -> None:
        tokenizer = FakeTokenizer()
        text = " ".join(f"word{i}" for i in range(500))
        state = {"page": {"url": "u", "text": text}}
        ids = SERVICE.build_prompt_ids(tokenizer, "goal", state, self.CRITERIA, max_tokens=120)
        prompt = tokenizer.decode(ids)
        self.assertLessEqual(len(ids), 120)
        self.assertIn("word0", prompt)
        self.assertNotIn("word499", prompt)
        self.assertTrue(prompt.endswith("Answer with exactly one id. assistant:"))
        self.assertIn("CLICK:e1: Click link one", prompt)

    def test_prompt_larger_than_budget_without_page_text_is_an_error(self) -> None:
        with self.assertRaisesRegex(ValueError, "limit is 5"):
            SERVICE.build_prompt_ids(
                FakeTokenizer(), "goal", {"page": {"text": "t"}}, self.CRITERIA, max_tokens=5
            )

    def test_chat_template_without_enable_thinking_falls_back(self) -> None:
        calls: list[dict] = []

        class OldTemplate:
            def apply_chat_template(self, messages, add_generation_prompt, tokenize, **kwargs):
                calls.append(kwargs)
                if kwargs:
                    raise TypeError("unexpected keyword")
                return "prompt"

        self.assertEqual(SERVICE._chat_prompt(OldTemplate(), "s", "u"), "prompt")
        self.assertEqual(calls, [{"enable_thinking": False}, {}])


class TrieTests(unittest.TestCase):
    # Token ids: CLICK=1 ':'=2 digits 11/12 END=99 ; DONE=3.
    SEQUENCES = {
        "CLICK:e1": [1, 2, 11, 99],
        "CLICK:e12": [1, 2, 11, 12, 99],
        "CLICK:e2": [1, 2, 12, 99],
        "DONE": [3, 99],
    }

    @staticmethod
    def run_trie(sequences, distributions):
        """Drive trie_probabilities; the 'state' is the token path fed so far."""
        advances: list[tuple[int, ...]] = []
        clones: list[tuple[int, ...]] = []

        def weigh(path, tokens):
            raw = [distributions[tuple(path)][t] for t in tokens]
            total = sum(raw)
            return [value / total for value in raw]

        def advance(path, tokens):
            advances.append((*path, *tokens))
            return [*path, *tokens]

        def clone(path):
            clones.append(tuple(path))
            return list(path)

        root = SERVICE.build_trie(sequences)
        result = SERVICE.trie_probabilities(root, [], weigh, advance, clone)
        return result, advances, clones

    def test_probabilities_are_a_distribution_over_every_id(self) -> None:
        distributions = {
            (): {1: 3.0, 3: 1.0, 7: 100.0},  # token 7 is not a candidate: never offered
            (1, 2): {11: 2.0, 12: 2.0},
            (1, 2, 11): {99: 1.0, 12: 3.0},
        }
        probabilities, _, _ = self.run_trie(self.SEQUENCES, distributions)

        self.assertEqual(set(probabilities), set(self.SEQUENCES))
        self.assertAlmostEqual(sum(probabilities.values()), 1.0)
        self.assertAlmostEqual(probabilities["DONE"], 0.25)
        self.assertAlmostEqual(probabilities["CLICK:e2"], 0.75 * 0.5)
        self.assertAlmostEqual(probabilities["CLICK:e1"], 0.75 * 0.5 * 0.25)
        self.assertAlmostEqual(probabilities["CLICK:e12"], 0.75 * 0.5 * 0.75)
        self.assertEqual(max(probabilities, key=probabilities.get), "CLICK:e2")

    def test_model_only_runs_at_branch_points_and_forced_edges_are_batched(self) -> None:
        distributions = {
            (): {1: 1.0, 3: 1.0},
            (1, 2): {11: 1.0, 12: 1.0},
            (1, 2, 11): {99: 1.0, 12: 1.0},
        }
        _, advances, clones = self.run_trie(self.SEQUENCES, distributions)
        # CLICK and ':' are forced, so they are fed together before the digit branch.
        self.assertEqual(advances, [(1, 2), (1, 2, 11)])
        # Only one subtree ever branches again, so no state copy is needed at all.
        self.assertEqual(clones, [])

    def test_state_is_copied_only_for_earlier_branching_siblings(self) -> None:
        sequences = {"A1": [5, 1, 99], "A2": [5, 2, 99], "B1": [6, 1, 99], "B2": [6, 2, 99]}
        distributions = {(): {5: 1.0, 6: 1.0}, (5,): {1: 1.0, 2: 1.0}, (6,): {1: 1.0, 2: 1.0}}
        probabilities, advances, clones = self.run_trie(sequences, distributions)
        self.assertEqual(clones, [()])
        self.assertEqual(advances, [(5,), (6,)])
        self.assertTrue(all(abs(v - 0.25) < 1e-9 for v in probabilities.values()))

    def test_single_candidate_needs_no_model_call(self) -> None:
        probabilities, advances, clones = self.run_trie({"DONE": [3, 99]}, {})
        self.assertEqual(probabilities, {"DONE": 1.0})
        self.assertEqual((advances, clones), ([], []))

    def test_prefix_ids_are_distinguished_by_the_end_token(self) -> None:
        sequences = {"A": [5, 99], "AB": [5, 6, 99]}
        probabilities, _, _ = self.run_trie(sequences, {(): {5: 1.0}, (5,): {99: 3.0, 6: 1.0}})
        self.assertAlmostEqual(probabilities["A"], 0.75)
        self.assertAlmostEqual(probabilities["AB"], 0.25)


@unittest.skipUnless(importlib.util.find_spec("mlx"), "mlx is not installed")
class ScoreChoicesTests(unittest.TestCase):
    """score_choices with real mlx arrays and a fake uniform model (no weights loaded)."""

    END = 127

    class UniformModel:
        def __init__(self) -> None:
            self.calls: list[int] = []

        def make_cache(self) -> list:
            return []

        def __call__(self, tokens, cache):
            import mlx.core as mx

            self.calls.append(tokens.shape[1])
            cache.append(tokens.shape[1])
            return mx.zeros((1, tokens.shape[1], 128))

    def tokenizer(self):
        tokenizer = FakeTokenizer()
        tokenizer.encode = lambda text, add_special_tokens=True: (
            [self.END] if text == "<|im_end|>" else [ord(char) for char in text]
        )
        return tokenizer

    def test_uniform_model_gives_uniform_branch_probabilities(self) -> None:
        model = self.UniformModel()
        probabilities = SERVICE.score_choices(
            model, self.tokenizer(), [1, 2, 3], ["ab", "ac", "b"]
        )
        self.assertAlmostEqual(sum(probabilities.values()), 1.0, places=5)
        self.assertAlmostEqual(probabilities["b"], 0.5, places=5)
        self.assertAlmostEqual(probabilities["ab"], 0.25, places=5)
        self.assertAlmostEqual(probabilities["ac"], 0.25, places=5)
        # One prefill over the prompt, then a single step feeding 'a' to reach its branch.
        self.assertEqual(model.calls, [3, 1])


class ModelLoadingTests(unittest.TestCase):
    def setUp(self) -> None:
        setattr(SERVICE, "_model", None)
        setattr(SERVICE, "_tokenizer", None)

    tearDown = setUp

    def test_load_uses_mlx_lm_once_and_limits_memory(self) -> None:
        fake_mx = SimpleNamespace(
            set_memory_limit=Mock(), get_active_memory=lambda: 2 * 1024**3
        )
        mlx_load = Mock(return_value=("model", "tokenizer"))
        modules = {
            "mlx": SimpleNamespace(core=fake_mx),
            "mlx.core": fake_mx,
            "mlx_lm": SimpleNamespace(load=mlx_load),
        }
        stderr = io.StringIO()
        with patch.dict(sys.modules, modules), redirect_stderr(stderr):
            first = SERVICE.load()
            second = SERVICE.load()

        self.assertEqual(first, ("model", "tokenizer"))
        self.assertEqual(second, first)
        mlx_load.assert_called_once_with(SERVICE.MODEL_PATH)
        fake_mx.set_memory_limit.assert_called_once_with(SERVICE.MEMORY_LIMIT_BYTES)
        event = json.loads(stderr.getvalue())
        self.assertEqual(event["event"], "model_loaded")
        self.assertEqual(event["backend"], "mlx_lm")

    def test_missing_dependencies_raise_a_clear_error(self) -> None:
        with patch.dict(sys.modules, {"mlx": None, "mlx.core": None}):
            with self.assertRaisesRegex(RuntimeError, "mlx-lm"):
                SERVICE.load()

    def test_unload_drops_model_and_reload_calls_mlx_again(self) -> None:
        fake_mx = SimpleNamespace(
            set_memory_limit=Mock(),
            get_active_memory=lambda: 0,
            clear_cache=Mock(),
        )
        mlx_load = Mock(return_value=("model", "tokenizer"))
        modules = {
            "mlx": SimpleNamespace(core=fake_mx),
            "mlx.core": fake_mx,
            "mlx_lm": SimpleNamespace(load=mlx_load),
        }
        stderr = io.StringIO()
        with patch.dict(sys.modules, modules), redirect_stderr(stderr):
            self.assertFalse(SERVICE.unload())  # nothing loaded yet
            SERVICE.load()
            self.assertTrue(SERVICE.unload())
            self.assertIsNone(SERVICE._model)
            self.assertIsNone(SERVICE._tokenizer)
            SERVICE.load()

        self.assertEqual(mlx_load.call_count, 2)
        fake_mx.clear_cache.assert_called()
        events = [json.loads(line)["event"] for line in stderr.getvalue().splitlines()]
        self.assertEqual(events, ["model_loaded", "model_unloaded", "model_loaded"])


if __name__ == "__main__":
    unittest.main()
