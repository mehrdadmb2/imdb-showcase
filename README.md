# IMDb Showcase — Classic + Advanced / V10 Production Build

This build keeps the Classic visual baseline from the original project and adds only functional layers:

- working pagination (12 / 24 / 36 / 48 cards per page)
- reliable card-to-detail-modal interaction
- bottom-only Page Insights
- Advanced-mode link
- hardened missing/null data handling

The Advanced site is a separate UI at `docs/advanced/` and reads the exact same `docs/movies.json` and `docs/posters/` used by Classic.

## Data architecture

There is one canonical browser dataset:

```text
docs/movies.json
      ├── docs/index.html
      └── docs/advanced/index.html
```

Local posters are stored at:

```text
docs/posters/<imdb-id>.webp
```

Successful CSV and OMDb payloads are preserved in each record using `raw_csv` and `raw_omdb`.

## OMDb cache policy

The GitHub Action runs every 12 hours so new/missing items can be discovered without requiring a manual run.

A complete record younger than 30 days is reused from repository cache and does not call OMDb.

New or incomplete records are retried with a cooldown.

A complete record is refreshed when it is at least 30 days old, or when the `force_refresh` workflow input is intentionally enabled.

A failed refresh never intentionally replaces the last known good snapshot with empty data.

The built-in daily request budget is 980 calls per discovered key, leaving a safety margin below OMDb's published 1,000-request daily free limit.

## Secrets

Preferred repository secret:

```text
OMDB_API_KEYS
```

It may contain all keys separated by commas, spaces, semicolons or newlines, or as a JSON array.

Compatibility names are also accepted:

```text
OMDB_API_KEY
OMDB_API_KEY_1
OMDB_API_KEY_2
OMDB_API_KEY_3
OMDB_API_KEY_4
IMDB_COOKIES
```

Secret values are never written to repository files. Diagnostics use short SHA-256 fingerprints instead.

## Health check

Open GitHub Actions and run the workflow manually with:

```text
health_check = true
```

The health check makes exactly one OMDb test request per discovered key and writes sanitized diagnostics to:

```text
docs/system-status.json
docs/omdb-key-state.json
docs/update-log.json
```

The Advanced page displays these diagnostics, including:

- detected key count
- per-key fingerprint
- last status
- daily and cumulative request counts
- success/error counts
- rate-limit / invalid states
- cache and poster statistics
- latest errors

No raw API key is displayed.

## Poster recovery

The pipeline first reuses an existing local poster.

When a poster is missing, it uses the saved remote poster URL or attempts an IMDb poster lookup (when available). The recovered image is converted to WebP and stored in `docs/posters/`.

Poster retry is independent from OMDb enrichment, so a missing poster does not cause an already-enriched title to consume OMDb requests again.

## GitHub Pages

The default page is:

```text
/docs/index.html
```

Advanced mode:

```text
/docs/advanced/index.html
```

Page Insights are loaded from the shared `github-page-insights` Worker configured inside `docs/page-insights.js`.

## Deployment recommendation

1. Keep your existing `src/ratings.csv` and `docs/pic/`.
2. Merge the files from this build.
3. Run the workflow once manually.
4. First use `health_check = true` to inspect the key diagnostics.
5. Then run the normal update.
6. Inspect the Advanced → Diagnostics section after the run.
