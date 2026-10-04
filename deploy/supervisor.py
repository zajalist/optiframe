"""One-user desktop supervisor for OptiFrame's single GPU backend (stdlib only)."""
from __future__ import annotations

import argparse
import base64
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

HOST, PORT = "127.0.0.1", 8766


def redact(text: str, token: str) -> str:
    if token:
        text = text.replace(token, "[REDACTED]")
    text = re.sub(r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+", r"\1[REDACTED]", text)
    return re.sub(r"(?i)((?:x-optiframe-key|access_token|access|token)\s*[=:]\s*)[^\s&;,]+",
                  r"\1[REDACTED]", text)


class RedactingFormatter(logging.Formatter):
    def __init__(self, token: str):
        super().__init__("%(asctime)s %(levelname)s %(message)s")
        self.token = token

    def format(self, record):
        return redact(super().format(record), self.token)


class InstanceLock:
    """OS-held lock released even when the supervisor crashes; never a PID file."""
    def __init__(self, path: Path):
        self.path, self.handle = path, None

    def acquire(self) -> bool:
        self.handle = self.path.open("a+b")
        self.handle.seek(0, 2)
        if self.handle.tell() == 0:
            self.handle.write(b"0")
            self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.handle.close()
            self.handle = None
            return False

    def close(self):
        if self.handle:
            self.handle.close()
            self.handle = None


class HealthPolicy:
    def __init__(self, started: float, grace=120.0, interval=10.0, threshold=3):
        self.started, self.grace, self.interval = started, grace, interval
        self.threshold, self.failures = threshold, 0
        self.next_probe = started + grace

    def due(self, now: float) -> bool:
        return now >= self.next_probe

    def record(self, healthy: bool, now: float) -> bool:
        self.next_probe = now + self.interval
        self.failures = 0 if healthy else self.failures + 1
        return self.failures >= self.threshold


class RestartBackoff:
    def __init__(self):
        self.failures = 0

    def delay(self, uptime: float) -> float:
        if uptime >= 300:
            self.failures = 0
        delay = min(60, 2 ** min(self.failures, 6))
        self.failures += 1
        return delay


class ChildJob:
    """Windows kernel kills the owned backend if this supervisor disappears."""
    def __init__(self):
        self.handle = None
        if os.name != "nt":
            return
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64),
                        ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD),
                        ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t),
                        ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t),
                        ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in
                        ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                         "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.api.CreateJobObjectW.restype = wintypes.HANDLE
        self.api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.api.SetInformationJobObject.restype = wintypes.BOOL
        self.api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.api.AssignProcessToJobObject.restype = wintypes.BOOL
        self.api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.api.OpenProcess.restype = wintypes.HANDLE
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.CloseHandle.restype = wintypes.BOOL
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def attach(self, process):
        if self.handle is None:
            return
        import ctypes
        # Only the new child PID is opened. No unrelated process is enumerated or killed.
        child = self.api.OpenProcess(0x0100 | 0x0001, False, process.pid)
        if not child:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not self.api.AssignProcessToJobObject(self.handle, child):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            self.api.CloseHandle(child)

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


def probe(path: str, token: str, timeout=3.0) -> bool:
    request = Request(f"http://{HOST}:{PORT}{path}", headers={"X-OptiFrame-Key": token})
    try:
        # A health endpoint must return its status without a large body.
        with urlopen(request, timeout=timeout) as response:
            return response.status == 200
    except (HTTPError, URLError, TimeoutError, OSError):
        return False


def backend_command(repo: Path) -> list[str]:
    return [sys.executable, "-u", "-m", "uvicorn", "segment:app", "--app-dir",
            str(repo / "gpu"), "--host", HOST, "--port", str(PORT), "--workers", "1",
            "--no-access-log", "--limit-concurrency", "32", "--timeout-keep-alive", "5",
            "--timeout-graceful-shutdown", "8", "--forwarded-allow-ips", HOST]


def port_occupied() -> bool:
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex((HOST, PORT)) == 0


def public_account_configuration(value) -> dict[str, str]:
    """Strict allowlist: this file cannot replace private keys or process options."""
    names = {"SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"}
    if not isinstance(value, dict) or set(value) != names:
        raise ValueError("Invalid public service configuration")
    url, key = value["SUPABASE_URL"], value["SUPABASE_PUBLISHABLE_KEY"]
    if not isinstance(url, str) or not isinstance(key, str) or not 20 <= len(key) <= 8192:
        raise ValueError("Invalid public service configuration")
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("Invalid public service configuration")
    public = key.startswith("sb_publishable_") and key.isascii() and not any(c.isspace() for c in key)
    if not public:
        try:
            payload = key.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload+"="*(-len(payload) % 4)))
            public = claims.get("role") == "anon"
        except (ValueError, IndexError, AttributeError):
            public = False
    if not public:
        raise ValueError("A public Supabase key is required")
    return {"SUPABASE_URL": url.rstrip("/"), "SUPABASE_PUBLISHABLE_KEY": key}


