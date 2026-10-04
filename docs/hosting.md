# OptiFrame hosting

## Public website

- Vercel project: `zajalists-projects/optiframe` (`prj_7m8GTYN50h40OZ7NQwByxTw36AWT`).
- Production: `https://optiframe.zajalist.com`.
- Cloudflare DNS: `optiframe` CNAME points to the Vercel-assigned target; DNS only. The apex site is unchanged.
- `node deploy/build-web.mjs` copies only public web files to `dist`. Camera captures, `Saved`, database secrets, native projects and GPU files are not deployment inputs.
- `/` serves the landing page. `/index.html` maps to the scanner. Static demo assemblies load without accounts, private test keys or GPU inference.

## Accounts and access

Supabase owns accounts, approvals and the application outbox. Follow `supabase-accounts.md` for migrations, email confirmation, Google OAuth and notification delivery.

Vercel build variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` — public key only; never a service role key
- `SUPABASE_GOOGLE_ENABLED=true` only after the provider is configured and tested

Vercel server-only variables:

- `SUPABASE_SERVICE_ROLE_KEY` — notification outbox worker only
- `RESEND_API_KEY`, `RESEND_FROM` — verified sender, for requests emailed to the fixed owner
- `CRON_SECRET` — random secret shared with the Supabase Vault retry schedule

Missing configuration fails closed. A deployed page is not evidence that provider signup, emails or approval persistence work. Run live auth/notification checks after configuration; do not use real third-party addresses for tests.

## Desktop GPU

Vercel rewrites GPU API routes to the existing desktop tunnel. Image bodies bypass Vercel Functions' body-size limit. The desktop verifies Supabase user identity and approved access before parsing uploads. The private internal test credential remains independent and is not published in Vercel configuration. The notification endpoint is a separate Vercel Function.

The current tunnel is temporary and the desktop must stay awake. Replace the quick-tunnel origin with a stable named tunnel before inviting a production cohort. Do not call this a highly available GPU service. No AWS infrastructure is provisioned by this project.

## Deploy

Verify the linked project before deploying:

```powershell
vercel project inspect --non-interactive
node --test web/*.test.mjs web/*.test.cjs api/*.test.mjs
vercel deploy --prod --yes --scope zajalists-projects --non-interactive
```

After deployment verify the landing page, keyless saved-frame try-on, scanner approval gate, and unauthorized API rejection. Supabase's five-minute notification schedule is the primary retry mechanism; Vercel's daily cron is a backup, not the delivery cadence.
