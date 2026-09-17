# Production architecture / bug-fix notes

## Canonical data source

`docs/movies.json` is the only browser dataset. Classic and Advanced read the same file.

`docs/posters/` is the only canonical local poster cache. The browser resolves the same local poster path in both modes.

## Why the previous poster cache could fail

The old pipeline had several interacting failure modes:

1. The public workflow did not reliably pass the complete `OMDB_API_KEYS` secret to Python.
2. Local WebP validation used an unnecessarily high byte-size threshold, so a valid small WebP could be treated as missing.
3. Poster URLs were not consistently persisted as a reusable remote fallback.
4. Poster lookups could repeat too frequently when a local poster was still missing.
5. The HTTP retry adapter was mounted on a `requests.Session`, but OMDb calls bypassed that session.
6. The Advanced page could diverge from Classic because it was previously able to use a second dataset.

The production build addresses all six points.

## OMDb scheduling

The Action may run every 12 hours.

That does not mean every record is requested every 12 hours.

### New record

Fetch OMDb immediately.

### Incomplete record

Retry after the configured cooldown. Network failures use a shorter cooldown than generic incomplete/API failures.

### Complete record younger than 30 days

Use the repository snapshot. No OMDb call.

### Complete record at least 30 days old

Refresh once, then replace the cache only on a successful OMDb response.

### Refresh failure

Keep the previous successful snapshot.

### Poster-only recovery

Poster recovery is independent from OMDb enrichment. A missing poster does not invalidate a successful OMDb cache record.

## Key handling

Preferred secret:

`OMDB_API_KEYS`

Accepted formats include comma, semicolon, whitespace, newline, or JSON-array separated keys.

Compatibility variables:

- `OMDB_API_KEY`
- `OMDB_API_KEY_1`
- `OMDB_API_KEY_2`
- `OMDB_API_KEY_3`
- `OMDB_API_KEY_4`

The Action never prints the raw key. It prints only a 12-character SHA-256 fingerprint.

Each run also writes sanitized key statistics to `docs/omdb-key-state.json`.

## Health check

Run the workflow manually with `health_check=true`.

The Python script sends one known-title test request per discovered key and writes only diagnostic files.

No `movies.json` change is made during health-check mode.

## Diagnostic files

### `docs/system-status.json`

Latest status and latest run diagnostics.

### `docs/update-log.json`

Last 30 sanitized run reports.

### `docs/omdb-key-state.json`

Cumulative per-key request counters, daily counters, last health-check state, last error and short fingerprints.

These files are intentionally safe for GitHub Pages because raw API keys are not written.

## Advanced diagnostics UI

Advanced mode loads all three diagnostic files and shows:

- discovered key count
- current / last key status
- daily request count
- cumulative request count
- success / error state
- cache reuse count
- monthly refresh count
- poster attempts/downloads/misses
- latest sanitized errors

The Copy Diagnostic Report action copies the complete sanitized snapshot so it can be sent back for troubleshooting without exposing credentials.

## Repository poster cache

Every successful poster download is stored as:

`docs/posters/<imdb-id>.webp`

Poster lookup order in the browser:

1. local repository poster
2. persisted remote poster URL
3. legacy `poster` URL
4. classic fallback placeholder

The pipeline stores the poster path in `poster_local`.

## Performance

Classic renders only one page of cards at a time.

Advanced renders only one page of cards at a time, and Chart.js work is deferred until Analytics is opened.

Both pages use event delegation for dynamically rendered cards and pagination controls, so handlers do not need to be reattached after each render.

## Data preservation

The latest CSV row is merged over the previous record so user-owned CSV fields stay current.

Previously fetched OMDb payloads remain under `raw_omdb`.

The complete CSV row remains under `raw_csv`.

## Recovery rule

A malformed or partial update must never intentionally replace a valid, non-empty repository dataset with an empty dataset.
