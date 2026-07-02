#!/usr/bin/env python3
"""Tests for Windows signing path discovery."""

import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest import mock

from .windows import (
    WindowsSignModule,
    get_browseros_server_binary_paths,
    get_existing_browseros_server_binary_paths,
    get_missing_required_browseros_server_binary_paths,
)


class WindowsSignPathsTest(unittest.TestCase):
    def test_browseros_and_claw_server_binaries_are_expected_for_signing(self):
        build_output_dir = Path("/tmp/out/Default")

        self.assertEqual(
            get_browseros_server_binary_paths(build_output_dir),
            [
                build_output_dir
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros_server.exe",
                build_output_dir
                / "BrowserOSClawServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros-claw-server.exe",
            ],
        )

    def test_missing_optional_claw_binary_is_not_required_before_packaging(self):
        with TemporaryDirectory() as tmp:
            build_output_dir = Path(tmp)
            self._write_binary(
                build_output_dir
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros_server.exe"
            )

            self.assertEqual(
                get_existing_browseros_server_binary_paths(build_output_dir),
                [
                    build_output_dir
                    / "BrowserOSServer"
                    / "default"
                    / "resources"
                    / "bin"
                    / "browseros_server.exe"
                ],
            )
            self.assertEqual(
                get_missing_required_browseros_server_binary_paths(build_output_dir),
                [],
            )

    def test_missing_claw_binary_is_required_once_root_is_packaged(self):
        with TemporaryDirectory() as tmp:
            build_output_dir = Path(tmp)
            self._write_binary(
                build_output_dir
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros_server.exe"
            )
            (
                build_output_dir
                / "BrowserOSClawServer"
                / "default"
                / "resources"
                / "bin"
            ).mkdir(parents=True)

            self.assertEqual(
                get_missing_required_browseros_server_binary_paths(build_output_dir),
                [
                    build_output_dir
                    / "BrowserOSClawServer"
                    / "default"
                    / "resources"
                    / "bin"
                    / "browseros-claw-server.exe"
                ],
            )

    def test_sign_executables_fails_when_required_server_binary_missing(self):
        with TemporaryDirectory() as tmp:
            build_output_dir = Path(tmp)
            self._write_binary(build_output_dir / "chrome.exe")

            with self.assertRaisesRegex(RuntimeError, "browseros_server.exe"):
                WindowsSignModule()._sign_executables(build_output_dir, mock.Mock())

    def _write_binary(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"binary")


if __name__ == "__main__":
    unittest.main()
