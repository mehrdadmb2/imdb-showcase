# Cinema Vault Telegram Worker v2.0.1

This folder is the standalone Wrangler deployment bundle. Deploy `index.js` as an ES-module Worker.

## 1) Preserve the existing D1 database

Use the same D1 database currently bound as `DB`. Do not create a new database or run destructive migrations. The Worker v2.0.1 reuses the current table layout for:

- `subscribers`
- `seen_titles`
- `notification_queue`
- `favorites`
- `search_sessions`
- `processed_updates`
- `rate_limits`
- `bot_state`
- `import_log`

The `notification_queue` table must include `created_at`, and `seen_titles` must include `first_seen_at` (the current Worker version already relies on these columns).

## 2) Prepare Wrangler config

```powershell
Copy-Item .\wrangler.toml.example .\wrangler.toml
notepad .\wrangler.toml
```

Replace only `database_name` and `database_id` with the values of the existing D1 database. Keep the binding name exactly `DB`. Set the Worker name to the currently deployed service name if Cloudflare requires it to remain unchanged.

## 3) Set secrets

```powershell
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put WORKER_PING_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_IDS
```

`ADMIN_IDS` can contain comma- or space-separated Telegram numeric IDs. `GITHUB_TOKEN` needs **Contents: Read and write** plus **Actions: Read and write** for `mehrdadmb2/imdb-showcase`.

The same value must be used for:

- Cloudflare Worker secret `WORKER_PING_SECRET`
- GitHub repository Actions secret `WORKER_PING_SECRET`

Do not put any of these values in `wrangler.toml`, GitHub Pages files, or source control.

## 4) Deploy

From this directory:

```powershell
npx wrangler deploy
```

Then inspect:

```powershell
Invoke-RestMethod https://imdb-showcase-telegram-bot.game-developer-mb.workers.dev/health
```

Expected health fields include `ok: true`, `version: 2.0.1`, `databaseConfigured: true`, `botTokenConfigured: true`, `githubImportConfigured: true`, and `schedulerConfigured: true`.

## 5) Verify GitHub automation

The bot uploads the new CSV and dispatches `update-movies.yml`. The separate `.github/workflows/ping-telegram-worker.yml` is now also subscribed to `workflow_run` for `IMDb Showcase — resilient data pipeline` and proceeds only when the pipeline conclusion is `success`. The 30-minute schedule stays as a recovery path.

In GitHub repository Settings → Secrets and variables → Actions, make sure `WORKER_PING_SECRET` exists. No Cloudflare token or account API token is needed in GitHub Actions; the workflow calls the Worker endpoint with the shared ping secret.

## 6) Bot usage

- `/top` — Vault Rank ordering (personal rating + Bayesian IMDb rating/votes + recency).
- `/stats` — library, average ratings, total vote volume, Vault Rank average and latest/highest-ranked title.
- `/latest`, `/search`, `/series`, `/genres`, `/genre`, `/random`, `/mylist`.
- `/subscribe` / `/unsubscribe` — new-title notifications.
- `/import` — admin-only CSV import; upload a `.csv` document after the prompt.
- `/adminstatus` — D1, dataset, subscriber, queue and recent CSV-import diagnostics.

New-title alerts use the queue's `created_at` timestamp and display the first-detected date and time in the `Asia/Tehran` timezone. That timestamp describes when the Worker detected the title in the published dataset; `Date Rated` remains the date from the IMDb export.

## Important operational note

Do not change the public Worker hostname unless you also update `ping-telegram-worker.yml` and the Telegram webhook configuration workflow. Do not rotate `WEBHOOK_SECRET` without re-running the webhook configuration workflow.

## 7) Local regression tests

Install Node.js 20+ (no package downloads are required) and run:

```powershell
cd worker
npm test
```

The tests check formula parity between the website and Worker, IMDb vote confidence, rating-date recency, quoted CSV fields, and old/new CSV reconciliation.
