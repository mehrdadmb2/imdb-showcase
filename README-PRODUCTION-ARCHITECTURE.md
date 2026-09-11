# IMDb Showcase — production architecture

- Classic mode keeps the original visual structure and behavior.
- Advanced mode is a separate route: `/advanced/`.
- Both modes read the same `docs/movies.json`.
- Repository cache is persistent and survives future runs.
- OMDb records are refreshed only when the cache is older than 30 days or incomplete/new.
- Existing good data is preserved when OMDb fails.
- Four separate secrets are supported: `OMDB_API_KEY_1` … `OMDB_API_KEY_4`.
- A combined `OMDB_API_KEYS` secret and legacy `OMDB_API_KEY` are also supported.
- Local poster files are stored under `docs/posters/` as WebP and preferred by both site modes.
- The browser falls back to the original classic poster placeholder when no real/local poster exists.
- Page Insights uses the current `github-page-insights` Worker and `siteId=imdb-showcase`.
- Visitor analytics is intentionally compact and appears at the bottom of both site modes.
