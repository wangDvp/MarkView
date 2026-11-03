"""Real filesystem/protocol regression for the native host.
Run: python3 tests/native/test_save.py
Uses owned temporary directories and short-lived child processes only; no Chrome registration.
MARKVIEW_TEST_HOST may point to a baseline helper for a targeted regression comparison.
"""
import base64
import hashlib
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import secrets
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("markview_host", os.environ.get("MARKVIEW_TEST_HOST", ROOT / "native/save_host.py"))
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)
ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"


def competing_save(secret, token, data, barrier, results):
    barrier.wait(timeout=5)
    try:
        HOST.Host(secret, ORIGIN).save({"token": token, "content": base64.b64encode(data).decode()})
        results.put("ok")
    except HOST.HostError as error:
        results.put(error.code)


class NativeSaveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="markview-native-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.path = self.directory / "中文 空格 # 文档.md"
        self.original = b"\xef\xbb\xbf# original\r\n"
        self.path.write_bytes(self.original)
        self.path.chmod(0o640)
        self.secret = secrets.token_bytes(32)
        self.host = HOST.Host(self.secret, ORIGIN)

    def opened(self, path=None):
        path = path or self.path
        return self.host.open({"url": path.as_uri(), "expectedDigest": hashlib.sha256(path.read_bytes()).hexdigest()})

    def write(self, token, data):
        return self.host.save({"token": token, "content": base64.b64encode(data).decode()})

    def test_existing_unicode_path_and_raw_encoding_overwrite(self):
        opened = self.opened()
        changed = b"\xff\xfe" + "# 中文修改\r\n".encode("utf-16le")
        result = self.write(opened["token"], changed)
        self.assertEqual(self.path.read_bytes(), changed)
        self.assertEqual(result["digest"], hashlib.sha256(changed).hexdigest())
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o640)
        self.assertEqual(sorted(p.name for p in self.directory.iterdir()), [self.path.name])

    @unittest.skipUnless(hasattr(os, "O_SEARCH"), "Requires directory search descriptors")
    def test_ancestor_only_needs_search_permission(self):
        ancestor = self.directory / "traverse-only"
        parent = ancestor / "document-folder"
        parent.mkdir(parents=True)
        source = parent / "document.md"
        source.write_bytes(self.original)
        ancestor.chmod(0o111)
        try:
            opened = self.opened(source)
            result = self.write(opened["token"], b"saved without listing ancestor")
            self.assertEqual(source.read_bytes(), b"saved without listing ancestor")
            self.assertEqual(result["digest"], hashlib.sha256(source.read_bytes()).hexdigest())
        finally:
            ancestor.chmod(0o700)

    def test_unchanged_save_is_idempotent(self):
        opened = self.opened()
        before = self.path.stat()
        self.write(opened["token"], self.original)
        self.write(opened["token"], self.original)
        self.assertEqual(HOST.stamp(self.path.stat()), HOST.stamp(before))

    def test_changed_preview_is_refused_at_open(self):
        expected = hashlib.sha256(self.original).hexdigest()
        self.path.write_bytes(b"external edit")
        with self.assertRaises(HOST.HostError) as error:
            self.host.open({"url": self.path.as_uri(), "expectedDigest": expected})
        self.assertEqual(error.exception.code, "conflict")
        self.assertEqual(self.path.read_bytes(), b"external edit")

    def test_browser_text_fallback_binds_raw_version_and_encoding(self):
        text = "# UTF16 正文\r\n\r\n正文\r\n"
        self.path.write_bytes(b"\xff\xfe" + text.encode("utf-16le"))
        expected = hashlib.sha256(text.replace("\r\n", "\n").encode()).hexdigest()
        opened = self.host.open({"url": self.path.as_uri(), "expectedTextDigest": expected})
        self.assertEqual(opened["encoding"], "UTF-16 LE")
        self.assertEqual(opened["eol"], "\r\n")
        self.assertTrue(opened["bom"])
        changed = b"\xff\xfe" + "# 更新\r\n".encode("utf-16le")
        self.write(opened["token"], changed)
        self.assertEqual(self.path.read_bytes(), changed)

    def test_external_modification_between_open_and_save(self):
        opened = self.opened()
        self.path.write_bytes(b"external edit")
        with self.assertRaises(HOST.HostError) as error:
            self.write(opened["token"], b"must not win")
        self.assertEqual(error.exception.code, "conflict")
        self.assertEqual(self.path.read_bytes(), b"external edit")

    def test_signed_capability_cannot_be_forged_or_reused_by_other_origin(self):
        token = self.opened()["token"]
        for forged in (token + "x", "arbitrary.path", ""):
            with self.assertRaises(HOST.HostError):
                self.write(forged, b"bad")
        with self.assertRaises(HOST.HostError):
            HOST.Host(self.secret, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/").verify(token)
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_remote_non_markdown_and_traversal_paths_are_refused(self):
        other = self.directory / "private.txt"
        other.write_bytes(b"private")
        urls = ["https://example.com/a.md", "file://server/a.md", other.as_uri(),
                self.path.as_uri() + "?other", self.path.as_uri() + "#other",
                "file:///tmp/%2e%2e/private.md", "file:///tmp/a%00.md"]
        for url in urls:
            with self.subTest(url=url), self.assertRaises(HOST.HostError):
                self.host.open({"url": url, "expectedDigest": "0" * 64})

    def test_symlink_target_change_cannot_redirect_write(self):
        link = self.directory / "link.md"
        link.symlink_to(self.path)
        token = self.opened(link)["token"]
        other = self.directory / "other.md"
        other.write_bytes(b"other file")
        link.unlink()
        link.symlink_to(other)
        with self.assertRaises(HOST.HostError):
            self.write(token, b"redirected")
        self.assertEqual(other.read_bytes(), b"other file")
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_readonly_file_is_not_replaced_using_directory_permissions(self):
        token = self.opened()["token"]
        self.path.chmod(0o440)
        with self.assertRaises((HOST.HostError, PermissionError)):
            self.write(token, b"bad")
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_atomic_replace_failure_keeps_original_and_cleans_owned_temporary(self):
        token = self.opened()["token"]
        with patch.object(HOST.os, "replace", side_effect=OSError("controlled failure")):
            with self.assertRaises(OSError):
                self.write(token, b"new data")
        self.assertEqual(self.path.read_bytes(), self.original)
        self.assertFalse(list(self.directory.glob(".markview-*")))

    def test_size_and_invalid_payload_boundaries(self):
        token = self.opened()["token"]
        for content in ("!invalid!", base64.b64encode(b"x" * (HOST.MAX_BYTES + 1)).decode()):
            with self.assertRaises(HOST.HostError):
                self.host.save({"token": token, "content": content})
        self.assertEqual(self.path.read_bytes(), self.original)
        self.write(token, b"")
        self.assertEqual(self.path.read_bytes(), b"")

    def test_concurrent_saves_have_one_winner(self):
        token = self.opened()["token"]
        context = multiprocessing.get_context("fork")
        barrier, results = context.Barrier(2), context.Queue()
        children = [context.Process(target=competing_save, args=(self.secret, token, data, barrier, results))
                    for data in (b"first writer", b"second writer")]
        try:
            for child in children:
                child.start()
            outcomes = [results.get(timeout=8) for _ in children]
            self.assertEqual(outcomes.count("ok"), 1)
            self.assertIn(next(value for value in outcomes if value != "ok"), ("busy", "conflict"))
            self.assertIn(self.path.read_bytes(), (b"first writer", b"second writer"))
        finally:
            for child in children:
                child.join(timeout=2)
                if child.is_alive():
                    child.terminate()
                    child.join()
            results.close()

    def test_actual_stdio_protocol_and_origin_gate(self):
        host_file = self.directory / "save_host.py"
        shutil.copyfile(ROOT / "native/save_host.py", host_file)
        (self.directory / "config.json").write_text(json.dumps({"secret": self.secret.hex(), "allowed_origins": [ORIGIN]}))

        def request(payload, origin=ORIGIN):
            body = json.dumps(payload).encode()
            result = subprocess.run([sys.executable, str(host_file), origin],
                                    input=struct.pack("=I", len(body)) + body, capture_output=True, timeout=10)
            if origin != ORIGIN:
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(result.stdout)
                return
            self.assertEqual(result.returncode, 0, result.stderr)
            length = struct.unpack("=I", result.stdout[:4])[0]
            self.assertLess(length, 1024 * 1024)
            self.assertEqual(length, len(result.stdout) - 4)
            self.assertFalse(result.stderr)
            return json.loads(result.stdout[4:])

        opened = request({"op": "open", "url": self.path.as_uri(), "expectedDigest": hashlib.sha256(self.original).hexdigest()})
        changed = "# 大于 1 MB 的真实正文\n".encode() + b"a" * (2 * 1024 * 1024)
        saved = request({"op": "save", "token": opened["token"], "content": base64.b64encode(changed).decode()})
        self.assertTrue(saved["ok"])
        self.assertEqual(self.path.read_bytes(), changed)
        request({}, origin="chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/")


if __name__ == "__main__":
    unittest.main(verbosity=2)
