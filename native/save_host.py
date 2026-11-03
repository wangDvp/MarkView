#!/usr/bin/env python3
"""MarkView Native Messaging host (macOS/POSIX, Python standard library only)."""
import base64
import binascii
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import struct
import sys
import time
from urllib.parse import unquote, urlsplit

MAX_BYTES = 5 * 1024 * 1024
MAX_MESSAGE = 8 * 1024 * 1024
TOKEN_TTL = 300
HEX = re.compile(r"^[0-9a-f]{64}$")


class HostError(Exception):
    def __init__(self, code):
        self.code = code


def local_path(url):
    if not isinstance(url, str) or len(url) > 32768:
        raise HostError("invalid-path")
    try:
        parts = urlsplit(url)
        path = unquote(parts.path, errors="strict")
    except (ValueError, UnicodeError):
        raise HostError("invalid-path")
    if (parts.scheme != "file" or parts.netloc not in ("", "localhost") or
            parts.query or parts.fragment or not path.startswith("/") or
            "\x00" in path or ".." in Path(path).parts or
            Path(path).suffix.lower() not in (".md", ".markdown")):
        raise HostError("invalid-path")
    try:
        canonical = Path(path).resolve(strict=True)
    except OSError:
        raise HostError("read-failed")
    if canonical.suffix.lower() not in (".md", ".markdown"):
        raise HostError("invalid-path")
    return canonical


