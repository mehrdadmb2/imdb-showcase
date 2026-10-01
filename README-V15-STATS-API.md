# IMDb Showcase V15 — Classic header statistics + Page Insights v11

This package is a drop-in update built from the current IMDb Showcase production tree.

## Classic header

Only the top summary counters were adjusted:

- TOTAL TITLES
- MOVIES
- SERIES
- EPISODES
- HOURS
- AVG RATING
- GENRES

Runtime in the header is integer hours only. Detailed runtime formatting in title modals is unchanged.

## Page Insights

The shared client now targets the current Page Insights v11 API first:

- `POST /v1/events`
- `GET /v1/platforms/imdb-showcase?days=3650`

The legacy `/collect` and `/api/site/...` endpoints remain as a fail-soft fallback.

The Classic and Advanced pages continue using the same worker and `siteId/platformId` (`imdb-showcase`).

## Files intentionally changed

- `docs/index.html`
- `docs/script.js`
- `docs/style.css`
- `docs/page-insights.js`

Everything else comes from the existing production package.
