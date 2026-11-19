# Cinema Vault v2.0.1 — ranking & CSV import

## Vault Rank

The site and Telegram Worker share one ranking formula:

1. IMDb score is Bayesian-adjusted with a prior of 6.5/10 and 1,000 prior votes:
   `adjustedIMDb = (votes / (votes + 1000)) × IMDb + (1000 / (votes + 1000)) × 6.5`
2. Base score: `0.65 × personal rating + 0.35 × adjustedIMDb`.
3. Recency bonus: `0.20 × exp(-daysSinceDateRated / 1095)`, only for rated titles.
4. Final rank is clamped to 0–10. On ties, the list prefers higher IMDb vote count, then newer rating date.

The 1,000-vote prior prevents a title with a tiny vote sample from being treated as equally reliable as a widely rated title. This is a ranking heuristic for the personal library, not an official IMDb score or a claim about film quality. If IMDb rating is absent, the prior 6.5 is used.

## CSV import lifecycle

`/import` validates the uploaded IMDb CSV, reads the previous `src/ratings.csv` from GitHub, compares records by IMDb `Const`, writes the new CSV, and dispatches `update-movies.yml`. The import response reports valid records, previous/current totals, added/removed/modified/unchanged titles, and changes to personal rating, rating date, IMDb score, vote count and metadata (including title, URL, year, type, genre and runtime). Long reports are sent as multiple Telegram messages rather than being cut at Telegram's message limit.

After the data workflow succeeds, `.github/workflows/ping-telegram-worker.yml` is triggered by `workflow_run` and calls the protected Worker scheduler. Its half-hour schedule remains as a recovery path. New-title alert timestamps use the queue's `created_at` and are displayed in the `Asia/Tehran` timezone; this is detection time, not the IMDb `Date Rated` value.

## Before deployment

- Keep GitHub Pages source as the `docs` directory and preserve all existing Pages/workflow configuration.
- Keep the existing D1 database binding named `DB`; never replace the production database ID with a new one.
- Confirm the GitHub token used by the Worker has Contents read/write and Actions read/write on this repository.
- Set the same `WORKER_PING_SECRET` in Cloudflare Worker secrets and GitHub Actions repository secrets.
- Keep the deployed Worker hostname and Telegram webhook secret unchanged unless the webhook setup is also updated.
