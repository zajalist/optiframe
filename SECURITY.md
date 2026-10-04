# Security and responsible disclosure

For a security report, contact the maintainers privately before publishing an exploit or user data. Do not post credentials, camera frames or account tokens in a public issue.

## Running safely

- `.env.local`, `.venv/`, model caches, capture ZIPs, user images and runtime logs are local artifacts. Never commit them. Model weights download from the model provider at runtime.
- Local developer mode does not require an account. Bind `uvicorn` to `127.0.0.1`; do not expose that port through a public tunnel.
- Production mode must be configured with Supabase user approval or the private internal test key. Browser requests use a user's Bearer token. The GPU service checks approval before upload parsing and expensive work; denied checks fail closed.
- A Supabase publishable/anon key is public by design. The service-role key, Resend key, cron secret, internal GPU key and Higgsfield key are server-side secrets. Store them in service settings or the Windows encrypted runtime configuration, never in `web/` or `app-config.json`.
- Vercel builds use an explicit public-file copy. Review deployment variables and build output before releasing. Keep the temporary tunnel or its successor protected by the GPU authorization boundary.
- Avoid recording faces or lens images in request logs. The supervisor redacts known token forms; this is not a substitute for never logging private payloads.

## Current controls and limits

The API has bounded upload sizes and timeouts, one expensive-work slot, request authentication, and no-store responses. Account approval is enforced by Supabase RPC and row-level security, rather than user-editable metadata. Browser API calls stay on the app origin. The optional internal key remains for controlled testing; do not share links containing it or use it as public account access.

This is an experimental fit-test workflow. A successful segmentation or printable STL is not proof of optical or mechanical safety. Follow [validation](docs/validation.md) before physical use.
