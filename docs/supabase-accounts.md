# Supabase accounts and app waitlist

Vercel serves the web app. Supabase manages authentication, PostgreSQL and row authorization. No AWS resources or custom password database are used. Account sign-in alone does **not** grant GPU access; the desktop API verifies approved status. Existing private internal test links retain their separate credential.

## Activate an existing project

1. Apply both files in `supabase/migrations/` in order to the intended Supabase project using the Supabase CLI or SQL editor. Review the project identity before applying them. These create profiles, applications, access decisions and an email outbox. An auth trigger maintains access records when verified email changes.
2. Enable email/password authentication and **email confirmation**. Set a strong password policy, auth rate limits and production SMTP. Supabase's development email sender has restrictive limits; do not advertise production email delivery until SMTP is configured and tested.
3. Set Auth Site URL to `https://optiframe.zajalist.com`. Allow exact callbacks `https://optiframe.zajalist.com/account.html` and `https://optiframe.zajalist.com/account.html?recovery=1`, plus any intentionally used staging origin. Avoid broad production redirect wildcards.
4. For Google, configure the Google OAuth client in Supabase Auth and add the Supabase callback URL to that Google client. Only then set `googleEnabled` to true. Google credentials belong in provider settings, never in this repository or the browser.
5. Serve `/app-config.json` with this public configuration (the Vercel build/runtime can generate it):

```json
{
  "supabaseUrl": "https://PROJECT.supabase.co",
  "supabasePublishableKey": "sb_publishable_PUBLIC_KEY",
  "googleEnabled": false
}
```

The legacy `anon` JWT is also accepted. A service-role JWT or `sb_secret_` key is rejected. Never put database credentials or service-role keys in public config. Authentication uses Supabase's PKCE browser flow; the SDK manages access/refresh tokens in browser storage, so the deployment must prevent XSS and restrict third-party scripts. This is not an HttpOnly server-cookie architecture.

## Frontend contract

`web/account-service.js` exports `loadAccount`, `signUp`, `signIn`, `signInWithGoogle`, `signOut`, `saveApplication`, `requestPasswordReset`, and `updatePassword`.

Account results contain `{user: {id,email} | null, application: object | null}`. `loadAccount` also returns `googleEnabled` and `passwordRecovery`. A new email signup normally returns `{user:null, application:null, needsEmailConfirmation:true}`. The UI must ask the user to check email and must **not** claim a saved waitlist place yet. Duplicate-email signup errors are generic; Supabase email confirmation must remain enabled for its built-in signup anti-enumeration behavior.

Application input is `{platform: 'iphone'|'android'|'both', role: ''|'tester'|'provider'|'designer', note: string, consent: true}`. Notes are optional and limited to 500 characters. Only a signed-in user with verified email can save. A validated pending application is kept in `sessionStorage` across OAuth/email flow in the same tab; when confirmation opens elsewhere, the user fills the application again. No password is stored by this module. Explicit signup/reset actions call managed Supabase Auth. Each first application queues an owner notification through the server outbox described below.

Output application fields: platform, role, note, consent, status, consentedAt, createdAt, updatedAt. Database timestamps are authoritative. `passwordRecovery` only selects UI; server-validated auth is still required to update a password.

## Authorization and administration

- Anonymous users have no table access.
- Authenticated users can select only their own row, create their own application after email confirmation, and update platform/role/note/consent. Repeated delete/recreate applications are disabled to prevent notification spam; withdrawal is handled by the owner.
- Owner IDs default to `auth.uid()` and cannot be supplied or changed by browser roles.
- Status and timestamps have no client insert/update privileges. Only the verified owner can call the administrative review RPCs; the public browser key itself never grants approval authority.
- Profiles contain only optional display name, owner and server timestamps. Email stays in managed Auth; there is no public email directory.
- Explicit consent is mandatory. Account deletion in Auth cascades to these rows. Support should use the protected Supabase dashboard for account deletion/withdrawal requests until a self-service deletion flow is added.

## Verification before production

Run `node --test web/account-service.test.mjs`. Run `supabase/tests/accounts_rls.sql` using a PostgreSQL owner connection in a disposable or staging project; the test is transactional and rolls back. Test actual confirmation, Google callback, reset email, sign-out and persistence on the deployed HTTPS origin. Without project credentials these cloud checks cannot be marked passed.

