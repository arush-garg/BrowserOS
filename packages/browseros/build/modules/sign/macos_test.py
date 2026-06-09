#!/usr/bin/env python3
"""Tests for macOS app signing discovery."""

import tempfile
import unittest
from pathlib import Path

from .macos import find_components_to_sign


def _write_exec(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(path.stat().st_mode | 0o755)


class MacOSSignDiscoveryTest(unittest.TestCase):
    def test_discovers_registered_server_binaries_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            app_path = Path(tmp) / "BrowserOS.app"
            server_bin = (
                app_path
                / "Contents"
                / "Resources"
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
            )
            _write_exec(server_bin / "browseros_server")
            _write_exec(server_bin / "third_party" / "rg")
            _write_exec(server_bin / "third_party" / "codex")
            _write_exec(server_bin / "third_party" / "claude")
            _write_exec(server_bin / "third_party" / "lima" / "bin" / "limactl")

            executables = set(find_components_to_sign(app_path)["executables"])

            self.assertIn(server_bin / "browseros_server", executables)
            self.assertIn(server_bin / "third_party" / "rg", executables)
            self.assertIn(server_bin / "third_party" / "codex", executables)
            self.assertIn(server_bin / "third_party" / "claude", executables)
            self.assertNotIn(
                server_bin / "third_party" / "lima" / "bin" / "limactl",
                executables,
            )


if __name__ == "__main__":
    unittest.main()
