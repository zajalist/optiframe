import asyncio
import json
import os
import threading
import unittest
from unittest.mock import patch

from fastapi import FastAPI, File, UploadFile
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.responses import JSONResponse

from runtime_guard import CaptureBodyLimit, RuntimeGuard, RuntimeState


async def request(app, path="/api/frame", chunks=(), headers=()):
    chunks = list(chunks) or [b""]
    index = 0
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "scheme": "http", "method": "POST", "path": path, "raw_path": path.encode(),
             "query_string": b"", "root_path": "", "headers": list(headers),
             "client": ("127.0.0.1", 9000), "server": ("test", 80)}
    messages = []

    async def receive():
        nonlocal index
        if index >= len(chunks):
            return {"type": "http.disconnect"}
        body = chunks[index]
        index += 1
        return {"type": "http.request", "body": body, "more_body": index < len(chunks)}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    start = next(m for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return start["status"], dict(start.get("headers", [])), body


async def echo(scope, receive, send):
    body = await Request(scope, receive).body()
    await JSONResponse({"bytes": len(body)})(scope, receive, send)


class RuntimeGuardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"OPTIFRAME_ACCESS_TOKEN": ""})
        self.env.start()
        self.addCleanup(self.env.stop)

    async def test_production_without_token_is_closed_but_development_stays_open(self):
        guarded = RuntimeGuard(echo, RuntimeState(production=True))
        code, headers, _ = await request(guarded)
        self.assertEqual(code, 503)
        self.assertEqual(headers[b"retry-after"], b"1")
        self.assertEqual((await request(RuntimeGuard(echo, RuntimeState())))[0], 200)

    async def test_auth_covers_all_api_and_warming_blocks_work(self):
        state = RuntimeState(production=True)
        guarded = RuntimeGuard(echo, state)
        with patch.dict(os.environ, {"OPTIFRAME_ACCESS_TOKEN": "testing"}):
            for path in ("/api/frame", "/api/frame-preview", "/api/live-segment", "/api/health", "/api/future"):
                self.assertEqual((await request(guarded, path))[0], 401)
            self.assertEqual((await request(guarded, headers=[(b"x-optiframe-key", b"testing")]))[0], 503)

    async def test_declared_and_streamed_json_limits_and_exact_boundary(self):
        app = CaptureBodyLimit(echo)
        self.assertEqual((await request(app, headers=[(b"content-length", b"1000001")]))[0], 413)
        self.assertEqual((await request(app, chunks=[b"x"*600_000, b"x"*400_001]))[0], 413)
        self.assertEqual((await request(app, chunks=[b"x"*600_000, b"x"*400_000]))[0], 200)
        # Declaring a small body does not bypass accounting for actual bytes.
        self.assertEqual((await request(app, chunks=[b"x"*1_000_001],
                                       headers=[(b"content-length", b"1")]))[0], 413)

    async def test_partial_multipart_upload_is_closed_on_stream_overflow(self):
        import starlette.formparsers as parser
        endpoint = FastAPI()
        called = []

        @endpoint.post("/api/live-segment")
        async def upload(image: UploadFile = File(...)):
            called.append(True)
            return {"ok": True}

        created = []
        original = parser.SpooledTemporaryFile
        def tracked(*args, **kwargs):
            file = original(*args, **kwargs)
            created.append(file)
            return file
        first = b'--boundary\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\nabc'
        with patch.dict(CaptureBodyLimit.LIMITS, {"/api/live-segment": 300}), \
                patch.object(parser, "SpooledTemporaryFile", tracked):
            code, _, _ = await request(CaptureBodyLimit(endpoint), "/api/live-segment",
                                      [first, b"x"*400, b"\r\n--boundary--\r\n"],
                                      [(b"content-type", b"multipart/form-data; boundary=boundary")])
        self.assertEqual(code, 413)
        self.assertEqual(len(created), 1)
        self.assertTrue(created[0].closed)
        self.assertFalse(called)

    async def test_one_expensive_slot_backpressures_other_routes_and_releases(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def held(scope, receive, send):
            if scope["path"] == "/api/frame":
                entered.set()
                await release.wait()
            await echo(scope, receive, send)
        guarded = RuntimeGuard(held, RuntimeState())
        first = asyncio.create_task(request(guarded))
        await entered.wait()
        code, headers, _ = await request(guarded, "/api/import")
        self.assertEqual(code, 503)
        self.assertEqual(headers[b"retry-after"], b"1")
        self.assertEqual((await request(guarded, "/healthz"))[0], 200)
        release.set()
        self.assertEqual((await first)[0], 200)
        self.assertEqual((await request(guarded, "/api/import"))[0], 200)

    async def test_live_frame_waits_for_current_frame_and_then_runs(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def held(scope, receive, send):
            if scope["path"] == "/api/frame":
                entered.set()
                await release.wait()
            await echo(scope, receive, send)
        guarded = RuntimeGuard(held, RuntimeState())
        first = asyncio.create_task(request(guarded))
        await entered.wait()
        second = asyncio.create_task(request(guarded, "/api/live-segment"))
        await asyncio.sleep(0.1)
        self.assertFalse(second.done())
        release.set()
        self.assertEqual((await first)[0], 200)
        self.assertEqual((await second)[0], 200)

    async def test_timeout_and_handler_error_release_slot_and_keep_secure_headers(self):
        guarded = RuntimeGuard(CaptureBodyLimit(echo), RuntimeState())
        with patch("runtime_guard.monotonic", side_effect=[0, 31]):
            code, headers, body = await request(guarded)
        self.assertEqual(code, 408)
        self.assertEqual(headers[b"retry-after"], b"1")
        self.assertIn("timed out", json.loads(body)["detail"])
        self.assertEqual((await request(guarded))[0], 200)
        called = 0
        async def fails_once(scope, receive, send):
            nonlocal called
            called += 1
            if called == 1:
                raise ValueError("DO NOT EXPOSE SECRET IMAGE OR KEY")
            await echo(scope, receive, send)
        failing = RuntimeGuard(fails_once, RuntimeState())
        with self.assertLogs(level="ERROR") as logs:
            code, headers, body = await request(failing)
        self.assertEqual(code, 500)
        self.assertNotIn("SECRET", "".join(logs.output))
        self.assertNotIn(b"SECRET", body)
        self.assertEqual(headers[b"cache-control"], b"no-store")
        self.assertEqual(headers[b"x-content-type-options"], b"nosniff")
        self.assertEqual(len(headers[b"x-request-id"]), 32)
        self.assertEqual((await request(failing))[0], 200)

    async def test_cancelled_http_request_keeps_orphan_worker_busy_and_watchdog_visible(self):
        import segment
        now = [10.0]
        state = RuntimeState(clock=lambda: now[0])
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        def work():
            try:
                with state.worker():
                    entered.set()
                    release.wait(3)
            finally:
                finished.set()
        async def endpoint(scope, receive, send):
            await asyncio.to_thread(work)
            await echo(scope, receive, send)
        guarded = RuntimeGuard(endpoint, state)
        pending = asyncio.create_task(request(guarded))
        self.assertTrue(await asyncio.to_thread(entered.wait, 1))
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        try:
            self.assertTrue(state.worker_busy)
            self.assertEqual((await request(guarded, "/api/import"))[0], 503)
            now[0] = 251.0
            self.assertFalse(state.healthy)
            with patch.object(segment, "runtime", state):
                health = await segment.healthz()
                self.assertEqual(health.status_code, 503)
                self.assertEqual(json.loads(health.body), {"status": "unhealthy"})
                self.assertEqual((await segment.readyz()).status_code, 503)
        finally:
            release.set()
            self.assertTrue(await asyncio.to_thread(finished.wait, 1))
        self.assertFalse(state.worker_busy)
        self.assertTrue(state.healthy)

    async def test_admitted_work_watchdog_expires_and_completion_clears_it(self):
        now = [0.0]
        state = RuntimeState(clock=lambda: now[0])
        entered, release = asyncio.Event(), asyncio.Event()
        async def held(scope, receive, send):
            entered.set()
            await release.wait()
            await echo(scope, receive, send)
        pending = asyncio.create_task(request(RuntimeGuard(held, state)))
        await entered.wait()
        now[0] = 240.0
        self.assertTrue(state.healthy)
        now[0] = 240.01
        self.assertFalse(state.healthy)
        release.set()
        self.assertEqual((await pending)[0], 200)
        self.assertTrue(state.healthy)


class RuntimeWarmupTests(unittest.TestCase):
    def test_warmup_runs_once_without_blocking_health_and_stays_not_ready_on_failure(self):
        state = RuntimeState(production=True)
        entered, release = threading.Event(), threading.Event()
        calls = []
        def warm():
            calls.append(True)
            entered.set()
            release.wait(2)
        state.start_warmup(warm)
        self.assertTrue(entered.wait(1))
        state.start_warmup(warm)
        self.assertFalse(state.ready)
        release.set()
        state._thread.join(2)
        self.assertTrue(state.ready)
        self.assertEqual(len(calls), 1)
        failed = RuntimeState(production=True)
        with self.assertLogs(level="ERROR"):
            failed.start_warmup(lambda: (_ for _ in ()).throw(RuntimeError("private failure")))
            failed._thread.join(2)
        self.assertFalse(failed.ready)
        self.assertTrue(failed.healthy, "Fast model/cache failure must not create a restart loop")

    def test_stalled_warmup_is_unhealthy_after_180_seconds(self):
        now = [0.0]
        state = RuntimeState(production=True, clock=lambda: now[0])
        entered, release = threading.Event(), threading.Event()
        def warm():
            entered.set()
            release.wait(3)
        state.start_warmup(warm)
        self.assertTrue(entered.wait(1))
        try:
            now[0] = 180.0
            self.assertTrue(state.healthy)
            now[0] = 180.01
            self.assertFalse(state.healthy)
            self.assertFalse(state.ready)
        finally:
            release.set()
            state._thread.join(1)
        self.assertTrue(state.healthy)
        self.assertTrue(state.ready)

    def test_health_readiness_and_lifespan_use_mock_predictor_not_gpu(self):
        import segment
        state = RuntimeState(production=True)
        entered, release = threading.Event(), threading.Event()
        def warm():
            entered.set()
            release.wait(2)
        with patch.object(segment, "runtime", state), patch.object(segment, "_warm_predictor", warm), \
                patch.dict(os.environ, {"OPTIFRAME_ACCESS_TOKEN": "testing"}):
            with TestClient(segment.app) as client:
                self.assertTrue(entered.wait(1))
                self.assertEqual(client.get("/healthz").json(), {"status": "ok"})
                self.assertEqual(client.get("/readyz").status_code, 503)
                release.set()
                state._thread.join(2)
                self.assertEqual(client.get("/readyz").json(), {"status": "ready"})
        self.assertFalse(state.ready)


if __name__ == "__main__":
    unittest.main()
