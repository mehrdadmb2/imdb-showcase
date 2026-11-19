# IMDb Showcase — Cinema Vault v2.0.1

A personal IMDb library with a shared ranking model, resilient metadata pipeline, Classic + Advanced GitHub Pages interfaces, and a Cloudflare Telegram Worker.

## What's changed in v2.0.1

- **Vault Rank** replaces the old “only my rating” top list. The same formula is used by Classic, Advanced and Telegram `/top`:
  - 65% personal IMDb-export rating.
  - 35% Bayesian IMDb score. Vote count determines confidence using a 1,000-vote prior and a 6.5 prior rating, so a 9.0 from a handful of votes does not automatically outrank a well-established 8.7.
  - Up to +0.20 freshness bonus, decaying with a 1,095-day time constant from `Date Rated`.
- IMDb rating, vote count, date rated, Bayesian IMDb score and Vault Rank are visible in cards, details, analytics and bot output.
- CSV import compares the incoming export with the previous committed CSV and reports added, removed, unchanged and modified titles, including rating/date/IMDb/vote changes.
- `Trigger Cinema Vault Telegram Worker` now runs automatically after the `IMDb Showcase — resilient data pipeline` completes successfully. The existing 30-minute schedule remains as a recovery safety net.
- New-title alert messages include the first-detected Tehran date/time, personal rating, IMDb score, vote count and Vault Rank.
- The worker is shipped as a clean Wrangler deployment directory in `worker/`.

## Repository layout

```text
.github/workflows/
  update-movies.yml                 # CSV -> OMDb cache -> docs/movies.json -> GitHub Pages
  ping-telegram-worker.yml          # workflow_run hook + 30-minute recovery scheduler
  configure-telegram-webhook.yml
src/
  ratings.csv                       # authoritative IMDb export
  fetch_imdb.py                     # resilient dataset / poster pipeline
docs/
  index.html                        # GitHub Pages Classic UI
  script.js / style.css
  rating-engine.js                  # shared browser-side Vault Rank model
  movies.json                       # canonical shared dataset
  advanced/                         # Advanced UI reading ../movies.json
  posters/                          # generated local WebP cache
worker/
  index.js                          # Cloudflare Worker entry point
  wrangler.toml.example
  README.md
```

`docs/movies.json` is the only website dataset. Both Classic and Advanced read it. The root-level classic files and `movies.json` are mirrored for a convenient repository preview; Pages still publishes `/docs`.

## CSV import from Telegram

Send `/import` to the bot in a private chat, then upload the new IMDb ratings CSV as a document. The bot:

1. Validates the CSV structure, required headers, unique IMDb IDs and row limit.
2. Reads the previous `src/ratings.csv` from the configured GitHub branch before replacement.
3. Calculates the diff by IMDb ID and tracks changes in `Your Rating`, `Date Rated`, `IMDb Rating`, `Num Votes`, title, original title, IMDb URL, year, type, genres, runtime, release date and directors.
4. Commits only `src/ratings.csv`, then dispatches `update-movies.yml`.
5. After that workflow completes successfully, GitHub automatically starts `ping-telegram-worker.yml`; the Worker reloads the canonical dataset and queues newly added IMDb IDs for subscribers.

The Worker scheduler also runs twice per hour as a fallback. `seen_titles` is an ID-based baseline, so titles already present in D1 are not announced as new on every import.

## Vault Rank definition

Let `R` be IMDb score, `v` vote count, `C = 6.5` prior rating, and `m = 1000` prior votes:

```text
IMDb_Bayesian = (v / (v + m)) * R + (m / (v + m)) * C
Base = 0.65 * Your_Rating + 0.35 * IMDb_Bayesian
Freshness = 0.20 * exp(-days_since_Date_Rated / 1095)
Vault_Rank = min(10, Base + Freshness)
```

When an IMDb score is missing, the prior rating is used for the Bayesian component. When `Date Rated` is missing/invalid, freshness bonus is zero. Vote count affects confidence, not a raw popularity bonus. This avoids ranking a title solely because it has more votes.

## Cloudflare Worker deployment

Follow [worker/README.md](worker/README.md). Keep all current D1 tables and Worker secrets/bindings. The v2 Worker intentionally reuses the existing database schema; it does not require dropping or recreating user/subscriber data.

Minimum GitHub token permissions for the import integration:

- Contents: Read and write (to read previous CSV and commit replacement CSV).
- Actions: Read and write (to dispatch `update-movies.yml`).

Minimum Cloudflare bindings/secrets expected by the Worker are listed in its README. Never place bot tokens, GitHub tokens, webhook secrets, or the worker ping secret in the repository.

## GitHub Actions permissions / secrets

Keep the existing repository secrets already used by the current deployment:

- `OMDB_API_KEYS` (preferred) and/or legacy `OMDB_API_KEY*` values.
- `WORKER_PING_SECRET` (must equal Worker secret `WORKER_PING_SECRET`).

The GitHub repository token used by Worker import must have `Contents: Read and write` and `Actions: Read and write`.

The repository's `GITHUB_TOKEN` permission for `update-movies.yml` remains `contents: write`, `pages: write`, and `id-token: write`. No GitHub token is exposed to the front-end.

## Manual verification checklist

1. Open `worker/README.md` and confirm the Cloudflare bindings match your existing Worker.
2. Deploy the Worker with Wrangler.
3. Manually run `IMDb Showcase — resilient data pipeline` once and wait for both data-pipeline jobs to succeed.
4. Confirm the run of `Trigger Cinema Vault Telegram Worker` was started by the `workflow_run` event.
5. Send `/top`, `/stats` and `/adminstatus` to the bot.
6. Upload a test CSV that includes at least one new ID and one changed rating/date, then inspect the import comparison message.
7. Confirm the website data changes only after the pipeline runs and that subscribers receive the new-title notification with its detected-at timestamp.

## GitHub Pages

Set the Pages build/deploy source to GitHub Actions (the included workflow deploys the `docs/` directory). Classic page: `/imdb-showcase/`. Advanced page: `/imdb-showcase/advanced/`.

## Preserve the existing poster cache

The attached RAR did not contain the local poster assets. The current GitHub `main` tree has 1,718 files in `docs/posters/`. Apply this source update as a merge over your existing repository and keep `docs/posters/` intact; the update bundle does not delete or replace those assets. See [UPDATE-INSTRUCTIONS-FA.md](UPDATE-INSTRUCTIONS-FA.md).
