"""Real archive regression for the release boundary; no network/browser/builds.
Run: python3 tests/test_release_package.py
Creates/removes only owned temporary source/output fixtures.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release_package", ROOT / "scripts/package-release.py")
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="markview-release-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "source"
        self.output = Path(self.temporary.name) / "output"
        for name in RELEASE.RUNTIME_FILES + RELEASE.DEVELOPMENT_FILES:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, file)

    def test_archives_include_runtime_and_licenses_but_never_local_data(self):
        excluded = ("node_modules/fake.js", "native/config.json", "native/Private.app/Contents/MacOS/launch",
                    ".env", "docs/session-notes/private.md", "tests/artifacts/private.png", ".git/config")
        for name in excluded:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("private test marker")
        outputs = RELEASE.package_release(self.root, self.output)
        for file, expected in zip(outputs[:2], (RELEASE.RUNTIME_FILES, RELEASE.RUNTIME_FILES + RELEASE.DEVELOPMENT_FILES)):
            with zipfile.ZipFile(file) as archive:
                self.assertEqual(archive.testzip(), None)
                self.assertEqual(set(archive.namelist()), set(expected))
                self.assertTrue(set(excluded).isdisjoint(archive.namelist()))
                for name in expected:
                    self.assertEqual(archive.read(name), (self.root / name).read_bytes())
        for line in outputs[2].read_text().splitlines():
            digest, name = line.split("  ")
            self.assertEqual(digest, hashlib.sha256((self.output / name).read_bytes()).hexdigest())
        before = [file.read_bytes() for file in outputs]
        with self.assertRaises(FileExistsError):
            RELEASE.package_release(self.root, self.output)
        self.assertEqual([file.read_bytes() for file in outputs], before)

    def test_missing_license_or_runtime_asset_refuses_to_publish(self):
        for name in ("LICENSE", "fonts/NotoSansSC-Regular.otf"):
            with self.subTest(name=name):
                file = self.root / name
                content = file.read_bytes()
                file.unlink()
                try:
                    with self.assertRaises(ValueError):
                        RELEASE.package_release(self.root, self.output)
                    self.assertFalse(self.output.exists())
                finally:
                    file.write_bytes(content)

    def test_linked_asset_and_version_mismatch_are_rejected(self):
        file = self.root / "README.md"
        content = file.read_bytes()
        outside = Path(self.temporary.name) / "outside.md"
        outside.write_bytes(content)
        file.unlink()
        file.symlink_to(outside)
        with self.assertRaises(ValueError):
            RELEASE.package_release(self.root, self.output)
        file.unlink()
        file.write_bytes(content)
        package = json.loads((self.root / "package.json").read_text())
        package["version"] = "0.0.0"
        (self.root / "package.json").write_text(json.dumps(package))
        with self.assertRaises(ValueError):
            RELEASE.package_release(self.root, self.output)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
