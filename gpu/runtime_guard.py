"""Small ASGI runtime guards; no patient images or request bodies are logged."""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import threading
import uuid
from contextlib import contextmanager
from time import monotonic

from starlette.formparsers import MultiPartException
from starlette.responses import JSONResponse

from account_access import AccountAccess


def production_mode():
    return (os.getenv("OPTIFRAME_ENV", "").lower() == "production" or
            os.getenv("OPTIFRAME_PRODUCTION", "").lower() in ("1", "true", "yes"))


class RuntimeState:
    def __init__(self, production=False, clock=None):
        self.production = production
        self._clock = clock or monotonic
        self._status = "cold" if production else "ready"
        self._lock = threading.Lock()
        self._epoch = 0
        self._thread = None
        self._warm_started_at = None
        self._work = {}

    @property
    def ready(self):
        with self._lock:
            return self._status == "ready"

    @property
    def healthy(self):
        with self._lock:
            now = self._clock()
            warm_stalled = (self._status == "warming" and self._warm_started_at is not None
                            and now-self._warm_started_at > 180)
            work_stalled = any(now-started > 240 for started, _ in self._work.values())
            return not (warm_stalled or work_stalled)

    @property
    def worker_busy(self):
        with self._lock:
            return any(worker for _, worker in self._work.values())

    @property
    def worker_status(self):
        """Coarse queue diagnostics without paths, images, tokens or identities."""
        with self._lock:
            ages = [self._clock() - started for started, worker in self._work.values() if worker]
            return {"workerCount": len(ages),
                    "longestWorkerAgeMs": round(max(ages, default=0) * 1000, 1)}

    def begin_work(self, *, worker=False):
        token = uuid.uuid4().hex
        with self._lock:
            self._work[token] = (self._clock(), worker)
        return token

    def end_work(self, token):
        with self._lock:
            self._work.pop(token, None)

    @contextmanager
    def worker(self):
        """Track actual thread lifetime, even if its HTTP request is cancelled."""
        token = self.begin_work(worker=True)
        try:
            yield
        finally:
            self.end_work(token)

    def start_warmup(self, warm):
        """One background thread uses the application's existing predictor."""
        with self._lock:
            if self._status in ("warming", "ready"):
                return
            self._status = "warming"
            self._warm_started_at = self._clock()
            self._epoch += 1
            epoch = self._epoch

        def run():
            status = "ready"
            try:
                warm()
            except Exception as error:
                status = "failed"
                logging.error("Predictor warm-up failed (%s)", type(error).__name__)
            with self._lock:
                if self._epoch == epoch:
                    self._status = status
                    self._warm_started_at = None

        self._thread = threading.Thread(target=run, name="optiframe-warmup", daemon=True)
        self._thread.start()

    def close(self):
        with self._lock:
            self._epoch += 1
            self._status = "stopped"


def expensive_route(path):
    return (path.startswith("/api/frame") or path in {
        "/api/import", "/api/video-frames", "/api/segment",
        "/api/live-segment", "/api/segment-burst"})


