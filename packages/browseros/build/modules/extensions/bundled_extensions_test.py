#!/usr/bin/env python3
"""Tests for bundled extension manifest handling."""

import json
import tempfile
import unittest
from pathlib import Path

from build.modules.extensions.bundled_extensions import (
    REQUIRED_BUNDLED_EXTENSION_IDS,
    BundledExtensionsModule,
    ExtensionInfo,
)

CLAW_EXTENSION_ID = "pjimfkbpehlcllblajnpfamdfjhhlgkc"


class BundledExtensionsManifestTest(unittest.TestCase):
    def test_bundled_manifest_parses_requested_alpha_entries(self) -> None:
        repo_root = Path(__file__).resolve().parents[5]
        manifest_path = repo_root / "updates" / "extensions" / "bundled-manifest.xml"

        extensions = BundledExtensionsModule()._parse_manifest_xml(
            manifest_path.read_text()
        )

        self.assertEqual(
            extensions,
            [
                (
                    "adlpneommgkgeanpaekgoaolcpncohkf",
                    "52.0.0.0",
                    "https://cdn.browseros.com/extensions/bugreporter-52.0.0.0.crx",
                ),
                (
                    "bflpfmnmnokmjhmgnolecpppdbdophmk",
                    "0.0.115.0",
                    "https://cdn.browseros.com/extensions/agent-0.0.115.0.crx",
                ),
                (
                    CLAW_EXTENSION_ID,
                    "0.0.1",
                    "https://cdn.browseros.com/extensions/browserclaw-0.0.1.crx",
                ),
            ],
        )

    def test_required_ids_cover_agent_bug_reporter_and_claw(self) -> None:
        self.assertEqual(
            REQUIRED_BUNDLED_EXTENSION_IDS,
            {
                "adlpneommgkgeanpaekgoaolcpncohkf": "BrowserOS bug reporter",
                "bflpfmnmnokmjhmgnolecpppdbdophmk": "BrowserOS agent",
                CLAW_EXTENSION_ID: "BrowserOS Claw app",
            },
        )

    def test_generated_json_maps_claw_id_to_crx(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            BundledExtensionsModule()._generate_json(
                [
                    ExtensionInfo(
                        id=CLAW_EXTENSION_ID,
                        version="0.0.1",
                        codebase=(
                            "https://cdn.browseros.com/extensions/"
                            "browserclaw-0.0.1.crx"
                        ),
                    )
                ],
                output_dir,
            )

            data = json.loads((output_dir / "bundled_extensions.json").read_text())

        self.assertEqual(
            data[CLAW_EXTENSION_ID],
            {
                "external_crx": f"{CLAW_EXTENSION_ID}.crx",
                "external_version": "0.0.1",
            },
        )

    def test_missing_claw_app_fails_validation(self) -> None:
        extensions = [
            ExtensionInfo(
                id="adlpneommgkgeanpaekgoaolcpncohkf",
                version="52.0.0.0",
                codebase="https://cdn.browseros.com/extensions/bugreporter.crx",
            ),
            ExtensionInfo(
                id="bflpfmnmnokmjhmgnolecpppdbdophmk",
                version="0.0.115.0",
                codebase="https://cdn.browseros.com/extensions/agent.crx",
            ),
        ]

        with self.assertRaisesRegex(
            RuntimeError,
            f"BrowserOS Claw app \\({CLAW_EXTENSION_ID}\\)",
        ):
            BundledExtensionsModule()._validate_required_extensions(extensions)


if __name__ == "__main__":
    unittest.main()
