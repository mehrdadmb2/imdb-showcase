# IMDb Showcase — Stable Classic + Advanced

This build keeps the classic site as the default experience and adds a separate Advanced mode under `docs/advanced/`.

## Data architecture

- `docs/movies.json` is the **single shared dataset** used by both Classic and Advanced.
- Advanced reads `../movies.json`; it does not maintain a second copy.
- `src/fetch_imdb.py` keeps enriched OMDb data inside `movies.json` as repository-persisted cache.
- `raw_csv` preserves the complete CSV row, including future/unknown columns.
- `raw_omdb` preserves the complete OMDb response for every successfully enriched title.
- `docs/posters/` stores successfully downloaded posters locally in WebP format.
- The browser falls back to a generated local SVG poster when no real poster is available.

## API policy

The GitHub Action runs daily so new/incomplete records can progressively complete. It **does not call OMDb for a complete record younger than 30 days**.

Existing records are refreshed only after their `cache_updated_at` is at least 30 days old. If OMDb or poster download fails, the last known good data is retained and marked `stale` instead of being erased.

This means a large library can finish enriching over multiple runs without repeatedly spending API requests on already cached titles.

## Secrets

Set either:

- `OMDB_API_KEY`
- or `OMDB_API_KEYS` as comma-separated keys

The keys are used only inside GitHub Actions and are never written into `movies.json`.

## Pages

Classic:

`/docs/`

Advanced:

`/docs/advanced/`

The Classic header contains the **Advanced mode** button.


Page Insights restored in both Classic and Advanced.
