# IMDb Showcase — Classic + Advanced (Production Cache Build)

## Classic
`docs/index.html` preserves the original classic visual structure. Additive changes only:
- real pagination (12/24/36/48)
- Advanced-mode button
- bottom-only Site Insights module
- safer click handling and missing-data guards
- local poster path support

## Advanced
`docs/advanced/` is a separate interactive UI using the same `docs/movies.json` dataset.
It has a neon-mint `#21F1A8` + dark-gray `#171717` design system, responsive layouts, hover motion,
series/season/episode grouping, analytics, detailed modal, raw Dataset inspection and bottom Page Insights.

## Shared data
There is intentionally one data source:
`docs/movies.json`

Advanced reads it using `../movies.json`. There is no second Dataset in `docs/advanced/`.

## API/cache policy
The Action runs every 12 hours, but OMDb is not queried for every record every run.
- New records: query OMDb.
- Incomplete records: retry until enriched.
- Complete cached records younger than 30 days: use repository cache; no OMDb call.
- Records at least 30 days old: refresh from OMDb.
- If refresh fails, previous successful enrichment and poster are retained.
- Local posters are stored in `docs/posters/` and referenced by `poster_local`.
- The full CSV row is preserved under `raw_csv`; successful OMDb responses are preserved under `raw_omdb`.

## Secrets
Preferred:
`OMDB_API_KEYS` — comma/space/newline separated list of all keys.

Also accepted for compatibility:
`OMDB_API_KEY`, `OMDB_API_KEY_1` ... `OMDB_API_KEY_4`, `IMDB_COOKIES`.

Secrets are read only by GitHub Actions and are never written to `movies.json`.

## Page Insights
Classic and Advanced load `docs/page-insights.js` and use the current worker endpoint:
`https://github-page-insights-worker.game-developer-mb.workers.dev`
with site id `imdb-showcase`.
