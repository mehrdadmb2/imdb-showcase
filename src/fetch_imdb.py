"""Build a resilient public movies.json dataset from IMDb CSV + OMDb.

Design goals:
- Never expose API secrets in output JSON.
- Preserve the previous enriched record when OMDb fails.
- Preserve every CSV column under raw_csv, so new IMDb export fields are not lost.
- Preserve raw OMDb data under raw_omdb for future UI/analytics expansion.
- Write the dataset atomically only after a valid CSV has been parsed.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parent
DOCS = ROOT.parent / "docs"
CSV_PATH = ROOT / "ratings.csv"
OUTPUT_PATH = DOCS / "movies.json"

TIMEOUT = 15
MAX_PER_KEY = 1000
SLEEP_BETWEEN_REQUESTS = 0.10

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 IMDb-Showcase/6.0 "
            "(+https://github.com/mehrdadmb2/imdb-showcase)"
        )
    }
)


def log(message: str) -> None:
    print(message, flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean(value: Any) -> str:
    if value is None:
        return ""
    result = str(value).strip()
    return "" if not result or result.upper() == "N/A" else result


def number(value: Any, default: float = 0) -> float:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def read_previous() -> dict:
    if not OUTPUT_PATH.exists():
        return {"movies": [], "data_meta": {}}

    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"WARN: previous dataset could not be read: {exc}")
        return {"movies": [], "data_meta": {}}


def read_csv() -> list[dict]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Missing CSV: {CSV_PATH}")

    records: list[dict] = []

    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = [field.strip() for field in (reader.fieldnames or [])]
        required = {"Const", "Title", "Your Rating", "Date Rated"}
        missing = required - set(fields)

        if missing:
            raise ValueError(
                "Missing required IMDb CSV columns: "
                + ", ".join(sorted(missing))
            )

        for row in reader:
            raw_csv = {
                str(key).strip(): clean(value)
                for key, value in row.items()
                if key is not None
            }

            imdb_id = clean(raw_csv.get("Const"))
            if not imdb_id:
                continue

            record = {
                "imdb_id": imdb_id,
                "title": clean(raw_csv.get("Title")) or "Untitled",
                "original_title": clean(raw_csv.get("Original Title"))
                or clean(raw_csv.get("Title")),
                "year": clean(raw_csv.get("Year")),
                "user_rating": number(raw_csv.get("Your Rating")),
                "date_rated": clean(raw_csv.get("Date Rated")),
                "title_type": clean(raw_csv.get("Title Type")) or "Other",
                "imdb_rating": clean(raw_csv.get("IMDb Rating")),
                "runtime": clean(raw_csv.get("Runtime (mins)")),
                "genres": clean(raw_csv.get("Genres")),
                "num_votes": clean(raw_csv.get("Num Votes")),
                "release_date": clean(raw_csv.get("Release Date")),
                "directors": clean(raw_csv.get("Directors")),
                "url": clean(raw_csv.get("URL")),
                "raw_csv": raw_csv,
            }

            records.append(record)

    if not records:
        raise ValueError("IMDb CSV was parsed successfully but contains no records.")

    return records


def api_keys() -> list[str]:
    raw = (
        os.getenv("OMDB_API_KEYS", "").strip()
        or os.getenv("OMDB_API_KEY", "").strip()
    )
    keys = [key.strip() for key in raw.split(",") if key.strip()]
    if not keys:
        raise RuntimeError("OMDB_API_KEY or OMDB_API_KEYS is missing.")
    return keys


class KeyPool:
    def __init__(self, keys: list[str]) -> None:
        self.keys = keys
        self.index = 0
        self.usage = {key: 0 for key in keys}

    def next_key(self) -> str | None:
        for _ in self.keys:
            key = self.keys[self.index]
            self.index = (self.index + 1) % len(self.keys)
            if self.usage[key] < MAX_PER_KEY:
                return key
        return None


def fetch_omdb(imdb_id: str, pool: KeyPool) -> tuple[dict | None, str]:
    key = pool.next_key()
    if not key:
        return None, "key-limit"

    try:
        response = SESSION.get(
            "https://www.omdbapi.com/",
            params={"i": imdb_id, "apikey": key, "plot": "full"},
            timeout=TIMEOUT,
        )
        pool.usage[key] += 1

        if response.status_code != 200:
            return None, f"http-{response.status_code}"

        data = response.json()
        if data.get("Response") == "True":
            return data, "ok"

        return None, clean(data.get("Error")) or "omdb-failed"

    except (requests.RequestException, ValueError) as exc:
        pool.usage[key] += 1
        return None, str(exc)


def merge_non_empty(base: dict, incoming: dict) -> dict:
    result = deepcopy(base)
    for key, value in incoming.items():
        if value in ("", None, [], {}):
            continue
        result[key] = value
    return result


def series_fields(omdb: dict, csv_record: dict) -> dict:
    is_episode = (
        csv_record.get("title_type") == "TV Episode"
        or bool(omdb.get("Episode"))
    )

    return {
        "series_id": clean(omdb.get("seriesID")),
        "series_title": clean(omdb.get("series")),
        "season_number": int(number(omdb.get("Season"), 0)),
        "episode_number": int(number(omdb.get("Episode"), 0)),
        "episode_title": clean(omdb.get("Title"))
        or csv_record.get("title", ""),
        "total_seasons": int(number(omdb.get("totalSeasons"), 0)),
        "total_episodes": 0,
        "is_episode": is_episode,
    }


def build_record(
    csv_record: dict,
    previous: dict | None,
    omdb: dict | None,
    status: str,
) -> tuple[dict, str]:
    record = deepcopy(previous) if previous else {}

    # CSV is authoritative for fields that are user-exported.
    record.update(csv_record)
    record["raw_csv"] = csv_record.get("raw_csv", {})

    if omdb:
        mapped = {
            "poster": clean(omdb.get("Poster")),
            "plot": clean(omdb.get("Plot")),
            "rated": clean(omdb.get("Rated")),
            "actors": clean(omdb.get("Actors")),
            "writer": clean(omdb.get("Writer")),
            "country": clean(omdb.get("Country")),
            "language": clean(omdb.get("Language")),
            "awards": clean(omdb.get("Awards")),
            "box_office": clean(omdb.get("BoxOffice")),
            "production": clean(omdb.get("Production")),
            "website": clean(omdb.get("Website")),
            "metascore": clean(omdb.get("Metascore")),
            "ratings": omdb.get("Ratings") if isinstance(omdb.get("Ratings"), list) else [],
            "data_fetched_at": utc_now(),
            "raw_omdb": omdb,
        }

        record = merge_non_empty(record, mapped)

        fallbacks = {
            "imdb_rating": "imdbRating",
            "num_votes": "imdbVotes",
            "runtime": "Runtime",
            "directors": "Director",
            "genres": "Genre",
            "release_date": "Released",
        }

        for target, source in fallbacks.items():
            if not clean(record.get(target)):
                record[target] = clean(omdb.get(source))

        record.update(series_fields(omdb, csv_record))
        record.update(
            {
                "omdb_found": True,
                "data_status": "fresh",
                "data_stale_reason": "",
                "fields_fresh": [
                    "omdb",
                    "poster",
                    "plot",
                    "ratings",
                    "series",
                ],
            }
        )
        return record, "fresh"

    if previous:
        # Keep previous enriched fields. Only the CSV-controlled fields update.
        record.update(
            {
                "omdb_found": False,
                "data_status": "stale",
                "data_stale_reason": status,
                "fields_fresh": ["csv"],
                "data_fetched_at": clean(previous.get("data_fetched_at")),
                "raw_omdb": previous.get("raw_omdb", {}),
            }
        )
        return record, "stale"

    record.update(
        {
            "poster": "",
            "plot": "",
            "rated": "",
            "actors": "",
            "writer": "",
            "country": "",
            "language": "",
            "awards": "",
            "box_office": "",
            "production": "",
            "website": "",
            "metascore": "",
            "ratings": [],
            "raw_omdb": {},
            "is_episode": csv_record.get("title_type") == "TV Episode",
            "series_id": "",
            "series_title": "",
            "season_number": 0,
            "episode_number": 0,
            "episode_title": csv_record.get("title", ""),
            "total_seasons": 0,
            "total_episodes": 0,
            "data_status": "partial",
            "data_stale_reason": status,
            "data_fetched_at": "",
            "fields_fresh": ["csv"],
            "omdb_found": False,
        }
    )
    return record, "partial"


def fill_episode_totals(records: list[dict]) -> list[dict]:
    totals: dict[str, int] = {}

    for record in records:
        key = record.get("series_id") or record.get("series_title")
        if key and record.get("is_episode"):
            totals[key] = totals.get(key, 0) + 1

    for record in records:
        key = record.get("series_id") or record.get("series_title")
        if key:
            record["total_episodes"] = totals.get(key, 0)

    return records


def atomic_write(payload: dict) -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT_PATH.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp.replace(OUTPUT_PATH)


def main() -> None:
    log("Starting resilient IMDb Showcase data build...")

    previous = read_previous()
    previous_index = {
        movie.get("imdb_id"): movie
        for movie in previous.get("movies", [])
        if movie.get("imdb_id")
    }

    csv_records = read_csv()
    keys = api_keys()
    pool = KeyPool(keys)

    output: list[dict] = []
    fresh = stale = partial = 0
    errors: list[dict] = []

    for index, csv_record in enumerate(csv_records, 1):
        imdb_id = csv_record["imdb_id"]
        log(f"[{index}/{len(csv_records)}] {csv_record['title']}")

        omdb, status = fetch_omdb(imdb_id, pool)
        record, state = build_record(
            csv_record,
            previous_index.get(imdb_id),
            omdb,
            status,
        )
        output.append(record)

        if state == "fresh":
            fresh += 1
        elif state == "stale":
            stale += 1
        else:
            partial += 1

        if not omdb:
            errors.append(
                {
                    "imdb_id": imdb_id,
                    "title": csv_record["title"],
                    "reason": status,
                }
            )

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    output = fill_episode_totals(output)
    generated = utc_now()

    payload = {
        "schema_version": 3,
        "last_manual_update": generated,
        "data_meta": {
            "generated_at": generated,
            "source_csv_records": len(csv_records),
            "updated_records": len(output),
            "omdb_success": fresh,
            "omdb_stale": stale,
            "omdb_partial": partial,
            "api_errors": len(errors),
            "key_count": len(pool.keys),
            "key_usage_total": sum(pool.usage.values()),
            "previous_data_available": bool(previous_index),
            "raw_csv_preserved": True,
            "raw_omdb_preserved": True,
            "failure_policy": "keep_previous_enriched_fields_on_partial_failure",
        },
        "movies": output,
        "errors": errors[:250],
    }

    # Sanity check before touching the public dataset.
    if not payload["movies"]:
        raise RuntimeError("Refusing to write an empty public dataset.")

    atomic_write(payload)

    log(
        f"OK fresh={fresh} stale={stale} partial={partial} "
        f"errors={len(errors)} records={len(output)}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log(
            "Update aborted. Previous movies.json was not modified: "
            f"{exc}"
        )
        sys.exit(1)
