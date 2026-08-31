IMDb Showcase V4

Replace the existing website/workflow files with these files.
Keep your existing src/ratings.csv and docs/pic/ unchanged.
Keep docs/movies.json initially; GitHub Actions will regenerate it.

Important V4 improvements:
- Pagination: only 12-48 cards are rendered at once.
- Latest watched section based on Date Rated.
- Full raw CSV row is preserved as raw_csv so extra export columns are not lost.
- Full raw dataset fields are shown in the title details modal.
- Offline/localStorage fallback remains available.
- Previous enriched data is preserved if OMDb fails.
- Per-title fallback posters are generated locally when no poster is available.
- Series are grouped into series -> seasons -> episodes.
- Runtime is displayed as hours and minutes.
- IMDb profile link is included in the header and footer.