def parent_fd(path):
    """Walk the canonical path without following substituted directory symlinks."""
    # Ancestors need traversal only. Reading Desktop/Downloads itself requests
    # broader access than opening a known file in a nested directory on macOS.
    search = getattr(os, "O_SEARCH", os.O_RDONLY) | os.O_DIRECTORY
    descriptor = os.open("/", search)
    try:
        for part in path.parent.parts[1:]:
            child = os.open(part, search | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def stamp(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def snapshot(fd):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode):
        raise HostError("invalid-path")
    if before.st_size > MAX_BYTES:
        raise HostError("too-large")
    os.lseek(fd, 0, os.SEEK_SET)
    data = bytearray()
    while True:
        chunk = os.read(fd, min(65536, MAX_BYTES + 1 - len(data)))
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HostError("too-large")
    after = os.fstat(fd)
    if stamp(before) != stamp(after):
        raise HostError("conflict")
    digest = hashlib.sha256(data).hexdigest()
    version = hashlib.sha256(json.dumps([*stamp(after), digest]).encode()).hexdigest()
    return bytes(data), digest, version, after


def text_metadata(data):
    encoding, codec, skip, bom = "UTF-8", "utf-8", 0, False
    if data.startswith(b"\xef\xbb\xbf"):
        skip, bom = 3, True
    elif data.startswith(b"\xff\xfe"):
        encoding, codec, skip, bom = "UTF-16 LE", "utf-16le", 2, True
    elif data.startswith(b"\xfe\xff"):
        encoding, codec, skip, bom = "UTF-16 BE", "utf-16be", 2, True
    else:
        sample = data[:4096]
        pairs = len(sample) // 2
        if pairs > 16:
            even = sample[0:pairs * 2:2].count(0)
            odd = sample[1:pairs * 2:2].count(0)
            if odd > pairs * 0.6 and even < pairs * 0.1:
                encoding, codec = "UTF-16 LE", "utf-16le"
            elif even > pairs * 0.6 and odd < pairs * 0.1:
                encoding, codec = "UTF-16 BE", "utf-16be"
    text = data[skip:].decode(codec, errors="replace")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return {"encoding": encoding, "eol": "\r\n" if "\r\n" in text else "\n", "bom": bom,
            "textDigest": hashlib.sha256(normalized.encode("utf-8")).hexdigest()}


class Host:
    def __init__(self, secret, origin):
        self.secret = secret
        self.origin = origin

    def sign(self, payload):
        encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
        signature = hmac.new(self.secret, encoded.encode(), hashlib.sha256).hexdigest()
        return encoded + "." + signature

    def verify(self, token):
        if not isinstance(token, str) or len(token) > 65536:
            raise HostError("invalid-token")
        try:
            encoded, signature = token.rsplit(".", 1)
            expected = hmac.new(self.secret, encoded.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                raise HostError("invalid-token")
            payload = json.loads(base64.b64decode(encoded, altchars=b"-_", validate=True))
            if payload["origin"] != self.origin or not time.time() <= payload["expires"] <= time.time() + TOKEN_TTL + 5:
                raise HostError("invalid-token")
            return payload
        except (ValueError, KeyError, TypeError, binascii.Error):
            raise HostError("invalid-token")

    def open(self, request):
        expected = request.get("expectedDigest")
        expected_text = request.get("expectedTextDigest")
        if not ((isinstance(expected, str) and HEX.fullmatch(expected)) or
                (isinstance(expected_text, str) and HEX.fullmatch(expected_text))):
            raise HostError("invalid-request")
        path = local_path(request.get("url"))
        directory = parent_fd(path)
        try:
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                data, digest, version, _ = snapshot(fd)
            finally:
                os.close(fd)
        finally:
            os.close(directory)
        metadata = text_metadata(data)
        if (expected and digest != expected) or (not expected and metadata["textDigest"] != expected_text):
            raise HostError("conflict")
        token = self.sign({"origin": self.origin, "url": request["url"], "path": str(path),
                           "version": version, "expires": int(time.time()) + TOKEN_TTL})
        return {"digest": digest, "token": token, **metadata}

    def save(self, request):
        target = self.verify(request.get("token"))
        encoded = request.get("content")
        if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
            raise HostError("too-large")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise HostError("invalid-request")
        if len(data) > MAX_BYTES:
            raise HostError("too-large")
        path = local_path(target["url"])
        if str(path) != target["path"]:
            raise HostError("conflict")
        directory = parent_fd(path)
        fd = None
        temporary = None
        try:
            fd = os.open(path.name, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise HostError("busy")
            original, digest, version, info = snapshot(fd)
            if version != target["version"]:
                raise HostError("conflict")
            if original == data:
                return {"digest": digest}
            temporary = ".markview-" + secrets.token_hex(16) + ".tmp"
            output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             stat.S_IMODE(info.st_mode), dir_fd=directory)
            try:
                os.fchmod(output, stat.S_IMODE(info.st_mode))
                offset = 0
                while offset < len(data):
                    offset += os.write(output, data[offset:])
                os.fsync(output)
            finally:
                os.close(output)
            # Check both the inode being edited and the current directory entry.
            _, _, latest, _ = snapshot(fd)
            current = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
            if (latest != version or stamp(current) != stamp(info) or
                    local_path(target["url"]) != path or
                    os.stat(path.parent).st_ino != os.fstat(directory).st_ino):
                raise HostError("conflict")
            os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
            temporary = None
            os.fsync(directory)
            return {"digest": hashlib.sha256(data).hexdigest()}
        finally:
            if fd is not None:
                os.close(fd)
            if temporary is not None:
                os.unlink(temporary, dir_fd=directory)
            os.close(directory)

    def handle(self, request):
        if not isinstance(request, dict):
            raise HostError("invalid-request")
        if request.get("op") == "open":
            return self.open(request)
        if request.get("op") == "save":
            return self.save(request)
        raise HostError("invalid-request")


def read_exact(stream, length):
    chunks = bytearray()
    while len(chunks) < length:
        chunk = stream.read(length - len(chunks))
        if not chunk:
            raise HostError("invalid-request")
        chunks.extend(chunk)
    return bytes(chunks)


def expired(_signal, _frame):
    raise HostError("timeout")


def main():
    try:
        config = json.loads(Path(__file__).with_name("config.json").read_text())
        origin = sys.argv[1] if len(sys.argv) > 1 else ""
        if origin not in config["allowed_origins"]:
            return 1
        secret = bytes.fromhex(config["secret"])
        if len(secret) != 32:
            return 1
    except (OSError, ValueError, KeyError, TypeError):
        return 1
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(20)
    try:
        length = struct.unpack("=I", read_exact(sys.stdin.buffer, 4))[0]
        if not 0 < length <= MAX_MESSAGE:
            raise HostError("invalid-request")
        request = json.loads(read_exact(sys.stdin.buffer, length))
        result = {"ok": True, **Host(secret, origin).handle(request)}
    except HostError as error:
        result = {"ok": False, "code": error.code}
    except PermissionError:
        result = {"ok": False, "code": "denied"}
    except (OSError, ValueError, UnicodeError, TypeError):
        result = {"ok": False, "code": "io-failed"}
    signal.alarm(0)
    response = json.dumps(result, separators=(",", ":")).encode()
    try:
        sys.stdout.buffer.write(struct.pack("=I", len(response)) + response)
        sys.stdout.buffer.flush()
    except BrokenPipeError:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
