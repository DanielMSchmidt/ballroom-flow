# Provisioning — accounts & secrets

The codebase builds, typechecks, lints, and passes its test suite **without any
external accounts** (the Worker tests run on local `workerd`; Clerk auth is
gated on env vars and tested only on its negative path). To run the app for
real and to deploy, complete the steps below. None of these block development
of the pure domain core (Milestone 1).

> **⚠ THE ONE INVARIANT THAT BROKE PRODUCTION (2026-07-05):** per environment, the
> SPA's baked `VITE_CLERK_PUBLISHABLE_KEY` (a **GitHub environment variable**, read at
> build time by `deploy.yml`) and the worker's `CLERK_SECRET_KEY`/`CLERK_JWT_KEY`
> (**Wrangler secrets**) MUST belong to the **same Clerk instance**. They are set in two
> different consoles, so they can drift independently — and when they do, sign-in still
> *works* (against the SPA's instance) but the worker rejects every session token:
> **every API call 401s and nobody can create/list/open anything**, with no unhandled
> error anywhere. Incident: production's worker secrets were rotated to the new
> `clerk.weavesteps.com` production instance while the `production` GitHub environment
> still baked the shared `pk_test` dev-instance key. Diagnosis aids now in place:
> `GET /api/health` reports `clerkConfigured`/`sentryConfigured`, and the worker sends
> an `AuthVerificationError` (reason `token-invalid-signature`) to Sentry when a
> mismatched token is seen (needs `SENTRY_DSN` set).

## Status (updated 2026-06-25)

| Item | State |
|---|---|
| D1 `weave-steps-staging` + `weave-steps-production` | ✅ created; `database_id`s wired into `wrangler.toml` |
| Staging + production Workers | ✅ smoke-deployed and verified healthy (`/api/health` → `{ok:true}`, SPA + fallback OK) |
| GitHub Environments `staging` + `production` | ✅ created |
| `CLOUDFLARE_ACCOUNT_ID` (both GH environments) | ✅ set |
| `CLOUDFLARE_API_TOKEN` (both GH environments) | ✅ set — CI deploy is live |
| `VITE_CLERK_PUBLISHABLE_KEY` (GH Actions **variable**, both envs) | ⚠ **stale for production (the 2026-07-05 outage)** — still the shared `pk_test` dev-instance key in BOTH GitHub environments, while production's worker secrets moved to the `clerk.weavesteps.com` production instance. Set the `production` environment's variable to that instance's `pk_live_…` key and re-run the production deploy (the key is public — it ships in every page). |
| Local dev keys (`apps/web/.env.local`, `apps/worker/.dev.vars`) | ✅ present (`pk_test` / `sk_test`) |
| `CLERK_SECRET_KEY` (Wrangler secret) — **staging** | ✅ set (`wrangler secret put … --env staging`) |
| **`CLERK_SECRET_KEY` (Wrangler secret) — production** | ⬜ **TODO — you** — pending a Clerk **production** instance (`sk_live`); see §1 |
| `SENTRY_DSN` (Wrangler secret, staging + production) | ⬜ **optional — you** — US-049 error reporting is wired (`apps/worker/src/ops.ts`, no SDK); without the secret it's a silent no-op. `wrangler secret put SENTRY_DSN --env staging\|production` with the project DSN from sentry.io. Verify with `GET /api/health` → `sentryConfigured: true` |
| `VITE_SENTRY_DSN` (GH Actions **variable**, per env) | ⬜ **optional — you** — the WEB half of US-049 (`apps/web/src/lib/ops.ts`, added 2026-07-05): client-side errors (uncaught exceptions, 5xx, authed-401s, network failures) report to Sentry. Without the variable the reporter is a silent no-op — which is why the 2026-07-05 auth outage produced zero Sentry events |
| Analytics Engine dataset | ✅ nothing to provision — the `ANALYTICS` binding in `wrangler.toml` auto-creates the dataset on first write (Workers Paid) |
| R2 `weave-steps-media-staging` + `weave-steps-media-production` (annotation media) | ✅ created 2026-07-19 (ENAM, Standard); `MEDIA` binding wired into `wrangler.toml` (default + e2e + staging + production). **No new secret** — serving/upload are worker-hosted, so there is no S3 credential class. Dev/E2E use Miniflare-simulated buckets (`weave-steps-media-dev`/`-e2e`). |
| `production` required-reviewer rule | ⬜ optional |

CI now deploys on push: `development` → **staging**, `main` → **production** (see §3).
Everything currently runs on Clerk's shared **dev/test** instance (`pk_test`/`sk_test`),
which is correct for dev + staging; a real production launch needs a Clerk
**production** instance (`pk_live`/`sk_live`) — re-run the prod `wrangler secret put`
and update the prod GH variable then. You can always deploy manually with
`wrangler deploy --env <env>`.

## 1. Clerk (authentication)

1. Create a Clerk application at <https://dashboard.clerk.com>. Enable **Google**
   sign-in and **passkeys**.
2. **Frontend key** — copy the **Publishable Key** into `apps/web/.env.local`:
   ```
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
   ```
3. **Worker verification key** — set the **Secret Key** as a Wrangler secret
   (per environment):
   ```
   cd apps/worker
   wrangler secret put CLERK_SECRET_KEY               # default/dev
   wrangler secret put CLERK_SECRET_KEY --env staging
   wrangler secret put CLERK_SECRET_KEY --env production
   ```
   (Optionally set `CLERK_JWT_KEY` to the instance PEM for fully networkless
   verification — see `apps/worker/src/auth/index.ts`.)
4. **Session-token claims (for member display names)** — by default a Clerk
   session token carries only `sub`, so we can't show a human name for a member
   who hasn't onboarded (the roster falls back to the raw `user_…` id). In the
   Clerk dashboard → **Sessions → Customize session token**, add the identity
   claims, e.g.:
   ```json
   { "name": "{{user.full_name}}", "email": "{{user.primary_email_address}}" }
   ```
   The Worker reads these networklessly (`displayNameFromClaims` /
   `emailFromClaims`) and caches both (`UserNameCache`) so co-members see a real
   name — or, when only an `email` claim is present, that email — instead of the
   raw id. This is optional and degrades gracefully: without ANY identity claim
   (a `sub`-only token) the roster and comment threads fall back to the user id
   until the user onboards and sets their own display name. **If members are still
   showing as `user_…` in threads, this claim config is almost certainly the
   cause** — the token isn't carrying `name`/`email`.

## 2. Cloudflare (hosting + D1)

```
cd apps/worker
wrangler login
wrangler d1 create weave-steps
```
Copy the returned `database_id` into `apps/worker/wrangler.toml` (replacing the
all-zeros placeholder). Repeat / bind per environment as needed. Migrations are
applied from `apps/worker/migrations/` (created in Milestone 2).

### R2 — annotation media (the first binary storage)

Annotation media (photos/videos) lives in an R2 bucket per env, keyed by
`media/<docRef>/<annotationId>/<mediaId>` (the docRef prefix IS the authz scope —
see `docs/system/architecture.md` § Annotation media). The staging + production
buckets were created 2026-07-19:

```
wrangler r2 bucket create weave-steps-media-staging      # ENAM, Standard
wrangler r2 bucket create weave-steps-media-production    # ENAM, Standard
```

The `MEDIA` binding is declared in the default section **and** each named env of
`wrangler.toml` (bindings are not inherited). Dev + E2E use Miniflare-simulated
buckets, so **nothing needs provisioning for local/CI**, and there is **no new
secret** (serving/upload are worker-hosted — no S3 credential class). **Deferred
ops debt:** a tombstoned media item's R2 object is retained (soft-delete + undo);
an R2 lifecycle rule / Queues GC job to reclaim orphaned objects is not yet built.

## 3. Deployment pipeline & branch workflow

**Branch model:** `development` → **staging**, `main` → **production**. Feature
branches PR into `development`. The deploy workflow (`.github/workflows/deploy.yml`)
runs on push to either branch: it re-runs CI checks, applies D1 migrations to the
remote DB, then `wrangler deploy`s to the matching environment.

**One-time setup:**

1. **Create the two D1 databases** (needs `wrangler login` or a token):
   ```
   cd apps/worker
   wrangler d1 create weave-steps-staging
   wrangler d1 create weave-steps-production
   ```
   Paste each returned `database_id` into `wrangler.toml` (replacing the
   `REPLACE_WITH_*_D1_ID` placeholders).

2. **Create a Cloudflare API token** (Workers Scripts: Edit + D1: Edit + Account
   read) at <https://dash.cloudflare.com/profile/api-tokens>.

3. **Add GitHub Actions secrets**, scoped to the `staging` and `production`
   GitHub Environments (Settings → Environments) so production can have a
   protection/approval rule:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   ```
   gh secret set CLOUDFLARE_API_TOKEN  --env staging
   gh secret set CLOUDFLARE_ACCOUNT_ID --env staging
   gh secret set CLOUDFLARE_API_TOKEN  --env production
   gh secret set CLOUDFLARE_ACCOUNT_ID --env production
   ```

4. Set `CLERK_SECRET_KEY` as a Wrangler secret per env (see §1) so deployed
   Workers can verify tokens.

## 4. Sentry (error monitoring)

Create a Sentry project, then wire both halves (each is a dependency-free
envelope reporter — no Sentry SDK; see `apps/worker/src/ops.ts` and
`apps/web/src/lib/ops.ts`):

- **Worker**: `wrangler secret put SENTRY_DSN --env staging|production`. Reports
  unhandled route errors (`app.onError`) and — since 2026-07-05 — Clerk token
  **verification failures of config class** (wrong-instance signature, missing/
  invalid keys, JWKS trouble; benign classes like `token-expired` stay quiet).
- **Web**: set the `VITE_SENTRY_DSN` **GitHub environment variable** (per env);
  `deploy.yml` bakes it into the SPA. Reports uncaught exceptions, unhandled
  rejections, API 5xx, 401s that carried a session token (the config-mismatch
  signature), and network failures — deduped per class per session.

Without either value the respective half is a silent no-op. Cloudflare
**Tail Workers** remains the zero-setup fallback for server logs.

## Local development

Two terminals:
```
pnpm --filter worker dev     # Worker API on http://localhost:8787
pnpm --filter web dev        # SPA on http://localhost:5173 (proxies /api → :8787)
```
Without `VITE_CLERK_PUBLISHABLE_KEY`, the SPA renders a "set your Clerk key"
first-run notice instead of the sign-in flow.
