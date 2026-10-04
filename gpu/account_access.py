"""Verify Supabase users and authoritative approval without retaining raw tokens."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from time import monotonic
from urllib.parse import urlsplit
from uuid import UUID

import httpx


@dataclass(frozen=True)
class AccessDecision:
    status: int
    detail: str
    user_id: str | None = None


class AccountAccess:
    """At most eight remote verifications, no queue, and <=30s approval caching.

    Auth GET /user verifies the JWT remotely. get_my_access reads only auth.uid's
    approval through the database RPC. User metadata is never authorization.
    """
    def __init__(self, *, transport=None, clock=monotonic, ttl=30, max_cache=512,
                 max_inflight=8, deadline=6):
        self.transport = transport
        self.clock = clock
        self.ttl = max(0, min(30, ttl))
        self.max_cache = max(1, max_cache)
        self.deadline = deadline
        self._cache = OrderedDict()
        self._slots = threading.BoundedSemaphore(max_inflight)

    @staticmethod
    def configured():
        return bool(os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_PUBLISHABLE_KEY"))

    @staticmethod
    def configuration():
        url = os.getenv("SUPABASE_URL", "").rstrip("/")
        key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
        try:
            parsed = urlsplit(url)
        except ValueError:
            return None
        if (not key or parsed.scheme != "https" or not parsed.hostname or
                parsed.username or parsed.password or parsed.query or parsed.fragment or
                parsed.path not in ("", "/")):
            return None
        return url, key

    def _remember(self, digest, started, decision, ttl):
        self._cache[digest] = (started+ttl, decision)
        while len(self._cache) > self.max_cache:
            self._cache.popitem(last=False)
        return decision

    async def verify(self, token):
        configuration = self.configuration()
        if configuration is None:
            return AccessDecision(503, "Account access is not configured")
        url, key = configuration
        if not isinstance(token, str) or len(token) > 8192 or not re.fullmatch(
                r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token):
            return AccessDecision(401, "Sign in again")
        # Configuration changes invalidate prior decisions. Cache keys cannot be
        # replayed as credentials and neither tokens nor response bodies are logged.
        digest = hashlib.sha256((url+"\0"+key+"\0"+token).encode()).hexdigest()
        now = self.clock()
        cached = self._cache.get(digest)
        if cached and now < cached[0]:
            self._cache.move_to_end(digest)
            return cached[1]
        self._cache.pop(digest, None)
        if not self._slots.acquire(blocking=False):
            return AccessDecision(503, "Account verification is busy. Retry shortly")
        try:
            async with asyncio.timeout(self.deadline):
                async with httpx.AsyncClient(transport=self.transport, timeout=3,
                                             follow_redirects=False, trust_env=False) as client:
                    headers = {"apikey": key, "Authorization": "Bearer "+token}
                    user_status, user = await self._json(client, "GET", url+"/auth/v1/user", headers)
                    if user_status in (401, 403):
                        return self._remember(digest, now, AccessDecision(401, "Sign in again"), 3)
                    if user_status != 200 or not isinstance(user, dict):
                        return AccessDecision(503, "Account verification unavailable")
                    try:
                        user_id = str(UUID(user.get("id", "")))
                    except (ValueError, TypeError, AttributeError):
                        return AccessDecision(401, "Sign in again")
                    status, access = await self._json(client, "POST",
                        url+"/rest/v1/rpc/get_my_access", headers, {})
                    if status in (401, 403):
                        return self._remember(digest, now, AccessDecision(403, "Account approval required"), 3)
                    if status != 200 or not isinstance(access, dict):
                        return AccessDecision(503, "Account verification unavailable")
                    if access.get("status") != "approved":
                        return self._remember(digest, now, AccessDecision(403, "Account approval required"), 3)
            decision = AccessDecision(200, "Approved", user_id)
            # TTL begins before the remote round trip, bounding revocation lag.
            return self._remember(digest, now, decision, self.ttl)
        except (httpx.HTTPError, TimeoutError, ValueError, UnicodeError):
            return AccessDecision(503, "Account verification unavailable")
        finally:
            self._slots.release()

    @staticmethod
    async def _json(client, method, url, headers, body=None):
        async with client.stream(method, url, headers=headers,
                                 **({"json": body} if body is not None else {})) as response:
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 65536:
                    raise ValueError("Authentication response too large")
            if response.status_code != 200:
                return response.status_code, None
            return response.status_code, json.loads(data)


def service_auth_configured():
    """Either supported credential path can make the production service ready."""
    return bool(os.getenv("OPTIFRAME_ACCESS_TOKEN")) or AccountAccess.configuration() is not None
