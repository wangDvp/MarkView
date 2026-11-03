#!/usr/bin/env python3
"""Create local extension/source ZIPs from explicit allowlists; no builds/uploads.
Run: python3 scripts/package-release.py [--output DIR]
Writes new ZIPs and SHA256SUMS.txt; refuses to overwrite existing output files.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = (
    "manifest.json", "background.js", "native-bridge.js", "native-file.js", "content.js",
    "renderer.js", "document-editor.js", "document-export.js", "pdf-export.js", "pdf-content.js",
    "preview.html", "preview.js", "preview.css", "README.md", "LICENSE", "PRIVACY.md",
    "CONTRIBUTING.md", "docs/RELEASING.md", "THIRD-PARTY-NOTICES.md",
    "native/install.py", "native/save_host.py", "native/launcher.c", "native/README.md",
    "lib/markdown-vendor.js", "lib/content-styles.js", "lib/pdf-vendor.js",
    "fonts/NotoSansSC-Regular.otf", "fonts/NotoSansSC-Bold.otf",
    "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
    "icons/icon512.png", "icons/icon.svg",
    "licenses/marked-LICENSE.txt", "licenses/DOMPurify-LICENSE.txt", "licenses/highlight.js-LICENSE.txt",
    "licenses/pdfmake-LICENSE.txt", "licenses/svg-to-pdfkit-LICENSE.txt", "licenses/pdf-vendor-NOTICES.txt",
    "licenses/NotoSansSC-LICENSE.txt",
)
DEVELOPMENT_FILES = (
    ".gitignore", "package.json", "package-lock.json", "src/vendor.js", "src/pdf-vendor.js",
    "scripts/build.mjs", "scripts/build-pdf.mjs", "scripts/sync-styles.mjs", "scripts/icons.mjs",
    "scripts/fetch-pdf-fonts.mjs", "scripts/package-release.py",
    "tests/e2e.mjs", "tests/check-static.mjs", "tests/test_release_package.py",
    "tests/native/test_save.py", "tests/native/bridge.mjs", "tests/native/verify_launcher.py", "tests/native/browser.mjs",
    "tests/fixtures/sample.md", "tests/fixtures/page.html", "tests/fixtures/local/README.md",
)


def release_files(root):
    manifest = json.loads((root / "manifest.json").read_text())
    package = json.loads((root / "package.json").read_text())
    lock = json.loads((root / "package-lock.json").read_text())
    version = manifest.get("version", "")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,3}", version):
        raise ValueError("Invalid release version")
    if any(value != version for value in (package.get("version"), lock.get("version"), lock["packages"][""]["version"])):
        raise ValueError("Manifest, package and lockfile versions must agree")
    if package.get("license") != "MIT" or lock["packages"][""].get("license") != "MIT":
        raise ValueError("Package license metadata must match the project MIT license")
    for name in RUNTIME_FILES + DEVELOPMENT_FILES:
        target = root / name
        if not target.is_file() or target.is_symlink() or root.resolve() not in target.resolve().parents:
            raise ValueError("Missing, linked or non-regular release asset: " + name)
    license_text = (root / "LICENSE").read_text()
    if "MIT License" not in license_text or not re.search(r"Copyright \(c\) [0-9]{4} " + re.escape(package["author"]), license_text):
        raise ValueError("Project license and copyright notice are missing")
    referenced = [manifest["background"]["service_worker"]]
    referenced.extend(manifest.get("icons", {}).values())
    referenced.extend(manifest.get("action", {}).get("default_icon", {}).values())
    for entry in manifest.get("content_scripts", []):
        referenced.extend(entry.get("js", []))
        referenced.extend(entry.get("css", []))
    for entry in manifest.get("web_accessible_resources", []):
        referenced.extend(entry.get("resources", []))
    referenced.extend(re.findall(r'(?:src|href)=["\']([^"\']+)["\']', (root / "preview.html").read_text()))
    for name in referenced:
        if name not in RUNTIME_FILES:
            raise ValueError("Manifest/HTML asset is absent from the runtime allowlist: " + name)
    return version


def write_zip(root, output, names):
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(names):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, (root / name).read_bytes())


def package_release(root, destination):
    root, destination = Path(root).resolve(), Path(destination).absolute()
    version = release_files(root)
    names = (f"MarkView-v{version}.zip", f"MarkView-v{version}-source.zip", "SHA256SUMS.txt")
    destination.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        # Reserve every output first; never truncate a pre-existing release.
        streams = []
        try:
            for name in names:
                file = destination / name
                streams.append(file.open("xb"))
                created.append(file)
            write_zip(root, streams[0], RUNTIME_FILES)
            write_zip(root, streams[1], RUNTIME_FILES + DEVELOPMENT_FILES)
        finally:
            for stream in streams:
                stream.close()
        sums = "".join(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n" for file in created[:2])
        created[2].write_text(sums)
        return created
    except BaseException:
        for file in created:
            file.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    try:
        for file in package_release(ROOT, args.output):
            print(file.name)
    except (OSError, ValueError, KeyError) as error:
        print("Packaging failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
