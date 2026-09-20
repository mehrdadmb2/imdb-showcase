# Production Architecture V11

## Request budget
The safety budget is **tracked across workflow runs** using `docs/omdb-key-state.json`. With a 950/day budget per key, two scheduled runs cannot accidentally spend 950 twice in the same UTC day.

## Poster persistence
Poster binaries are written to `docs/posters/` and included in `git add`. This fixes the recurring `404 /posters/*.webp` issue caused by committing only `movies.json`.

## Failure semantics
The update pipeline writes the new `movies.json` only after every CSV row has produced an output record. A complete previous snapshot is preserved on API failure. Local posters are treated as a separate resource and can be repaired without an OMDb request.
