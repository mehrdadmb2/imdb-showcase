# Diagnostics guide

When the Action has a problem, do not send API keys.

Open:

1. GitHub → Actions → IMDb Showcase — resilient data pipeline
2. Run the workflow manually with `health_check=true`
3. Open the Advanced site
4. Scroll to `PIPELINE OBSERVABILITY`
5. Use `📋 کپی گزارش`

The report contains only sanitized fingerprints and counters.

Useful fields include:

- `keys_detected`
- per-key fingerprint
- per-key status
- `daily_requests`
- `total_requests`
- `total_success`
- `total_errors`
- `api_attempts`
- `omdb_success`
- `omdb_errors`
- `records_missing_enrichment`
- `records_in_retry_cooldown`
- `posters_downloaded`
- `posters_missing`
- latest error list

Never paste the contents of `OMDB_API_KEYS` or `OMDB_API_KEY`.
