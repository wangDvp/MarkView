"""Regression for the macOS host's app identity, migration and repeat installation.
Run: python3 tests/native/verify_launcher.py
Requires installed Command Line Tools (clang/codesign). Uses and cleans only an
owned temporary install/profile/document; never changes system privacy grants.
"""
import base64
import hashlib
import json
from pathlib import Path
import plistlib
import secrets
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"

with tempfile.TemporaryDirectory(prefix="markview-launcher-regression-") as temporary:
    helper = Path(temporary) / "中文 空格 助手"
    registration = Path(temporary) / "profile/NativeMessagingHosts"
    helper.mkdir()
    registration.mkdir(parents=True)
    # Reproduce the earlier installation shape without executing its shell.
    secret = secrets.token_hex(32)
    (helper / "config.json").write_text(json.dumps({"app": "MarkView local save", "secret": secret, "allowed_origins": [ORIGIN]}))
    legacy = helper / "launch"
    legacy.write_text("#!/bin/sh\nexit 1\n")
    manifest_file = registration / "com.markview.local_save.json"
    manifest_file.write_text(json.dumps({"name": "com.markview.local_save", "path": str(legacy)}))
    command = [sys.executable, str(ROOT / "native/install.py"), "--extension-id", ORIGIN.split("/")[2],
               "--install-dir", str(helper), "--manifest-dir", str(registration)]
    subprocess.run(command, check=True, capture_output=True, timeout=60)
    manifest = json.loads(manifest_file.read_text())
    launcher = Path(manifest["path"])
    bundle = launcher.parents[2]
    assert launcher != legacy and launcher.is_file()
    assert manifest["allowed_origins"] == [ORIGIN]
    assert plistlib.loads((bundle / "Contents/Info.plist").read_bytes())["CFBundleIdentifier"] == "com.markview.local-save"
    subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(bundle)], check=True, capture_output=True)
    before, binary = launcher.stat(), launcher.read_bytes()
    subprocess.run(command, check=True, capture_output=True, timeout=60)
    after = launcher.stat()
    assert launcher.read_bytes() == binary and (after.st_ino, after.st_mtime_ns) == (before.st_ino, before.st_mtime_ns)
    assert json.loads((helper / "config.json").read_text())["secret"] == secret

    def request(payload, origin=ORIGIN):
        body = json.dumps(payload).encode()
        result = subprocess.run([str(launcher), origin], input=struct.pack("=I", len(body)) + body,
                                capture_output=True, timeout=25)
        if origin != ORIGIN:
            assert result.returncode != 0 and not result.stdout
            return
        assert result.returncode == 0 and not result.stderr
        length = struct.unpack("=I", result.stdout[:4])[0]
        assert length == len(result.stdout) - 4
        response = json.loads(result.stdout[4:])
        assert response["ok"], response.get("code")
        return response

    fixture = Path(temporary) / "document.md"
    fixture.write_text("# 原文\n")
    opened = request({"op": "open", "url": fixture.as_uri(), "expectedDigest": hashlib.sha256(fixture.read_bytes()).hexdigest()})
    changed = "# 新启动器真实保存\n".encode()
    request({"op": "save", "token": opened["token"], "content": base64.b64encode(changed).decode()})
    assert fixture.read_bytes() == changed
    request({}, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/")
print("PASS shell migration, signed app identity, stable repeat install, Unicode install path and real stdio save/origin gate")
