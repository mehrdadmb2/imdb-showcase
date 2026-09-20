# IMDb Showcase — Production V12

This package keeps the Classic site visually anchored to the original project while making the data pipeline, poster handling, pagination, diagnostics, and Advanced mode substantially more resilient.

## Shared data model

- One source of truth: `docs/movies.json`.
- Advanced mode reads `../movies.json`; there is no second dataset.
- Repository poster cache: `docs/posters/<IMDb-ID>.webp`.
- `raw_csv` preserves the complete IMDb CSV row.
- `raw_omdb` preserves the successful OMDb response.

## OMDb policy

- `OMDB_API_KEYS` is preferred. It accepts comma, semicolon, pipe, whitespace/newline separated keys and JSON arrays.
- `OMDB_API_KEY_1..4` and `OMDB_API_KEY` are accepted as compatibility fallbacks.
- Four keys are rotated automatically; invalid and rate-limited keys are disabled for the current run.
- A persistent `docs/omdb-key-state.json` tracks daily usage by safe fingerprint so scheduled workflow runs share one daily budget.
- The safety budget is 950 requests per key per UTC day, below OMDb's stated 1,000/day free-tier limit.
- Complete records younger than 30 days are served entirely from repository cache.
- Complete records at/over 30 days are eligible for monthly refresh.
- New or incomplete records are retried at most once per 24 hours until enriched.
- A failed refresh never erases the last successful metadata snapshot.

## Poster policy

- A successful OMDb poster URL is downloaded into `docs/posters/` as WebP.
- Poster downloads use retries, redirect support, browser-like headers, image validation, EXIF correction, and bounded dimensions.
- Missing/corrupt local posters are repaired without consuming OMDb metadata quota.
- If the OMDb poster URL is missing or unreachable, IMDb page metadata is attempted as a separate fallback, using `IMDB_COOKIES` only when needed.
- Classic and Advanced both read the same repository-local poster file first, then fall back to the remote URL, then to the built-in visual placeholder.

## GitHub Actions

The workflow runs every 12 hours for lightweight maintenance, but it does **not** call OMDb for every record every run. Metadata is refreshed only when required by the cache policy. Poster recovery is handled independently.

The workflow commits:

- `docs/movies.json`
- `docs/posters/`
- `docs/system-status.json`
- `docs/omdb-key-state.json`
- `docs/update-log.json`

Manual inputs:

- `health_check=true` tests the configured keys and writes diagnostics.
- `force_refresh=true` makes eligible records attempt a refresh subject to the daily safety budget.

## Diagnostics

Advanced mode exposes a production diagnostics panel showing key fingerprints, status, daily/total request counters, cache reuse, monthly refresh counts, poster attempts/downloads/misses, and recent errors.

Use the `Copy report` button and send that report for troubleshooting. Never send the actual API keys or raw cookie value.
