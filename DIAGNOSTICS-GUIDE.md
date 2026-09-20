# Diagnostics guide

When a GitHub Action or poster update looks wrong:

1. Open **GitHub → Actions → IMDb Showcase — resilient data, posters and diagnostics**.
2. Run the workflow manually with `health_check=true`.
3. Open the Advanced site.
4. Scroll to **PIPELINE OBSERVABILITY**.
5. Click **📋 کپی گزارش**.
6. Send that sanitized report without sending any Secret values.

The report can show:

- how many OMDb keys were detected;
- safe key fingerprints;
- per-key status (`active`, `invalid`, `rate_limited`, `daily_budget_exhausted`, etc.);
- requests this run and today;
- cumulative success/error counters;
- records that used cache;
- records due for the monthly refresh;
- records waiting for the 24-hour retry window;
- posters downloaded/reused/missing;
- recent pipeline errors.

### Poster 404 diagnosis

If the browser requests `docs/posters/<id>.webp` and receives 404, the most important check is whether the GitHub Action committed the `docs/posters/` directory. The production workflow explicitly stages that directory.

The browser also tries the saved remote poster URL before showing the placeholder, so a missing local file does not permanently hide a usable remote poster.

### Secret safety

Never paste:

- `OMDB_API_KEYS`
- `OMDB_API_KEY`
- `OMDB_API_KEY_1..4`
- the raw `IMDB_COOKIES` value
