from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import re
import sys
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DOCS = ROOT / "docs"
CSV_PATH = SRC / "ratings.csv"
DATA_PATH = DOCS / "movies.json"
POSTER_DIR = DOCS / "posters"

CACHE_TTL_DAYS = int(os.getenv("CACHE_TTL_DAYS", "30"))
HTTP_TIMEOUT = (8, 25)
MAX_PER_KEY = 1000
SLEEP_BETWEEN_API_CALLS = 0.08


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or now_utc()).isoformat()


def log(message: str) -> None:
    print(message, flush=True)


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.upper() == "N/A":
        return ""
    return text


def number(value: Any, default: float = 0) -> float:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def parse_date(value: str) -> datetime | None:
    value = clean(value)
    if not value:
        return None
    candidates = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%Y/%m/%d",
    ]
    for fmt in candidates:
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            pass
    return None


def request_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=16)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(
        {
            "User-Agent": "IMDb-Showcase/4.0 (+https://github.com/mehrdadmb2/imdb-showcase)",
            "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        }
    )
    return session


HTTP = request_session()


def load_keys() -> list[str]:
    keys: list[str] = []

    combined = os.getenv("OMDB_API_KEYS", "").strip()
    if combined:
        keys.extend(part.strip() for part in combined.split(",") if part.strip())

    for name in (
        "OMDB_API_KEY_1",
        "OMDB_API_KEY_2",
        "OMDB_API_KEY_3",
        "OMDB_API_KEY_4",
    ):
        value = os.getenv(name, "").strip()
        if value:
            keys.append(value)

    legacy = os.getenv("OMDB_API_KEY", "").strip()
    if legacy:
        keys.append(legacy)

    return list(dict.fromkeys(keys))


class KeyPool:
    def __init__(self, keys: list[str]):
        self.keys = keys
        self.index = 0
        self.usage = {key: 0 for key in keys}

    def next(self) -> str | None:
        if not self.keys:
            return None
        for _ in range(len(self.keys)):
            key = self.keys[self.index]
            self.index = (self.index + 1) % len(self.keys)
            if self.usage[key] < MAX_PER_KEY:
                return key
        return None

    def mark_used(self, key: str) -> None:
        self.usage[key] = self.usage.get(key, 0) + 1


def load_previous() -> dict:
    if not DATA_PATH.exists():
        return {"schema_version": 4, "movies": [], "data_meta": {}}
    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception as exc:
        log(f"⚠️ previous movies.json could not be read: {exc}")
    return {"schema_version": 4, "movies": [], "data_meta": {}}


def read_csv() -> list[dict[str, Any]]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Missing {CSV_PATH}")
    rows: list[dict[str, Any]] = []
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError("ratings.csv has no header")
        if "Const" not in reader.fieldnames or "Title" not in reader.fieldnames:
            raise ValueError("ratings.csv must contain at least Const and Title")
        for raw in reader:
            normalized = {str(k): (v or "").strip() for k, v in raw.items()}
            imdb_id = clean(normalized.get("Const"))
            if not imdb_id:
                continue
            normalized["Const"] = imdb_id
            rows.append(normalized)
    if not rows:
        raise ValueError("ratings.csv contains no valid title rows")
    return rows


def date_rated_from_csv(raw: str) -> str:
    raw = clean(raw)
    if not raw:
        return ""
    dt = parse_date(raw)
    return dt.strftime("%Y-%m-%d") if dt else raw


def base_record(row: dict[str, Any]) -> dict[str, Any]:
    def c(key: str) -> str:
        return clean(row.get(key))

    return {
        "imdb_id": c("Const"),
        "title": c("Title") or "Untitled",
        "original_title": c("Original Title") or c("Title") or "Untitled",
        "url": c("URL"),
        "title_type": c("Title Type") or "Other",
        "imdb_rating": c("IMDb Rating"),
        "runtime": c("Runtime (mins)"),
        "year": c("Year"),
        "genres": c("Genres"),
        "num_votes": c("Num Votes"),
        "release_date": c("Release Date"),
        "directors": c("Directors"),
        "user_rating": number(row.get("Your Rating"), 0),
        "date_rated": date_rated_from_csv(row.get("Date Rated", "")),
        "poster": "",
        "poster_local": "",
        "poster_source": "none",
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
        "omdb_found": False,
        "raw_csv": deepcopy(row),
        "raw_omdb": {},
        "series_id": "",
        "series_title": "",
        "season_number": 0,
        "episode_number": 0,
        "episode_title": "",
        "total_seasons": 0,
        "total_episodes": 0,
        "is_episode": c("Title Type") == "TV Episode",
        "cache_status": "new",
        "cache_updated_at": "",
        "cache_checked_at": "",
        "poster_cached_at": "",
        "data_stale_reason": "",
    }


def is_fully_cached(record: dict[str, Any]) -> bool:
    status = clean(record.get("cache_status"))
    has_core = any(clean(record.get(key)) for key in ("plot", "actors", "writer", "runtime", "imdb_rating"))
    poster_ok = bool(clean(record.get("poster_local"))) or status in {"cached", "fresh"} and clean(record.get("poster_source")) == "fallback"
    return bool(record.get("cache_updated_at")) and has_core and poster_ok


def cache_due(record: dict[str, Any], now: datetime) -> bool:
    updated = parse_date(record.get("cache_updated_at", ""))
    if not updated:
        return True
    return now - updated >= timedelta(days=CACHE_TTL_DAYS)


def extract_series(omdb: dict, row: dict[str, Any]) -> dict[str, Any]:
    title_type = clean(row.get("Title Type"))
    is_episode = title_type == "TV Episode" or bool(clean(omdb.get("Episode")))
    return {
        "series_id": clean(omdb.get("seriesID")),
        "series_title": clean(omdb.get("series")),
        "season_number": int(number(omdb.get("Season"), 0)),
        "episode_number": int(number(omdb.get("Episode"), 0)),
        "episode_title": clean(omdb.get("Title")) or clean(row.get("Title")),
        "total_seasons": int(number(omdb.get("totalSeasons"), 0)),
        "is_episode": is_episode,
    }


def merge_non_empty(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(old)
    for key, value in new.items():
        if value in (None, "", [], {}):
            continue
        result[key] = value
    return result


def safe_extension(content_type: str, source_url: str) -> str:
    content_type = (content_type or "").split(";")[0].lower()
    ext = mimetypes.guess_extension(content_type) or ""
    if ext in {".jpe", ".jpeg"}:
        return ".jpg"
    if ext in {".png", ".webp", ".jpg", ".gif"}:
        return ext
    path_ext = Path(urlparse(source_url).path).suffix.lower()
    return path_ext if path_ext in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"


def download_poster(imdb_id: str, url: str, preserve_existing: str = "") -> tuple[str, bool]:
    if not url or url.upper() == "N/A":
        return preserve_existing, False

    try:
        response = HTTP.get(url, timeout=HTTP_TIMEOUT, allow_redirects=True)
        response.raise_for_status()
        content = response.content
        if len(content) < 2_000:
            return preserve_existing, False

        POSTER_DIR.mkdir(parents=True, exist_ok=True)
        temp = POSTER_DIR / f".{imdb_id}.download"
        temp.write_bytes(content)

        with Image.open(temp) as image:
            image = image.convert("RGB")
            image.thumbnail((700, 1050), Image.Resampling.LANCZOS)
            target = POSTER_DIR / f"{imdb_id}.webp"
            temp_out = POSTER_DIR / f".{imdb_id}.webp.tmp"
            image.save(temp_out, "WEBP", quality=84, method=6)
            temp_out.replace(target)

        temp.unlink(missing_ok=True)
        return f"posters/{imdb_id}.webp", True

    except Exception as exc:
        log(f"   ⚠️ poster download failed for {imdb_id}: {exc}")
        return preserve_existing, False


def imdb_fallback_poster_url(imdb_id: str) -> str:
    return f"https://www.imdb.com/title/{imdb_id}/"


def fetch_imdb_poster_url(imdb_id: str) -> str:
    try:
        response = HTTP.get(imdb_fallback_poster_url(imdb_id), timeout=HTTP_TIMEOUT)
        if response.status_code != 200:
            return ""
        soup = BeautifulSoup(response.text, "html.parser")
        tag = soup.find("meta", property="og:image")
        return clean(tag.get("content")) if tag else ""
    except Exception:
        return ""


def local_poster_path(relative_path: str) -> Path:
    relative = clean(relative_path).replace("\\", "/").lstrip("/")
    return DOCS / relative


def local_poster_exists(relative_path: str) -> bool:
    return bool(relative_path) and local_poster_path(relative_path).is_file()


def record_poster_url(record: dict[str, Any]) -> str:
    raw = record.get("raw_omdb") or {}
    if isinstance(raw, dict):
        raw_url = clean(raw.get("Poster"))
        if raw_url and raw_url.upper() != "N/A":
            return raw_url
    url = clean(record.get("poster"))
    if url and url.upper() != "N/A":
        return url
    return ""


def repair_missing_posters(records: list[dict[str, Any]]) -> int:
    repaired = 0
    POSTER_DIR.mkdir(parents=True, exist_ok=True)

    for record in records:
        iid = clean(record.get("imdb_id"))
        if not iid:
            continue

        local = clean(record.get("poster_local"))
        if local_poster_exists(local):
            continue

        url = record_poster_url(record)
        if not url:
            url = fetch_imdb_poster_url(iid)

        downloaded_path, ok = download_poster(iid, url, preserve_existing="")

        if ok:
            record["poster_local"] = downloaded_path
            record["poster_source"] = "local-cache"
            record["poster_cached_at"] = iso()
            repaired += 1
        else:
            # Never keep a broken local reference in JSON.
            if local and not local_poster_exists(local):
                record["poster_local"] = ""
            if clean(record.get("poster")):
                record["poster_source"] = "remote-fallback"
            else:
                record["poster_source"] = "fallback"

    return repaired


def fetch_omdb(imdb_id: str, pool: KeyPool) -> tuple[dict[str, Any] | None, str]:
    key = pool.next()
    if not key:
        return None, "api-key-limit-or-unavailable"

    params = {"i": imdb_id, "apikey": key, "plot": "full"}

    try:
        response = HTTP.get(
            "https://www.omdbapi.com/",
            params=params,
            timeout=HTTP_TIMEOUT,
        )
        pool.mark_used(key)
        if response.status_code != 200:
            return None, f"http-{response.status_code}"
        payload = response.json()
        if payload.get("Response") == "True":
            return payload, "ok"
        return None, clean(payload.get("Error")) or "omdb-failed"
    except Exception as exc:
        pool.mark_used(key)
        return None, f"request-error:{exc.__class__.__name__}"


def enrich_from_omdb(record: dict[str, Any], omdb: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    old_local = clean(record.get("poster_local"))
    old_remote = clean(record.get("poster"))

    additions = {
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
        "num_votes": clean(omdb.get("imdbVotes")) or record.get("num_votes", ""),
        "imdb_rating": clean(omdb.get("imdbRating")) or record.get("imdb_rating", ""),
        "runtime": clean(omdb.get("Runtime")) or record.get("runtime", ""),
        "directors": clean(omdb.get("Director")) or record.get("directors", ""),
        "genres": clean(omdb.get("Genre")) or record.get("genres", ""),
        "release_date": clean(omdb.get("Released")) or record.get("release_date", ""),
    }

    result = merge_non_empty(record, additions)
    result.update(extract_series(omdb, result.get("raw_csv", {})))
    result["raw_omdb"] = deepcopy(omdb)
    result["omdb_found"] = True
    result["data_stale_reason"] = ""

    poster_url = clean(additions.get("poster"))
    local, downloaded = download_poster(
        result["imdb_id"],
        poster_url if poster_url else fetch_imdb_poster_url(result["imdb_id"]),
        preserve_existing=old_local,
    )

    if local:
        result["poster_local"] = local
        result["poster_source"] = "local-cache"
        if downloaded:
            result["poster_cached_at"] = iso()
    elif old_local:
        result["poster_local"] = old_local
        result["poster_source"] = "local-cache"
    elif old_remote and poster_url == old_remote:
        result["poster"] = old_remote
        result["poster_source"] = "legacy-remote"
    elif poster_url:
        # A real poster URL existed, but downloading it failed. Keep the URL as a secondary fallback
        # and allow the record to be retried on the next workflow run instead of freezing the failure.
        result["poster"] = poster_url
        result["poster_source"] = "poster-download-failed"
    else:
        result["poster_source"] = "fallback"

    return result, downloaded


def process_record(
    row: dict[str, Any],
    previous: dict[str, Any] | None,
    pool: KeyPool,
    now: datetime,
) -> tuple[dict[str, Any], str]:

    current = base_record(row)
    if previous:
        current = merge_non_empty(previous, current)
        # raw CSV always reflects the current export.
        current["raw_csv"] = deepcopy(row)

    current["cache_checked_at"] = iso(now)

    # Existing complete record within TTL: do not touch OMDb.
    if previous and is_fully_cached(previous) and not cache_due(previous, now):
        current["cache_status"] = "cached"
        current["cache_updated_at"] = previous.get("cache_updated_at", "")
        current["poster_cached_at"] = previous.get("poster_cached_at", "")
        current["omdb_found"] = bool(previous.get("omdb_found"))
        current["poster_local"] = clean(previous.get("poster_local"))
        current["poster_source"] = previous.get("poster_source", "local-cache")
        current["raw_omdb"] = deepcopy(previous.get("raw_omdb") or {})
        return current, "cache"

    omdb, status = fetch_omdb(current["imdb_id"], pool)

    if omdb:
        enriched, _ = enrich_from_omdb(current, omdb)
        enriched["cache_status"] = "fresh"
        enriched["cache_updated_at"] = iso(now)
        return enriched, "fresh"

    # API failed: retain previous enriched fields and local poster.
    if previous:
        current = deepcopy(previous)
        current.update({
            "user_rating": number(row.get("Your Rating"), 0),
            "date_rated": date_rated_from_csv(row.get("Date Rated", "")),
            "raw_csv": deepcopy(row),
            "title": clean(row.get("Title")) or previous.get("title", "Untitled"),
            "original_title": clean(row.get("Original Title")) or previous.get("original_title", ""),
            "url": clean(row.get("URL")) or previous.get("url", ""),
            "title_type": clean(row.get("Title Type")) or previous.get("title_type", "Other"),
            "year": clean(row.get("Year")) or previous.get("year", ""),
            "genres": clean(row.get("Genres")) or previous.get("genres", ""),
            "runtime": clean(row.get("Runtime (mins)")) or previous.get("runtime", ""),
            "imdb_rating": clean(row.get("IMDb Rating")) or previous.get("imdb_rating", ""),
            "num_votes": clean(row.get("Num Votes")) or previous.get("num_votes", ""),
            "release_date": clean(row.get("Release Date")) or previous.get("release_date", ""),
            "directors": clean(row.get("Directors")) or previous.get("directors", ""),
            "cache_status": "stale",
            "cache_checked_at": iso(now),
            "data_stale_reason": status,
        })
        return current, "stale"

    # New title without API data: retain CSV data and mark partial.
    current["cache_status"] = "partial"
    current["data_stale_reason"] = status
    return current, "partial"


def count_episode_totals(records: list[dict[str, Any]]) -> None:
    totals: dict[str, int] = {}
    for record in records:
        sid = clean(record.get("series_id")) or clean(record.get("series_title"))
        if sid and record.get("is_episode"):
            totals[sid] = totals.get(sid, 0) + 1
    for record in records:
        sid = clean(record.get("series_id")) or clean(record.get("series_title"))
        if sid:
            record["total_episodes"] = totals.get(sid, 0)


def safe_write(payload: dict[str, Any]) -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    temp = DATA_PATH.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp.replace(DATA_PATH)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repair-posters",
        action="store_true",
        help="Repair missing local poster files from cached poster URLs without querying OMDb."
    )
    args = parser.parse_args()

    if args.repair_posters:
        previous = load_previous()
        movies = previous.get("movies", [])
        if not isinstance(movies, list) or not movies:
            log("⚠️ No existing dataset available for poster repair.")
            return 0
        repaired = repair_missing_posters(movies)
        previous["movies"] = movies
        safe_write(previous)
        log(f"🖼️ Local poster repair complete: repaired={repaired}")
        return 0

    log("🚀 IMDb Showcase resilient repository cache updater")

    try:
        rows = read_csv()
    except Exception as exc:
        log(f"❌ CSV validation failed. Existing dataset will be preserved: {exc}")
        return 1

    previous = load_previous()
    previous_index = {
        clean(item.get("imdb_id")): item
        for item in previous.get("movies", [])
        if clean(item.get("imdb_id"))
    }

    keys = load_keys()
    if keys:
        log(f"✅ OMDb keys available: {len(keys)}")
    else:
        log("⚠️ No OMDb key available. Cached/CSV data will still be published safely.")

    pool = KeyPool(keys)
    now = now_utc()

    output: list[dict[str, Any]] = []
    counts = {"fresh": 0, "cache": 0, "stale": 0, "partial": 0}

    for idx, row in enumerate(rows, 1):
        iid = clean(row.get("Const"))
        title = clean(row.get("Title")) or "Untitled"
        log(f"[{idx}/{len(rows)}] {title} ({iid})")

        record, state = process_record(
            row,
            previous_index.get(iid),
            pool,
            now,
        )
        output.append(record)
        counts[state] = counts.get(state, 0) + 1

        if state in {"fresh", "stale", "partial"}:
            time.sleep(SLEEP_BETWEEN_API_CALLS)

    count_episode_totals(output)

    payload = {
        "schema_version": 4,
        "cache_policy": {
            "ttl_days": CACHE_TTL_DAYS,
            "mode": "repository-persistent",
            "api_policy": "new-titles-or-expired-records-only",
            "failure_policy": "preserve-last-known-good-data",
            "poster_policy": "local-first",
        },
        "last_manual_update": iso(now),
        "data_meta": {
            "source_csv_records": len(rows),
            "output_records": len(output),
            "fresh": counts.get("fresh", 0),
            "cache": counts.get("cache", 0),
            "stale": counts.get("stale", 0),
            "partial": counts.get("partial", 0),
            "api_requests": sum(pool.usage.values()),
            "api_keys": len(keys),
            "generated_at": iso(now),
            "existing_cache_records": len(previous_index),
        },
        "movies": output,
    }

    safe_write(payload)

    log(
        "✅ Dataset saved safely: "
        f"fresh={counts['fresh']} "
        f"cache={counts['cache']} "
        f"stale={counts['stale']} "
        f"partial={counts['partial']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
