#!/usr/bin/env python3
"""Install this user's MarkView Native Messaging host; no administrator access required.

Usage: python3 native/install.py [--extension-id ID] [--manifest-dir DIR] [--install-dir DIR]
The defaults register Google Chrome on macOS. Explicit directories allow isolated browser testing.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import sys

HOST = "com.markview.local_save"
APP = "MarkView local save"
ID = re.compile(r"^[a-p]{32}$")
BUNDLE = "MarkView Local Save.app"
EXECUTABLE = "MarkView Local Save"
BUNDLE_ID = "com.markview.local-save"


def detected_ids(repository):
    base = Path.home() / "Library/Application Support/Google/Chrome"
    result = set()
    for profile in [base / "Default", *base.glob("Profile *")]:
        for name in ("Preferences", "Secure Preferences"):
            try:
                settings = json.loads((profile / name).read_text()).get("extensions", {}).get("settings", {})
            except (OSError, ValueError):
                continue
            for extension_id, entry in settings.items():
                value = entry.get("path", "")
                if ID.fullmatch(extension_id) and value and Path(value).is_absolute() and Path(value).resolve() == repository:
                    result.add(extension_id)
    return sorted(result)


def write_file(path, data, mode):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb", closefd=False) as output:
            output.write(data)
    finally:
        os.close(descriptor)


def install_launcher(destination, repository):
    """A shell is a platform binary and cannot receive a folder-consent prompt.

    Give the host its own signed app identity; reuse the exact binary on repeat
    installs so macOS can retain the person's folder permission decisions.
    """
    bundle = destination / BUNDLE
    executable = bundle / "Contents/MacOS" / EXECUTABLE
    metadata = plistlib.dumps({
        "CFBundleIdentifier": BUNDLE_ID, "CFBundleName": "MarkView 本地保存助手",
        "CFBundleDisplayName": "MarkView 本地保存助手", "CFBundleExecutable": EXECUTABLE,
        "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "LSUIElement": True,
        "NSDesktopFolderUsageDescription": "将你在 MarkView 编辑的 Markdown 保存回桌面中的原文件。",
        "NSDocumentsFolderUsageDescription": "将你在 MarkView 编辑的 Markdown 保存回文稿中的原文件。",
        "NSDownloadsFolderUsageDescription": "将你在 MarkView 编辑的 Markdown 保存回下载中的原文件。",
    })
    source = repository / "native/launcher.c"
    build_digest = hashlib.sha256(source.read_bytes() + metadata).hexdigest().encode()
    marker = destination / "launcher-build.sha256"
    info_file = bundle / "Contents/Info.plist"
    for directory in (bundle, bundle / "Contents", executable.parent):
        if directory.exists() and (directory.is_symlink() or directory.stat().st_uid != os.getuid()):
            raise ValueError("助手启动程序目录归属不匹配，未修改。")
    if (executable.is_file() and not executable.is_symlink() and marker.is_file() and
            marker.read_bytes() == build_digest and info_file.read_bytes() == metadata and
            subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(bundle)], capture_output=True).returncode == 0):
        return executable
    executable.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    write_file(info_file, metadata, 0o600)
    try:
        subprocess.run(["/usr/bin/clang", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                        str(source), "-o", str(executable)], check=True, capture_output=True, timeout=30)
        os.chmod(executable, 0o700)
        subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", "--identifier", BUNDLE_ID,
                        "--timestamp=none", str(bundle)], check=True, capture_output=True, timeout=20)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise ValueError("助手启动程序编译或本机签名失败，请确认已安装 Xcode Command Line Tools。")
    write_file(marker, build_digest, 0o600)
    return executable


def install(args):
    if sys.platform != "darwin":
        raise ValueError("此安装脚本当前仅支持 macOS。")
    repository = Path(__file__).resolve().parent.parent
    extension_ids = args.extension_id or detected_ids(repository)
    if not extension_ids or any(not ID.fullmatch(value) for value in extension_ids):
        raise ValueError("未找到本项目已加载的扩展 ID，请使用 --extension-id 指定 chrome://extensions 显示的 ID。")
    destination = Path(args.install_dir).expanduser().absolute() if args.install_dir else Path.home() / "Library/Application Support/MarkView/native"
    manifest_directory = Path(args.manifest_dir).expanduser().absolute() if args.manifest_dir else Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    manifest_file = manifest_directory / (HOST + ".json")
    config_file = destination / "config.json"
    secret = secrets.token_hex(32)
    if destination.exists():
        if destination.is_symlink() or destination.stat().st_uid != os.getuid():
            raise ValueError("助手安装目录归属不匹配，未修改。")
        if any(destination.iterdir()):
            try:
                config = json.loads(config_file.read_text())
                if config.get("app") != APP or not re.fullmatch(r"[0-9a-f]{64}", config.get("secret", "")):
                    raise ValueError("助手安装目录包含其他内容，未修改。")
                secret = config["secret"]
            except (OSError, json.JSONDecodeError):
                raise ValueError("助手安装目录包含其他内容，未修改。")
    if manifest_file.exists():
        existing = json.loads(manifest_file.read_text())
        known_launchers = (str(destination / "launch"), str(destination / BUNDLE / "Contents/MacOS" / EXECUTABLE))
        if (manifest_file.is_symlink() or existing.get("name") != HOST or
                existing.get("path") not in known_launchers):
            raise ValueError("已有同名 Native Messaging 注册，未覆盖。")
    source = (repository / "native/save_host.py").read_bytes()
    compile(source, "save_host.py", "exec")
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(destination, 0o700)
    manifest_directory.mkdir(parents=True, exist_ok=True)
    launcher = install_launcher(destination, repository)
    origins = ["chrome-extension://" + value + "/" for value in sorted(set(extension_ids))]
    write_file(destination / "save_host.py", source, 0o600)
    write_file(config_file, json.dumps({"app": APP, "allowed_origins": origins, "secret": secret}).encode(), 0o600)
    write_file(destination / "python-path", os.fsencode(sys.executable), 0o600)
    manifest = {"name": HOST, "description": APP, "path": str(launcher),
                "type": "stdio", "allowed_origins": origins}
    write_file(manifest_file, json.dumps(manifest, indent=2).encode(), 0o600)
    print("已安装本地保存助手：" + str(destination))
    print("已注册 Chrome 主机：" + str(manifest_file))
    print("允许的扩展 ID：" + ", ".join(extension_ids))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extension-id", action="append")
    parser.add_argument("--manifest-dir")
    parser.add_argument("--install-dir")
    try:
        install(parser.parse_args())
    except (OSError, ValueError) as error:
        print("安装未完成：" + str(error), file=sys.stderr)
        sys.exit(1)
