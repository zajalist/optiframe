# GPU backend account access

The public frontend sends the signed-in user's access token as
`Authorization: Bearer <JWT>` to `/api/*`. Configure the worker environment with
`SUPABASE_URL` (HTTPS project origin) and `SUPABASE_PUBLISHABLE_KEY`.
Do not provide a service-role key: approval is read with the user's identity.

For the desktop supervisor, save `public-services.json` inside its configured
runtime directory with exactly these two properties:

```json
{"SUPABASE_URL":"https://YOUR_PROJECT.supabase.co","SUPABASE_PUBLISHABLE_KEY":"sb_publishable_YOUR_PUBLIC_KEY"}
```

The supervisor re-reads this file before each new worker launch. It allows only
these public settings; the DPAPI-protected private test credential is unchanged.
An invalid file removes account configuration from the child environment and
logs a generic warning. Replace the file atomically to avoid partial reads.
Installing this supervisor code initially requires one supervisor restart;
after that, a coordinated worker restart is enough to load configuration changes.
Writing the file does not interrupt a currently running capture by itself.

Before reading an upload body or claiming a GPU/CAD slot, `RuntimeGuard`:

1. Calls `GET /auth/v1/user` to validate the user token on Supabase.
2. Calls `POST /rest/v1/rpc/get_my_access`, with `{}` and the same user token.
3. Requires the RPC object to contain `status: "approved"`.

The RPC must use `auth.uid()` and authoritative access records. Browser data,
user-editable metadata, and client assertions never grant access. The account
schema and RPC are maintained alongside the account application's migration.

Positive decisions expire within 30 seconds; negative decisions within 3 seconds.
The cache holds at most 512 token hashes and decisions, never raw tokens. A
revocation can therefore take up to 30 seconds to take effect. Remote checks
have a 6-second total deadline, 3-second network timeouts, 64 KiB response limits,
and at most eight in-flight checks with no waiting queue. Failed configuration,
remote errors, invalid users and missing approval fail closed. Redirects are not
followed. Error responses and logs omit credentials and provider response bodies.

The existing private `X-OptiFrame-Key` remains an internal testing alternative
when `OPTIFRAME_ACCESS_TOKEN` is configured. Never embed that key in a public
frontend. A supplied Bearer header always takes precedence and cannot fall
through to the private-key identity on failure. Production warm-up/readiness
accepts either complete account configuration or the private testing key.

This implementation is covered by mocked boundary tests:

```powershell
cd gpu
python -m unittest test_account_access test_runtime_guard
```

Live account approval requires the Supabase project, RPC migration and worker
environment to be configured. Passing these tests alone does not activate it.

References: [Supabase server-side user verification](https://supabase.com/docs/reference/python/auth-getuser),
[publishable keys](https://supabase.com/docs/guides/getting-started/api-keys).
