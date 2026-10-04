import asyncio
import os
import unittest
from unittest.mock import patch

import httpx

from account_access import AccountAccess, AccessDecision
from runtime_guard import RuntimeGuard, RuntimeState
from test_runtime_guard import echo, request


USER = "57a17b83-7e59-4b98-81f8-721bd3637ab2"
TOKEN = "header.payload.signature"


class AccountAccessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "public-test-key", "OPTIFRAME_ACCESS_TOKEN": ""})
        self.env.start()
        self.addCleanup(self.env.stop)

    def verifier(self, status="approved", **options):
        self.calls = []
        async def handler(req):
            self.calls.append(req)
            self.assertEqual(req.headers["authorization"], "Bearer "+TOKEN)
            self.assertEqual(req.headers["apikey"], "public-test-key")
            if req.url.path == "/auth/v1/user":
                self.assertEqual(req.method, "GET")
                return httpx.Response(200, json={"id": USER, "user_metadata": {"approved": True}})
            self.assertEqual(req.url.path, "/rest/v1/rpc/get_my_access")
            self.assertEqual(req.method, "POST")
            self.assertEqual(req.content, b"{}")
            return httpx.Response(200, json={"status": status, "isAdmin": False})
        return AccountAccess(transport=httpx.MockTransport(handler), **options)

    async def test_approval_requires_verified_user_and_authoritative_rpc(self):
        access = self.verifier()
        self.assertEqual(await access.verify(TOKEN), AccessDecision(200, "Approved", USER))
        self.assertEqual(len(self.calls), 2)
        for status in ("pending", "rejected", None, "APPROVED"):
            self.assertEqual((await self.verifier(status).verify(TOKEN)).status, 403)

    async def test_missing_configuration_malformed_token_and_invalid_user_fail_closed(self):
        access = self.verifier()
        with patch.dict(os.environ, {"SUPABASE_PUBLISHABLE_KEY": ""}):
            self.assertEqual((await access.verify(TOKEN)).status, 503)
        for url in ("http://example.supabase.co", "https://user:pass@example.supabase.co", "https://[broken"):
            with patch.dict(os.environ, {"SUPABASE_URL": url}):
                self.assertEqual((await access.verify(TOKEN)).status, 503)
        for token in ("", "fake", "a.b.c\n", "a"*8193):
            self.assertEqual((await access.verify(token)).status, 401)
        self.assertEqual(len(self.calls), 0)
        for user in ({}, {"id": "invalid"}, []):
            bad = AccountAccess(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=user)))
            self.assertIn((await bad.verify(TOKEN)).status, (401, 503))

    async def test_invalid_auth_redirect_error_and_oversized_response_never_allow(self):
        for code, expected in ((401, 401), (403, 401), (302, 503), (500, 503)):
            calls = []
            def handler(req):
                calls.append(req)
                return httpx.Response(code, headers={"location": "https://evil.test"})
            access = AccountAccess(transport=httpx.MockTransport(handler))
            self.assertEqual((await access.verify(TOKEN)).status, expected)
            self.assertEqual(len(calls), 1)
        access = AccountAccess(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b"x"*65537)))
        self.assertEqual((await access.verify(TOKEN)).status, 503)

    async def test_cache_is_bounded_hashed_and_expires_within_30_seconds(self):
        now = [0]
        access = self.verifier(clock=lambda: now[0], ttl=999, max_cache=1)
        self.assertEqual((await access.verify(TOKEN)).status, 200)
        now[0] = 29.9
        self.assertEqual((await access.verify(TOKEN)).status, 200)
        self.assertEqual(len(self.calls), 2)
        self.assertNotIn(TOKEN, repr(access._cache))
        now[0] = 30
        self.assertEqual((await access.verify(TOKEN)).status, 200)
        self.assertEqual(len(self.calls), 4)
        with patch.dict(os.environ, {"SUPABASE_URL": "https://other.supabase.co"}):
            self.assertEqual((await access.verify(TOKEN)).status, 200)
        self.assertEqual(len(access._cache), 1)
        self.assertEqual(len(self.calls), 6)

    async def test_revocation_after_cache_expiry_and_denial_cache_at_most_three_seconds(self):
        now = [0]
        approved = [True]
        def handler(req):
            return httpx.Response(200, json={"id": USER} if req.url.path.endswith("/user") else
                                  {"status": "approved" if approved[0] else "rejected"})
        access = AccountAccess(clock=lambda: now[0], transport=httpx.MockTransport(handler))
        self.assertEqual((await access.verify(TOKEN)).status, 200)
        approved[0] = False
        now[0] = 30
        self.assertEqual((await access.verify(TOKEN)).status, 403)
        self.assertEqual(len(access._cache), 1)
        approved[0] = True
        now[0] = 32.9
        self.assertEqual((await access.verify(TOKEN)).status, 403)
        now[0] = 33
        self.assertEqual((await access.verify(TOKEN)).status, 200)

    async def test_account_only_service_warms_and_reports_ready_without_internal_key(self):
        import segment
        state = RuntimeState(production=True)
        with patch.object(segment, "runtime", state), patch.object(segment, "_warm_predictor", lambda: None):
            async with segment.lifespan(segment.app):
                state._thread.join(1)
                self.assertEqual((await segment.readyz()).status_code, 200)
                with patch.dict(os.environ, {"SUPABASE_PUBLISHABLE_KEY": ""}):
                    self.assertEqual((await segment.readyz()).status_code, 503)

    async def test_slow_remote_has_deadline_and_no_unbounded_queue(self):
        entered = asyncio.Event()
        async def handler(req):
            entered.set()
            await asyncio.sleep(10)
        access = AccountAccess(transport=httpx.MockTransport(handler), deadline=.05, max_inflight=1)
        pending = asyncio.create_task(access.verify(TOKEN))
        await entered.wait()
        self.assertEqual((await access.verify(TOKEN)).status, 503)
        self.assertEqual((await pending).status, 503)
        self.assertTrue(access._slots.acquire(blocking=False), "Timeout releases verification slot")
        access._slots.release()

    async def test_auth_precedes_body_and_expensive_admission_and_key_remains_internal(self):
        access = self.verifier("pending")
        entered = []
        async def endpoint(scope, receive, send):
            entered.append(scope["state"].get("account_user_id"))
            await echo(scope, receive, send)
        guard = RuntimeGuard(endpoint, RuntimeState(), account_access=access)
        code, _, _ = await request(guard, chunks=[b"must not parse"],
                                  headers=[(b"authorization", ("Bearer "+TOKEN).encode())])
        self.assertEqual(code, 403)
        self.assertEqual(entered, [])
        self.assertTrue(guard._slots.acquire(blocking=False))
        guard._slots.release()
        guard.account_access = self.verifier()
        self.assertEqual((await request(guard, headers=[(b"authorization", ("Bearer "+TOKEN).encode())]))[0], 200)
        self.assertEqual(entered, [USER])
        self.assertEqual((await request(guard))[0], 401)
        with patch.dict(os.environ, {"OPTIFRAME_ACCESS_TOKEN": "private-test"}):
            self.assertEqual((await request(guard, headers=[(b"x-optiframe-key", b"private-test")]))[0], 200)
            # A malformed Bearer cannot silently fall through to a different identity.
            self.assertEqual((await request(guard, headers=[(b"authorization", b"Basic nope"),
                                  (b"x-optiframe-key", b"private-test")]))[0], 401)
        self.assertEqual((await request(guard, headers=[(b"authorization", b"Bearer "+TOKEN.encode())]*2))[0], 401)


if __name__ == "__main__":
    unittest.main()