Local validation completed: the migration and RLS test passed in an isolated PGlite PostgreSQL runtime with stubbed Supabase auth roles/`auth.uid()`. This checks SQL execution and privileges, including forged owner/status/timestamp rejection and cross-account isolation. It does not replace running the same test against the chosen Supabase project. No cloud project was provisioned by these changes.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security), [Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google), [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

## Approval gate

`public.app_access` is authoritative: `pending`, `approved`, or `rejected`. Authentication permits requesting access; it does not itself authorize the lens app. `get_my_access()` returns `{status,isAdmin}` for the authenticated subject only. The GPU/backend must independently validate the Supabase bearer token with `/auth/v1/user`, then require `get_my_access().status === 'approved'`. Never inject the shared internal test key for arbitrary signed-in users. `api/_lib/supabase-access.mjs` supplies this check for server functions; the desktop GPU service has its own guard.

The normalized exact email `zejbadr@gmail.com` receives owner access only when `auth.users.email_confirmed_at` is set. Client metadata is never consulted. **Email confirmation must remain enabled**: auto-confirming arbitrary email registrations would defeat proof of mailbox ownership. Changing the owner's verified email away from this address revokes automatic owner access. A previously manually approved ordinary account remains subject to its recorded review decision.

The browser service adds `accessStatus` and `isAdmin` to account results. `getAccessToken()` returns the SDK-managed bearer for authenticated API requests; it must not be placed in URLs or logs. `adminListApplications({limit,offset})` returns only to the verified owner. `adminSetAccess(userId,status)` records reviewer/time and synchronizes the application. Notification status is included as `notificationState`, `notificationAttempts`, and `notificationError`, so failed delivery is visible in the admin UI.

## Application email delivery

Every new confirmed-user application creates one immutable notification snapshot in `application_email_outbox` in the same transaction. The recipient is fixed server-side to `zejbadr@gmail.com`; client input cannot choose a recipient. Existing confirmed applications are backfilled once by migration 002. Preference edits do not send duplicate applications.

Set these **server-only Vercel variables**:

- `SUPABASE_SERVICE_ROLE_KEY`: trusted service-role key, never public config.
- `RESEND_API_KEY`: transactional sending key.
- `RESEND_FROM`: verified sending domain/address, e.g. `OptiFrame <access@YOUR_VERIFIED_DOMAIN>`.
- `CRON_SECRET`: randomly generated secret with at least 32 characters.

The notification function also uses public `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Keep `/api/application-notifications` routed to its Vercel function, ahead of any external GPU rewrite; configure `maxDuration: 60`.

The browser sends an immediate authenticated POST nudge after saving a new application. The endpoint revalidates the JWT and claims only that user's existing outbox row. It never constructs an arbitrary email from request data. A GET/POST with the cron secret can drain a bounded batch of three rows. Leases prevent concurrent sends; a stable Resend idempotency key handles ambiguous retries within the provider's retention window.

**Reliable retry requires the five-minute scheduler:** enable Supabase Cron (`pg_cron`), `pg_net`, and Vault, save the same `CRON_SECRET` as Vault secret `optiframe_notification_cron_secret`, then run `supabase/setup/notification-schedule.sql`. The script contains no credentials. A daily Vercel cron can remain as a backup, but it is too infrequent for the retry window. Check Supabase Cron job runs and `net._http_response` after activation.

Retries use exponential backoff, up to eight attempts and 23 hours after the first attempt. Sent rows are never claimed again. Rows exceeding that window enter `review` instead of risking a duplicate after Resend's 24-hour idempotency cache expires. The owner must inspect the provider's delivery log before manually retrying an ambiguous row. This is not an unlimited exactly-once delivery guarantee. Missing provider configuration leaves rows queued, and application submission must not be presented as proof that email was delivered.

Tests: `node --test web/account-service.test.mjs api/application-notifications.test.mjs`; additionally run both SQL scripts in `supabase/tests/` after their corresponding migrations. Local PGlite checks passed for owner bootstrap, metadata spoof rejection, approval, owner revocation, outbox leases and duplicate suppression. Provider delivery, Supabase scheduler activation, and deployed JWT enforcement still require a configured project and end-to-end verification.

References: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Supabase scheduling with Vault](https://supabase.com/docs/guides/functions/schedule-functions), [Vercel cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