def child_environment(runtime: Path | None = None, logger=None) -> dict[str, str]:
    env = os.environ.copy()
    env.update(OPTIFRAME_ENV="production", PYTHONUNBUFFERED="1")
    if runtime is not None:
        path = runtime / "public-services.json"
        if path.exists():
            # Re-read for every worker generation, not just supervisor startup.
            # Invalid files disable account access; the existing private test key
            # stays intact. Never log the file or provider configuration values.
            env.pop("SUPABASE_URL", None)
            env.pop("SUPABASE_PUBLISHABLE_KEY", None)
            try:
                if path.stat().st_size > 16384:
                    raise ValueError("Public service configuration too large")
                env.update(public_account_configuration(json.loads(path.read_text(encoding="utf-8"))))
            except (OSError, ValueError, UnicodeError):
                if logger:
                    logger.warning("Public account configuration invalid; account access disabled")
    return env


def forward_output(process, logger):
    try:
        for line in iter(lambda: process.stdout.readline(16384), ""):
            # Cap a single log entry; inference output cannot consume unlimited disk.
            logger.info("backend %s", line.rstrip()[:16384])
    except (OSError, ValueError):
        pass
    finally:
        process.stdout.close()


def stop_child(process, logger):
    if process.poll() is not None:
        return
    logger.info("Stopping owned backend pid=%s", process.pid)
    try:
        # New process group allows graceful shutdown when a console is available.
        if os.name == "nt":
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
            except OSError:
                process.terminate()
        else:
            process.terminate()
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=8)
    except ProcessLookupError:
        pass


def run(repo: Path, runtime: Path) -> int:
    token = os.environ.get("OPTIFRAME_ACCESS_TOKEN", "")
    if not token or not (repo / "gpu" / "segment.py").is_file():
        print("Missing backend path or API token; run the configured launcher.", file=sys.stderr)
        return 2
    runtime.mkdir(parents=True, exist_ok=True)
    lock = InstanceLock(runtime / "supervisor.lock")
    if not lock.acquire():
        print("Another supervisor owns the instance lock; exiting")
        return 0
    logger = logging.getLogger("optiframe-supervisor")
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(runtime / "backend.log", maxBytes=5_000_000,
                                  backupCount=4, encoding="utf-8")
    handler.setFormatter(RedactingFormatter(token))
    logger.addHandler(handler)
    shutdown = threading.Event()
    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), lambda *_: shutdown.set())
    process = None
    child_job = None
    backoff = RestartBackoff()
    try:
        # Never kill or share a pre-existing GPU process, including a manual server.
        while not shutdown.is_set():
            if port_occupied():
                logger.error("Port %s is already occupied; no backend was started", PORT)
                return 3
            started = time.monotonic()
            policy = HealthPolicy(started)
            try:
                child_job = ChildJob()
                flags = ((subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW)
                         if os.name == "nt" else 0)
                process = subprocess.Popen(backend_command(repo), cwd=str(repo), env=child_environment(runtime, logger),
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                           text=True, encoding="utf-8", errors="replace",
                                           creationflags=flags, start_new_session=os.name != "nt")
                child_job.attach(process)
                logger.info("Started backend pid=%s; health grace=120s", process.pid)
                reader = threading.Thread(target=forward_output, args=(process, logger), daemon=True)
                reader.start()
                next_readiness_log = 0.0
                while not shutdown.wait(.5):
                    now = time.monotonic()
                    if process.poll() is not None:
                        logger.warning("Backend exited code=%s", process.returncode)
                        break
                    if not policy.due(now):
                        continue
                    healthy = probe("/healthz", token)
                    restart = policy.record(healthy, time.monotonic())
                    if not healthy:
                        logger.warning("Liveness failure %s/3", policy.failures)
                    if restart:
                        logger.error("Liveness failed three times; restarting backend")
                        break
                    if healthy and now >= next_readiness_log:
                        ready = probe("/readyz", token)
                        logger.info("Backend readiness=%s", "ready" if ready else "unavailable")
                        next_readiness_log = now + 60
                stop_child(process, logger)
                reader.join(timeout=2)
                process = None
                child_job.close()
                child_job = None
            except (OSError, subprocess.SubprocessError):
                logger.exception("Backend launch or shutdown failed")
                # Do not spawn again if the owned child could still be alive.
                if process is not None and process.poll() is None:
                    return 4
                process = None
                if child_job is not None:
                    child_job.close()
                    child_job = None
            if not shutdown.is_set():
                delay = backoff.delay(time.monotonic() - started)
                logger.warning("Restart backoff=%ss", delay)
                shutdown.wait(delay)
        return 0
    finally:
        try:
            if process is not None:
                stop_child(process, logger)
        finally:
            if child_job is not None:
                child_job.close()
            lock.close()
            logger.removeHandler(handler)
            handler.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    args = parser.parse_args()
    raise SystemExit(run(args.repo_root.resolve(), args.runtime.resolve()))
