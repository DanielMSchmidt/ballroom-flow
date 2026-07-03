# Provisioning — accounts & secrets

The codebase builds, typechecks, lints, and passes its test suite **without any
external accounts** (the Worker tests run on local `workerd`; Clerk auth is
gated on env vars and tested only on its negative path). To run the app for
real and to deploy, complete the steps below. None of these block development
of the pure domain core (Milestone 1).

## Status (updated 2026-06-25)

| Item | State |
|---|---|
| D1 `ballroom-flow-staging` + `ballroom-flow-production` | ✅ created; `database_id`s wired into `wrangler.toml` |
| Staging + production Workers | ✅ smoke-deployed and verified healthy (`/api/health` → `{ok:true}`, SPA + fallback OK) |
| GitHub Environments `staging` + `production` | ✅ created |
| `CLOUDFLARE_ACCOUNT_ID` (both GH environments) | ✅ set |
| `CLOUDFLARE_API_TOKEN` (both GH environments) | ✅ set — CI deploy is live |
| `VITE_CLERK_PUBLISHABLE_KEY` (GH Actions **variable**, both envs) | ✅ set (`pk_test`, shared Clerk dev instance) |
| Local dev keys (`apps/web/.env.local`, `apps/worker/.dev.vars`) | ✅ present (`pk_test` / `sk_test`) |
| `CLERK_SECRET_KEY` (Wrangler secret) — **staging** | ✅ set (`wrangler secret put … --env staging`) |
| **`CLERK_SECRET_KEY` (Wrangler secret) — production** | ⬜ **TODO — you** — pending a Clerk **production** instance (`sk_live`); see §1 |
| `SENTRY_DSN` (Wrangler secret, staging + production) | ⬜ **optional — you** — US-049 error reporting is wired (`apps/worker/src/ops.ts`, no SDK); without the secret it's a silent no-op. `wrangler secret put SENTRY_DSN --env staging\|production` with the project DSN from sentry.io |
| Analytics Engine dataset | ✅ nothing to provision — the `ANALYTICS` binding in `wrangler.toml` auto-creates the dataset on first write (Workers Paid) |
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
   The Worker reads these networklessly (`displayNameFromClaims`) and caches the
   derived name (`UserNameCache`) so co-members see a real name. This is optional
   and degrades gracefully — without it, names simply fall back to the user id
   until the user onboards and sets their own display name.

## 2. Cloudflare (hosting + D1)

```
cd apps/worker
wrangler login
wrangler d1 create ballroom-flow
```
Copy the returned `database_id` into `apps/worker/wrangler.toml` (replacing the
all-zeros placeholder). Repeat / bind per environment as needed. Migrations are
applied from `apps/worker/migrations/` (created in Milestone 2).

## 3. Deployment pipeline & branch workflow

**Branch model:** `development` → **staging**, `main` → **production**. Feature
branches PR into `development`. The deploy workflow (`.github/workflows/deploy.yml`)
runs on push to either branch: it re-runs CI checks, applies D1 migrations to the
remote DB, then `wrangler deploy`s to the matching environment.

**One-time setup:**

1. **Create the two D1 databases** (needs `wrangler login` or a token):
   ```
   cd apps/worker
   wrangler d1 create ballroom-flow-staging
   wrangler d1 create ballroom-flow-production
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

## 4. Sentry (error monitoring — wired in Milestone 8)

Create a Sentry project; set the DSN for the web SDK (`VITE_SENTRY_DSN`) and the
Worker (`SENTRY_DSN` secret). Until then, Cloudflare **Tail Workers** is the
zero-setup fallback for server logs.

## Local development

Two terminals:
```
pnpm --filter worker dev     # Worker API on http://localhost:8787
pnpm --filter web dev        # SPA on http://localhost:5173 (proxies /api → :8787)
```
Without `VITE_CLERK_PUBLISHABLE_KEY`, the SPA renders a "set your Clerk key"
first-run notice instead of the sign-in flow.
