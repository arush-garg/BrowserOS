#!/usr/bin/env python3
"""Tests for Linux packaging architecture helpers."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from build.modules.package.linux import (
    LINUX_HOST_APPIMAGETOOL,
    copy_browser_files,
    get_host_appimagetool,
    get_linux_architecture_config,
)


class LinuxArchitectureConfigTest(unittest.TestCase):
    def test_returns_x64_packaging_config(self) -> None:
        config = get_linux_architecture_config("x64")

        self.assertEqual(config["appimage_arch"], "x86_64")
        self.assertEqual(config["deb_arch"], "amd64")

    def test_returns_arm64_packaging_config(self) -> None:
        config = get_linux_architecture_config("arm64")

        self.assertEqual(config["appimage_arch"], "aarch64")
        self.assertEqual(config["deb_arch"], "arm64")

    def test_rejects_unsupported_architecture(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported Linux architecture"):
            get_linux_architecture_config("universal")


class HostAppImageToolTest(unittest.TestCase):
    """The appimagetool binary must match the BUILD machine's arch, not
    the target arch — otherwise cross-compiling arm64 packages from an x64
    host fails because the aarch64 tool can't execute on x64."""

    def test_x64_host_picks_x86_64_tool(self) -> None:
        with patch(
            "build.modules.package.linux.get_platform_arch", return_value="x64"
        ):
            filename, url = get_host_appimagetool()

        self.assertEqual(filename, "appimagetool-x86_64.AppImage")
        self.assertIn("x86_64", url)

    def test_arm64_host_picks_aarch64_tool(self) -> None:
        with patch(
            "build.modules.package.linux.get_platform_arch", return_value="arm64"
        ):
            filename, url = get_host_appimagetool()

        self.assertEqual(filename, "appimagetool-aarch64.AppImage")
        self.assertIn("aarch64", url)

    def test_host_lookup_independent_of_target(self) -> None:
        # Both architectures must be present in the host lookup so cross
        # builds work in either direction.
        self.assertIn("x64", LINUX_HOST_APPIMAGETOOL)
        self.assertIn("arm64", LINUX_HOST_APPIMAGETOOL)


class CopyBrowserFilesTest(unittest.TestCase):
    def test_copies_browseros_and_claw_server_roots_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "out" / "Release"
            target_dir = root / "package"
            out_dir.mkdir(parents=True)
            (out_dir / "browseros").write_text("browser")

            for bundle_name in ("BrowserOSServer", "BrowserOSClawServer"):
                resources = out_dir / bundle_name / "default" / "resources"
                resources.mkdir(parents=True)
                (resources / "marker.txt").write_text(bundle_name)

            ctx = SimpleNamespace(
                chromium_src=root,
                out_dir=Path("out") / "Release",
                BROWSEROS_APP_NAME="browseros",
            )

            with patch("build.modules.package.linux.log_warning"):
                self.assertTrue(copy_browser_files(ctx, target_dir))

            self.assertTrue(
                (
                    target_dir
                    / "BrowserOSServer"
                    / "default"
                    / "resources"
                    / "marker.txt"
                ).exists()
            )
            self.assertTrue(
                (
                    target_dir
                    / "BrowserOSClawServer"
                    / "default"
                    / "resources"
                    / "marker.txt"
                ).exists()
            )


if __name__ == "__main__":
    unittest.main()