class RuntimeGuard:
    """Auth precedes body parsing; scarce work never forms an unbounded queue."""
    def __init__(self, app, runtime, max_expensive=1, account_access=None):
        self.app = app
        self.runtime = runtime
        self._slots = threading.BoundedSemaphore(max_expensive)
        # One camera frame may wait for the frame currently being processed.
        # Keep this bounded so disconnected phones cannot build a stale queue.
        self._live_waiters = threading.BoundedSemaphore(2)
        self.account_access = account_access or AccountAccess()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        api = path.startswith("/api/")
        request_id = uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started = False

        async def secured_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                values = {
                    b"x-request-id": request_id.encode("ascii"),
                    b"x-content-type-options": b"nosniff",
                    b"referrer-policy": b"no-referrer",
                }
                if api or path in ("/healthz", "/readyz"):
                    values[b"cache-control"] = b"no-store"
                    values[b"x-frame-options"] = b"DENY"
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in values]
                message = {**message, "headers": headers+list(values.items())}
            await send(message)

        async def reject(detail, status, retry=False):
            response = JSONResponse({"detail": detail}, status_code=status,
                                    headers={"Retry-After": "1"} if retry else None)
            await response(scope, receive, secured_send)

        required = os.getenv("OPTIFRAME_ACCESS_TOKEN", "")
        if api:
            headers = scope.get("headers", [])
            bearer = [v for k, v in headers if k.lower() == b"authorization"]
            if bearer:
                if len(bearer) != 1 or not bearer[0].lower().startswith(b"bearer "):
                    return await reject("Sign in again", 401)
                try:
                    token = bearer[0][7:].decode("ascii")
                except UnicodeDecodeError:
                    return await reject("Sign in again", 401)
                access = await self.account_access.verify(token)
                if access.status != 200:
                    return await reject(access.detail, access.status, access.status == 503)
                scope["state"]["account_user_id"] = access.user_id
            elif required:
                supplied = dict(headers).get(b"x-optiframe-key", b"")
                if not hmac.compare_digest(supplied, required.encode("utf-8")):
                    return await reject("Phone test key missing or incorrect", 401)
            elif self.account_access.configured():
                return await reject("Sign in to continue", 401)
            elif self.runtime.production:
                return await reject("Service is not configured", 503, True)
        admitted = False
        work_token = None
        waiting = False
        if expensive_route(path):
            if self.runtime.production and (not self.runtime.ready or not self.runtime.healthy):
                return await reject("Service is warming up. Retrying…", 503, True)
            try:
                if path == "/api/live-segment":
                    waiting = self._live_waiters.acquire(blocking=False)
                    if not waiting:
                        return await reject("Service busy. Retrying…", 503, True)
                    deadline = monotonic() + 8
                    while monotonic() < deadline:
                        if not self.runtime.worker_busy:
                            admitted = self._slots.acquire(blocking=False)
                            if admitted:
                                break
                        await asyncio.sleep(0.05)
                elif not self.runtime.worker_busy:
                    admitted = self._slots.acquire(blocking=False)
                if not admitted:
                    return await reject("Service busy. Retrying…", 503, True)
                work_token = self.runtime.begin_work()
            finally:
                if waiting:
                    self._live_waiters.release()
        try:
            await self.app(scope, receive, secured_send)
        except Exception as error:
            # Never include the image, submitted body, token or exception text.
            logging.error("Request failed id=%s type=%s", request_id, type(error).__name__)
            if started:
                raise
            await reject("Request could not be completed", 500)
        finally:
            if admitted:
                self.runtime.end_work(work_token)
                self._slots.release()


class CaptureBodyLimit:
    """Enforce declared and streamed lengths before JSON or multipart parsing.

    MultiPartException lets Starlette close temporary upload files on overflow.
    The response adapter also handles parsers that convert that exception to 400.
    """
    LIMITS = {
        "/api/video-frames": 100_064_000,
        "/api/import": 100_064_000,
        "/api/segment": 48_064_000,
        "/api/live-segment": 8_064_000,
        "/api/segment-burst": 20_064_000,
    }

    def __init__(self, app, video_limit=None):
        self.app = app
        self.video_limit = video_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        limit = 1_000_000 if path.startswith("/api/frame") else self.LIMITS.get(path)
        if path == "/api/video-frames" and self.video_limit is not None:
            limit = self.video_limit()+64_000
        if limit is None:
            return await self.app(scope, receive, send)
        detail = ("Frame request exceeds 1 MB" if path.startswith("/api/frame") else
                  "Video request exceeds 100 MB" if path == "/api/video-frames" else
                  "Capture request exceeds upload limit")
        rejection = JSONResponse({"detail": detail}, status_code=413)
        lengths = [value for key, value in scope.get("headers", []) if key.lower() == b"content-length"]
        try:
            length = int(lengths[0]) if lengths else 0
            if len(lengths) > 1 or length < 0:
                raise ValueError
        except ValueError:
            return await JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)(scope, receive, send)
        if length > limit:
            return await rejection(scope, receive, send)
        total = 0
        exceeded = False
        rejected = False
        timeout = 120 if path in ("/api/import", "/api/video-frames") else 30
        deadline = monotonic()+timeout

        async def bounded_receive():
            nonlocal total, exceeded, rejection
            try:
                remaining = deadline-monotonic()
                if remaining <= 0:
                    raise asyncio.TimeoutError
                message = await asyncio.wait_for(receive(), remaining)
            except asyncio.TimeoutError:
                exceeded = True
                rejection = JSONResponse({"detail": "Upload timed out. Retry the capture."},
                                         status_code=408, headers={"Retry-After": "1"})
                raise MultiPartException("Upload timed out") from None
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    exceeded = True
                    raise MultiPartException("Request body exceeds upload limit")
            return message

        async def bounded_send(message):
            nonlocal rejected
            if exceeded:
                if not rejected:
                    rejected = True
                    await rejection(scope, receive, send)
                return
            await send(message)

        try:
            await self.app(scope, bounded_receive, bounded_send)
        except Exception:
            if not exceeded:
                raise
        if exceeded and not rejected:
            await rejection(scope, receive, send)
