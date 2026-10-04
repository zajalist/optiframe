import io
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from supervisor import (ChildJob, HealthPolicy, InstanceLock, RestartBackoff,
                        RedactingFormatter, backend_command, child_environment, probe, redact)


class SupervisorTests(unittest.TestCase):
    def test_warmup_and_spaced_consecutive_liveness_failures(self):
        policy = HealthPolicy(100)
        self.assertFalse(policy.due(219.99))
        self.assertTrue(policy.due(220))
        self.assertFalse(policy.record(False, 220))
        self.assertFalse(policy.due(229.99))
        self.assertFalse(policy.record(False, 230))
        self.assertFalse(policy.record(True, 240))
        self.assertEqual(policy.failures, 0)
        self.assertFalse(policy.record(False, 250))
        self.assertFalse(policy.record(False, 260))
        self.assertTrue(policy.record(False, 270))

    def test_exponential_backoff_capped_and_reset_only_after_stable_uptime(self):
        backoff = RestartBackoff()
        self.assertEqual([backoff.delay(20) for _ in range(9)], [1, 2, 4, 8, 16, 32, 60, 60, 60])
        self.assertEqual(backoff.delay(300), 1)

    def test_lock_excludes_another_handle_and_releases(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = InstanceLock(Path(temp) / "lock"), InstanceLock(Path(temp) / "lock")
            try:
                self.assertTrue(first.acquire())
                self.assertFalse(second.acquire())
                first.close()
                self.assertTrue(second.acquire())
            finally:
                first.close()
                second.close()

    def test_key_and_header_redaction_including_exception_output(self):
        token = "test-sensitive-api-key"
        text = f"error {token} access={token}&v=1 X-OptiFrame-Key: other-secret Authorization: Bearer other-bearer"
        clean = redact(text, token)
        for secret in (token, "other-secret", "other-bearer"):
            self.assertNotIn(secret, clean)
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(RedactingFormatter(token))
        logger = logging.getLogger("test-redaction")
        logger.addHandler(handler)
        try:
            try:
                raise ValueError(token)
            except ValueError:
                logger.exception("crash")
        finally:
            logger.removeHandler(handler)
        self.assertNotIn(token, stream.getvalue())

    def test_probe_failures_and_readiness_are_plain_boolean_observations(self):
        for error in (TimeoutError(), URLError("offline"), HTTPError("url", 503, "not ready", {}, None)):
            with self.subTest(error=type(error)), patch("supervisor.urlopen", side_effect=error):
                self.assertFalse(probe("/readyz", "secret"))
                self.assertFalse(probe("/healthz", "secret"))
        with patch("supervisor.urlopen") as request:
            request.return_value.__enter__.return_value.status = 200
            self.assertTrue(probe("/healthz", "secret"))
            self.assertEqual(request.call_args.kwargs["timeout"], 3)

    def test_single_worker_local_bind_and_token_only_in_environment(self):
        command = backend_command(Path("C:/test repo"))
        self.assertEqual(command[command.index("--workers") + 1], "1")
        self.assertEqual(command[command.index("--host") + 1], "127.0.0.1")
        self.assertNotIn("secret", " ".join(command))
        with patch.dict(os.environ, {"OPTIFRAME_ACCESS_TOKEN": "secret"}):
            self.assertEqual(child_environment()["OPTIFRAME_ACCESS_TOKEN"], "secret")
            self.assertEqual(child_environment()["OPTIFRAME_ENV"], "production")

    def test_public_config_reloads_each_worker_and_cannot_replace_private_environment(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"OPTIFRAME_ACCESS_TOKEN": "private"}):
            runtime = Path(temp)
            path = runtime / "public-services.json"
            config = {"SUPABASE_URL": "https://first.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_testing_only"}
            path.write_text(json.dumps(config), encoding="utf-8")
            first = child_environment(runtime)
            self.assertEqual(first["SUPABASE_URL"], config["SUPABASE_URL"])
            self.assertEqual(first["OPTIFRAME_ACCESS_TOKEN"], "private")
            config["SUPABASE_URL"] = "https://second.supabase.co/"
            path.write_text(json.dumps(config), encoding="utf-8")
            self.assertEqual(child_environment(runtime)["SUPABASE_URL"], "https://second.supabase.co")
            config["PYTHONPATH"] = "untrusted"
            path.write_text(json.dumps(config), encoding="utf-8")
            self.assertNotIn("SUPABASE_URL", child_environment(runtime))
            self.assertEqual(child_environment(runtime)["OPTIFRAME_ACCESS_TOKEN"], "private")

    def test_invalid_public_config_clears_stale_account_environment_without_logging_values(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {
            "SUPABASE_URL": "https://stale.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "stale-key"}):
            path = Path(temp) / "public-services.json"
            bad = {"SUPABASE_URL": "https://safe.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_secret_DO_NOT_PRINT"}
            for value in (json.dumps(bad), "{broken", "x"*16385):
                path.write_text(value, encoding="utf-8")
                with self.assertLogs("test-public-config", level="WARNING") as logs:
                    env = child_environment(Path(temp), logging.getLogger("test-public-config"))
                self.assertNotIn("SUPABASE_URL", env)
                self.assertNotIn("SUPABASE_PUBLISHABLE_KEY", env)
                self.assertNotIn("DO_NOT_PRINT", "".join(logs.output))

    @unittest.skipUnless(os.name == "nt", "Windows Job Object integration")
    def test_job_close_kills_only_owned_dummy_child(self):
        job = ChildJob()
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                 creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW)
        try:
            job.attach(child)
            self.assertIsNone(child.poll())
            job.close()
            child.wait(timeout=5)
            self.assertIsNotNone(child.returncode)
        finally:
            job.close()
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
