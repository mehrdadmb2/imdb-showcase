"""
IMDb Showcase - resilient data + poster cache pipeline

Design goals
------------
1) One shared dataset: docs/movies.json for Classic + Advanced.
2) Repository-local poster cache: docs/posters/<imdb_id>.webp.
3) OMDb is called only for:
   - new records;
   - records still missing enrichment;
   - records whose successful enrichment is at least 30 days old.
4) Incomplete records have a retry cooldown so a broken API does not burn
   quota twice in one day.
5) A failed monthly refresh NEVER erases the previous good metadata/poster.
6) The entire CSV row and successful OMDb response are preserved.
7) Four-key support: OMDB_API_KEYS is preferred and may contain comma,
   semicolon, whitespace, newline, or JSON-array separated keys. Legacy
   OMDB_API_KEY and OMDB_API_KEY_1..4 are also supported.
8) Sanitized diagnostics are written to docs/system-status.json and
   docs/update-log.json. API secrets are never written to disk.
9) --health-check tests each discovered key exactly once and writes its
   diagnostic status without touching movies.json.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from PIL import Image, UnidentifiedImageError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
DOCS = REPO_ROOT / "docs"
POSTERS = DOCS / "posters"
CSV_PATH = ROOT / "ratings.csv"
OUTPUT_PATH = DOCS / "movies.json"
SYSTEM_STATUS_PATH = DOCS / "system-status.json"
RUN_LOG_PATH = DOCS / "update-log.json"
KEY_STATE_PATH = DOCS / "omdb-key-state.json"

CACHE_TTL_DAYS = 30
INCOMPLETE_RETRY_HOURS = 24
NETWORK_RETRY_HOURS = 6
POSTER_RETRY_HOURS = 24
MAX_REQUESTS_PER_KEY_PER_DAY_BUDGET = 980
REQUEST_TIMEOUT = 15
POSTER_TIMEOUT = 20
POSTER_MAX_SIZE = (650, 975)
POSTER_QUALITY = 72
MAX_ERRORS_IN_REPORT = 100
MAX_RUN_HISTORY = 30

session = requests.Session()
session.headers.update(
    {
        "User-Agent": (
            "IMDb-Showcase/10.0 "
            "(+https://github.com/mehrdadmb2/imdb-showcase)"
        )
    }
)

retry = Retry(
    total=3,
    connect=3,
    read=3,
    backoff_factor=0.6,
    status_forcelist=(500, 502, 503, 504),
    allowed_methods=frozenset({"GET"}),
    raise_on_status=False,
)
session.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20))
session.mount("http://", HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def log(message: str, level: str = "INFO") -> None:
    print(f"[{now_iso()}] [{level}] {message}", flush=True)


def clean(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    text = str(value).replace("\x00", "").strip()
    if not text or text.upper() == "N/A":
        return fallback
    return text


def number(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def parse_iso(value: Any) -> datetime | None:
    text = clean(value)
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def age_days(value: Any) -> float:
    dt = parse_iso(value)
    if not dt:
        return float("inf")
    return max(0.0, (now_utc() - dt).total_seconds() / 86400)


def valid_imdb_id(value: Any) -> str:
    text = clean(value)
    return text if re.fullmatch(r"tt\d{5,12}", text, re.I) else ""


def safe_filename(imdb_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "", imdb_id) or "unknown"


def read_json(path: Path, fallback: dict) -> dict:
    if not path.exists():
        return deepcopy(fallback)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else deepcopy(fallback)
    except Exception as exc:
        log(f"خواندن {path.name} ناموفق بود: {exc}", "WARN")
        return deepcopy(fallback)


def atomic_json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp.replace(path)


def parse_combined_keys(value: str) -> list[str]:
    value = value.strip()
    if not value:
        return []

    # Support JSON arrays for convenience.
    if value.startswith("[") and value.endswith("]"):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [clean(item) for item in parsed if clean(item)]
        except json.JSONDecodeError:
            pass

    return [token for token in re.split(r"[;,\s]+", value) if token]


def load_keys() -> list[str]:
    candidates: list[str] = []

    combined = os.getenv("OMDB_API_KEYS", "")
    candidates.extend(parse_combined_keys(combined))

    for env_name in (
        "OMDB_API_KEY_1",
        "OMDB_API_KEY_2",
        "OMDB_API_KEY_3",
        "OMDB_API_KEY_4",
        "OMDB_API_KEY",
    ):
        value = os.getenv(env_name, "").strip()
        if value:
            candidates.append(value)

    # De-duplicate while preserving order.
    return list(dict.fromkeys(key for key in candidates if key))


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


class KeyPool:
    def __init__(self, keys: list[str]):
        self.keys = keys
        self.index = 0
        self.requests = {key: 0 for key in keys}
        self.success = {key: 0 for key in keys}
        self.not_found = {key: 0 for key in keys}
        self.errors = {key: 0 for key in keys}
        self.rate_limited = set()
        self.invalid = set()
        self.network_failed = set()
        self.last_error: dict[str, str] = {}
        self.last_kind: dict[str, str] = {}

    def next_key(self) -> str | None:
        if not self.keys:
            return None
        for _ in range(len(self.keys)):
            key = self.keys[self.index]
            self.index = (self.index + 1) % len(self.keys)
            if key in self.rate_limited or key in self.invalid:
                continue
            if self.requests[key] >= MAX_REQUESTS_PER_KEY_PER_DAY_BUDGET:
                continue
            return key
        return None

    def note(self, key: str, kind: str, message: str = "") -> None:
        self.requests[key] += 1
        if kind == "success":
            self.success[key] += 1
        elif kind == "not_found":
            self.not_found[key] += 1
        else:
            self.errors[key] += 1
        self.last_kind[key] = kind
        if kind == "rate_limited":
            self.rate_limited.add(key)
        elif kind == "invalid":
            self.invalid.add(key)
        elif kind == "network":
            self.network_failed.add(key)
        if message:
            self.last_error[key] = message[:300]

    def summary(self) -> list[dict[str, Any]]:
        rows = []
        for idx, key in enumerate(self.keys, 1):
            last_kind = self.last_kind.get(key, "")
            if key in self.invalid and last_kind == "invalid":
                status = "invalid"
            elif key in self.rate_limited and last_kind == "rate_limited":
                status = "rate_limited"
            elif last_kind == "network":
                status = "network_error"
            elif last_kind in {"success", "not_found", "api_error", "http_error"}:
                status = "active" if last_kind in {"success", "not_found"} else "active_with_errors"
            elif self.requests[key] == 0:
                status = "not_tested"
            else:
                status = "active"
            rows.append(
                {
                    "label": f"key-{idx}",
                    "fingerprint": fingerprint(key),
                    "status": status,
                    "requests_this_run": self.requests[key],
                    "success_this_run": self.success[key],
                    "not_found_this_run": self.not_found[key],
                    "errors_this_run": self.errors[key],
                    "last_error": self.last_error.get(key, ""),
                }
            )
        return rows


def key_state_load() -> dict:
    return read_json(KEY_STATE_PATH, {"schema_version": 1, "keys": {}})


def key_state_update(state: dict, pool: KeyPool, run_date: str) -> dict:
    keys_state = state.setdefault("keys", {})
    for row in pool.summary():
        fp = row["fingerprint"]
        item = keys_state.setdefault(
            fp,
            {
                "label": row["label"],
                "fingerprint": fp,
                "total_requests": 0,
                "total_success": 0,
                "total_not_found": 0,
                "total_errors": 0,
                "last_status": "not_tested",
                "last_error": "",
                "daily_date": run_date,
                "daily_requests": 0,
                "daily_success": 0,
                "daily_errors": 0,
            },
        )
        if item.get("daily_date") != run_date:
            item["daily_date"] = run_date
            item["daily_requests"] = 0
            item["daily_success"] = 0
            item["daily_errors"] = 0

        item["total_requests"] += row["requests_this_run"]
        item["total_success"] += row["success_this_run"]
        item["total_not_found"] += row["not_found_this_run"]
        item["total_errors"] += row["errors_this_run"]
        item["daily_requests"] += row["requests_this_run"]
        item["daily_success"] += row["success_this_run"]
        item["daily_errors"] += row["errors_this_run"]
        item["last_status"] = row["status"]
        if row["last_error"]:
            item["last_error"] = row["last_error"]
        item["last_seen_at"] = now_iso()
        item["label"] = row["label"]

    state["schema_version"] = 1
    state["updated_at"] = now_iso()
    return state


def read_old_data() -> dict:
    return read_json(OUTPUT_PATH, {"schema_version": 6, "movies": [], "data_meta": {}})


def read_csv() -> list[dict]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"{CSV_PATH} پیدا نشد.")

    rows: list[dict] = []
    seen: set[str] = set()
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV فاقد header است.")

        normalized_headers = {str(h).strip().lower() for h in reader.fieldnames if h}
        if "const" not in normalized_headers:
            raise ValueError("ستون Const در CSV پیدا نشد.")

        for raw_row in reader:
            imdb_id = valid_imdb_id(raw_row.get("Const"))
            if not imdb_id or imdb_id in seen:
                continue
            seen.add(imdb_id)

            raw_csv = {
                str(k): "" if v is None else str(v).strip()
                for k, v in raw_row.items()
                if k is not None
            }

            title = clean(raw_row.get("Title"), "Untitled")
            rows.append(
                {
                    "imdb_id": imdb_id,
                    "title": title,
                    "original_title": clean(raw_row.get("Original Title"), title),
                    "year": clean(raw_row.get("Year")),
                    "user_rating": number(raw_row.get("Your Rating")),
                    "date_rated": clean(raw_row.get("Date Rated")),
                    "title_type": clean(raw_row.get("Title Type"), "Other"),
                    "imdb_rating": clean(raw_row.get("IMDb Rating")),
                    "runtime": clean(raw_row.get("Runtime (mins)")),
                    "genres": clean(raw_row.get("Genres")),
                    "num_votes": clean(raw_row.get("Num Votes")),
                    "release_date": clean(raw_row.get("Release Date")),
                    "directors": clean(raw_row.get("Directors")),
                    "url": clean(raw_row.get("URL")),
                    "raw_csv": raw_csv,
                }
            )

    if not rows:
        raise ValueError("CSV خوانده شد اما هیچ رکورد معتبر ندارد.")
    return rows


def valid_local_poster(path: Path) -> bool:
    try:
        if not path.exists() or path.stat().st_size <= 0:
            return False
        with Image.open(path) as image:
            return image.width >= 80 and image.height >= 120
    except Exception:
        return False


def local_poster_rel(imdb_id: str) -> str:
    return f"posters/{safe_filename(imdb_id)}.webp"


def local_poster_path(imdb_id: str) -> Path:
    return POSTERS / f"{safe_filename(imdb_id)}.webp"


def poster_candidates_from_record(record: dict) -> list[str]:
    candidates: list[str] = []
    for value in (
        record.get("poster"),
        (record.get("raw_omdb") or {}).get("Poster"),
        record.get("poster_remote"),
    ):
        value = clean(value)
        if value and value not in candidates and value.lower() != "n/a":
            candidates.append(value)
    return candidates


def poster_candidates_from_imdb(imdb_id: str) -> list[str]:
    headers = {}
    cookie = os.getenv("IMDB_COOKIES", "").strip()
    if cookie:
        headers["Cookie"] = cookie

    urls = [
        f"https://www.imdb.com/title/{imdb_id}/",
    ]
    result: list[str] = []
    for url in urls:
        try:
            response = session.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            if response.status_code != 200:
                log(f"IMDb poster lookup {imdb_id}: HTTP {response.status_code}", "WARN")
                continue
            soup = BeautifulSoup(response.text, "html.parser")
            for selector in (
                ("meta", {"property": "og:image"}),
                ("meta", {"name": "twitter:image"}),
            ):
                tag = soup.find(*selector)
                candidate = clean(tag.get("content") if tag else "")
                if candidate and candidate not in result:
                    result.append(candidate)
        except requests.RequestException as exc:
            log(f"IMDb poster lookup failed for {imdb_id}: {type(exc).__name__}", "WARN")
    return result


def download_poster(imdb_id: str, candidates: list[str]) -> str:
    target = local_poster_path(imdb_id)
    if valid_local_poster(target):
        return local_poster_rel(imdb_id)
    POSTERS.mkdir(parents=True, exist_ok=True)

    for url in candidates:
        try:
            response = session.get(url, timeout=POSTER_TIMEOUT, stream=True)
            if response.status_code >= 400:
                continue
            content_type = (response.headers.get("content-type") or "").lower()
            raw = response.content
            if len(raw) < 700 and "svg" not in content_type:
                continue
            try:
                image = Image.open(BytesIO(raw)).convert("RGB")
            except (UnidentifiedImageError, OSError):
                continue
            if image.width < 80 or image.height < 120:
                continue
            image.thumbnail(POSTER_MAX_SIZE, Image.Resampling.LANCZOS)
            tmp = target.with_suffix(".tmp.webp")
            image.save(tmp, format="WEBP", quality=POSTER_QUALITY, method=6)
            if valid_local_poster(tmp):
                tmp.replace(target)
                log(f"🖼️ Poster cached: {imdb_id} -> {target.name}")
                return local_poster_rel(imdb_id)
            tmp.unlink(missing_ok=True)
        except (requests.RequestException, OSError) as exc:
            log(f"Poster download failed for {imdb_id}: {type(exc).__name__}", "WARN")
        except Exception as exc:
            log(f"Poster processing failed for {imdb_id}: {exc}", "WARN")
    return ""


def get_poster_local(record: dict, imdb_id: str) -> str:
    local = clean(record.get("poster_local"))
    if local and valid_local_poster(REPO_ROOT / "docs" / local):
        return local
    path = local_poster_path(imdb_id)
    return local_poster_rel(imdb_id) if valid_local_poster(path) else ""


def record_has_enrichment(record: dict) -> bool:
    raw = record.get("raw_omdb")
    if not isinstance(raw, dict) or not raw.get("imdbID"):
        return bool(record.get("omdb_found"))
    # OMDb can legitimately have N/A for some optional fields. Core identity
    # plus raw response is enough to consider the API enrichment successful.
    return True


def record_complete(record: dict) -> bool:
    return record_has_enrichment(record)


def should_retry_incomplete(record: dict) -> bool:
    retry_at = parse_iso(record.get("next_retry_at"))
    if retry_at and now_utc() < retry_at:
        return False
    return True


def mark_failure(record: dict, reason: str) -> None:
    failures = int(record.get("failure_count") or 0) + 1
    record["failure_count"] = failures
    record["last_api_attempt_at"] = now_iso()
    if reason.startswith("network"):
        record["next_retry_at"] = (now_utc() + timedelta(hours=NETWORK_RETRY_HOURS)).isoformat()
    else:
        record["next_retry_at"] = (now_utc() + timedelta(hours=INCOMPLETE_RETRY_HOURS)).isoformat()
    record["data_stale_reason"] = reason


def merge_csv(base: dict, csv_row: dict) -> dict:
    result = deepcopy(base)
    # CSV source remains authoritative for the user's rating and CSV columns.
    result.update(csv_row)
    return result


def enrich_record(record: dict, omdb: dict) -> dict:
    now = now_iso()
    result = deepcopy(record)
    result.update(
        {
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
            "series_id": clean(omdb.get("seriesID")),
            "series_title": clean(omdb.get("series")),
            "season_number": int(number(omdb.get("Season"))),
            "episode_number": int(number(omdb.get("Episode"))),
            "episode_title": clean(omdb.get("Title"), result.get("title", "")),
            "total_seasons": int(number(omdb.get("totalSeasons"))),
            "is_episode": result.get("title_type") == "TV Episode" or bool(omdb.get("Episode")),
            "raw_omdb": deepcopy(omdb),
            "omdb_found": True,
            "data_status": "fresh",
            "data_fetched_at": now,
            "cache_updated_at": now,
            "last_api_attempt_at": now,
            "next_retry_at": "",
            "failure_count": 0,
            "data_stale_reason": "",
        }
    )

    # Fill only blank CSV values from OMDb; do not replace values already
    # provided by the user's CSV export.
    fallback_fields = {
        "imdb_rating": "imdbRating",
        "num_votes": "imdbVotes",
        "runtime": "Runtime",
        "directors": "Director",
        "genres": "Genre",
        "release_date": "Released",
    }
    for field, omdb_key in fallback_fields.items():
        if not clean(result.get(field)):
            result[field] = clean(omdb.get(omdb_key))

    return result


def merge_failed_record(record: dict, reason: str, had_old: bool) -> dict:
    result = deepcopy(record)
    result["data_status"] = "stale" if had_old and record_has_enrichment(record) else "partial"
    result["omdb_found"] = bool(record.get("omdb_found") or record.get("raw_omdb"))
    mark_failure(result, reason)
    return result


def fetch_omdb(imdb_id: str, pool: KeyPool) -> tuple[dict | None, str, str | None]:
    attempted: set[str] = set()
    last_reason = "all_keys_unavailable"
    last_key: str | None = None

    while len(attempted) < len(pool.keys):
        key = pool.next_key()
        if not key:
            break
        if key in attempted:
            # All remaining keys have already been attempted for this title.
            continue
        attempted.add(key)
        last_key = key

        try:
            response = session.get(
                "https://www.omdbapi.com/",
                params={"i": imdb_id, "apikey": key, "plot": "full", "r": "json"},
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": "IMDb-Showcase/10.0 (+https://github.com/mehrdadmb2/imdb-showcase)"},
            )
            status_code = response.status_code
            if status_code in (401, 403):
                pool.note(key, "invalid", f"HTTP {status_code}")
                log(f"🔑 {fingerprint(key)} -> invalid/auth HTTP {status_code}", "ERROR")
                continue
            if status_code == 429:
                pool.note(key, "rate_limited", "HTTP 429")
                log(f"🔑 {fingerprint(key)} -> rate limited (429); switching key", "WARN")
                continue
            if status_code != 200:
                pool.note(key, "http_error", f"HTTP {status_code}")
                if status_code >= 500:
                    last_reason = f"http_{status_code}"
                    log(f"🔁 {fingerprint(key)} -> HTTP {status_code}; trying next key", "WARN")
                    continue
                return None, f"http_{status_code}", key

            try:
                data = response.json()
            except ValueError:
                pool.note(key, "http_error", "invalid_json")
                return None, "invalid_json", key

            error_text = clean(data.get("Error"), "").lower()
            if data.get("Response") == "True":
                pool.note(key, "success")
                return data, "ok", key

            if "invalid api key" in error_text or "unauthorized" in error_text:
                pool.note(key, "invalid", data.get("Error", "invalid key"))
                log(f"🔑 {fingerprint(key)} -> OMDb rejected key; switching", "ERROR")
                continue

            if "request limit" in error_text or "daily limit" in error_text or "limit reached" in error_text:
                pool.note(key, "rate_limited", data.get("Error", "limit reached"))
                log(f"🔑 {fingerprint(key)} -> daily limit; switching", "WARN")
                continue

            if "not found" in error_text:
                pool.note(key, "not_found", data.get("Error", "Movie not found"))
                return None, "movie_not_found", key

            pool.note(key, "api_error", data.get("Error", "unknown_api_error"))
            last_reason = clean(data.get("Error"), "unknown_api_error")
            return None, last_reason, key

        except requests.RequestException as exc:
            pool.note(key, "network", f"{type(exc).__name__}: {exc}")
            last_reason = f"network_{type(exc).__name__}"
            log(f"🌐 OMDb network error for {imdb_id}: {type(exc).__name__}; trying next key", "WARN")
            # A network failure is not proof that the key is bad. Still give the next key
            # a chance; if all keys fail, the caller preserves the previous snapshot.
            continue

    return None, last_reason, last_key


def health_check(keys: list[str]) -> dict:
    pool = KeyPool(keys)
    report: dict[str, Any] = {
        "started_at": now_iso(),
        "mode": "health_check",
        "keys": [],
        "note": "یک درخواست آزمایشی برای هر کلید؛ هیچ movies.json تغییری داده نشده است.",
    }

    for idx, key in enumerate(keys, 1):
        try:
            response = requests.get(
                "https://www.omdbapi.com/",
                params={"i": "tt0133093", "apikey": key, "plot": "short", "r": "json"},
                timeout=REQUEST_TIMEOUT,
            )
            body = response.json() if response.headers.get("content-type", "").lower().startswith("application/json") else {}
            if response.status_code in (401, 403):
                pool.note(key, "invalid", f"HTTP {response.status_code}")
            elif response.status_code == 429:
                pool.note(key, "rate_limited", "HTTP 429")
            elif response.status_code != 200:
                pool.note(key, "http_error", f"HTTP {response.status_code}")
            elif body.get("Response") == "True":
                pool.note(key, "success")
            else:
                err = clean(body.get("Error"), "unknown")
                if "limit" in err.lower():
                    pool.note(key, "rate_limited", err)
                elif "invalid api key" in err.lower():
                    pool.note(key, "invalid", err)
                else:
                    pool.note(key, "api_error", err)
        except Exception as exc:
            pool.note(key, "network", f"{type(exc).__name__}: {exc}")

    report["finished_at"] = now_iso()
    report["keys"] = pool.summary()
    report["healthy"] = sum(row["status"] == "active" for row in report["keys"])
    report["rate_limited"] = sum(row["status"] == "rate_limited" for row in report["keys"])
    report["invalid"] = sum(row["status"] == "invalid" for row in report["keys"])
    return report


def update_run_history(new_run: dict) -> None:
    payload = read_json(RUN_LOG_PATH, {"schema_version": 1, "runs": []})
    runs = payload.setdefault("runs", [])
    runs.insert(0, new_run)
    payload["runs"] = runs[:MAX_RUN_HISTORY]
    payload["schema_version"] = 1
    payload["updated_at"] = now_iso()
    atomic_json_write(RUN_LOG_PATH, payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--health-check", action="store_true")
    args = parser.parse_args()

    started = now_iso()
    run_date = now_utc().date().isoformat()
    keys = load_keys()

    if not keys:
        report = {
            "schema_version": 1,
            "status": "error",
            "message": "هیچ OMDb API key پیدا نشد.",
            "generated_at": now_iso(),
            "run": {"started_at": started, "finished_at": now_iso(), "mode": "health_check" if args.health_check else "update"},
            "keys": [],
            "errors": [{"reason": "no_keys"}],
        }
        atomic_json_write(SYSTEM_STATUS_PATH, report)
        return 2

    log(f"🔐 {len(keys)} OMDb key detected (secrets are never written).")

    if args.health_check:
        report = health_check(keys)
        status = "healthy" if report["healthy"] == len(keys) else "degraded"
        key_state = key_state_load()
        # Health-check requests are counted in the sanitized cumulative key state.
        for row in report.get("keys", []):
            fp = row.get("fingerprint", "")
            item = key_state.setdefault("keys", {}).setdefault(fp, {})
            item.update({
                "label": row.get("label"),
                "fingerprint": fp,
                "last_health_check_status": row.get("status"),
                "last_health_check_at": now_iso(),
                "last_error": row.get("last_error", ""),
            })
            if item.get("daily_date") != run_date:
                item["daily_date"] = run_date
                item["daily_requests"] = 0
                item["daily_success"] = 0
                item["daily_errors"] = 0
            item["total_requests"] = int(item.get("total_requests", 0)) + int(row.get("requests_this_run", 0))
            item["daily_requests"] = int(item.get("daily_requests", 0)) + int(row.get("requests_this_run", 0))
            item["total_success"] = int(item.get("total_success", 0)) + int(row.get("success_this_run", 0))
            item["daily_success"] = int(item.get("daily_success", 0)) + int(row.get("success_this_run", 0))
            item["total_not_found"] = int(item.get("total_not_found", 0)) + int(row.get("not_found_this_run", 0))
            item["total_errors"] = int(item.get("total_errors", 0)) + int(row.get("errors_this_run", 0))
            item["daily_errors"] = int(item.get("daily_errors", 0)) + int(row.get("errors_this_run", 0))
            item["daily_date"] = run_date
        key_state["schema_version"] = 1
        key_state["updated_at"] = now_iso()
        atomic_json_write(KEY_STATE_PATH, key_state)
        system = {
            "schema_version": 2,
            "status": status,
            "message": "گزارش سلامت کلیدهای OMDb",
            "generated_at": now_iso(),
            "run": report,
            "keys": report["keys"],
            "errors": [],
        }
        atomic_json_write(SYSTEM_STATUS_PATH, system)
        update_run_history(system)
        log(json.dumps(system, ensure_ascii=False), "INFO")
        return 0

    force_refresh = os.getenv("FORCE_REFRESH", "false").strip().lower() in {"1", "true", "yes", "on"}

    old_data = read_old_data()
    old_movies = old_data.get("movies") if isinstance(old_data.get("movies"), list) else []
    old_map = {clean(m.get("imdb_id")): m for m in old_movies if clean(m.get("imdb_id"))}
    rows = read_csv()
    pool = KeyPool(keys)

    output: list[dict] = []
    errors: list[dict] = []
    counts = {
        "source_records": len(rows),
        "cache_reused": 0,
        "api_attempts": 0,
        "omdb_success": 0,
        "omdb_not_found": 0,
        "omdb_errors": 0,
        "stale_preserved": 0,
        "partial_records": 0,
        "posters_reused": 0,
        "posters_downloaded": 0,
        "posters_missing": 0,
        "poster_attempts": 0,
        "records_due_monthly_refresh": 0,
        "records_missing_enrichment": 0,
        "records_in_retry_cooldown": 0,
    }

    run_started_dt = now_utc()
    log(f"📚 {len(rows)} CSV records loaded.")

    for idx, row in enumerate(rows, 1):
        imdb_id = row["imdb_id"]
        previous = old_map.get(imdb_id)
        record = merge_csv(previous or {}, row)

        previous_cache_at = (previous or {}).get("cache_updated_at") or (previous or {}).get("data_fetched_at")
        complete = bool(previous and record_complete(previous))
        monthly_due = bool(previous and (force_refresh or age_days(previous_cache_at) >= CACHE_TTL_DAYS))
        missing_enrichment = previous is None or not complete

        if monthly_due:
            counts["records_due_monthly_refresh"] += 1
        if missing_enrichment:
            counts["records_missing_enrichment"] += 1

        # 1) Repair / reuse local poster without consuming OMDb quota.
        existing_local = get_poster_local(previous or {}, imdb_id)
        if existing_local:
            record["poster_local"] = existing_local
            counts["posters_reused"] += 1
        else:
            candidates = poster_candidates_from_record(previous or {})
            last_poster_attempt = (previous or {}).get("poster_last_attempt_at")
            poster_due = age_days(last_poster_attempt) >= POSTER_RETRY_HOURS / 24

            # Only query IMDb for a missing poster when the retry window has elapsed.
            if not candidates and previous and poster_due:
                record["poster_last_attempt_at"] = now_iso()
                candidates = poster_candidates_from_imdb(imdb_id)

            if candidates and (not last_poster_attempt or poster_due or previous is None):
                counts["poster_attempts"] += 1
                record["poster_last_attempt_at"] = now_iso()
                record["poster_remote"] = candidates[0]
                local = download_poster(imdb_id, candidates)
                if local:
                    record["poster_local"] = local
                    counts["posters_downloaded"] += 1
                else:
                    counts["posters_missing"] += 1
            else:
                pass

        # 2) Decide whether OMDb is allowed/needed.
        api_due = missing_enrichment or monthly_due
        if missing_enrichment and previous and not should_retry_incomplete(previous):
            api_due = False
            counts["records_in_retry_cooldown"] += 1

        # A complete record younger than 30d must never hit OMDb.
        if complete and not monthly_due:
            api_due = False

        if api_due:
            counts["api_attempts"] += 1
            omdb, reason, used_key = fetch_omdb(imdb_id, pool)
            if omdb:
                record = enrich_record(record, omdb)
                counts["omdb_success"] += 1

                # Save poster from OMDb response; fallback to IMDb page if OMDb has no URL.
                if not get_poster_local(record, imdb_id):
                    candidates = poster_candidates_from_record(record)
                    if not candidates:
                        candidates = poster_candidates_from_imdb(imdb_id)
                    if candidates:
                        counts["poster_attempts"] += 1
                        record["poster_last_attempt_at"] = now_iso()
                        record["poster_remote"] = candidates[0]
                        local = download_poster(imdb_id, candidates)
                        if local:
                            record["poster_local"] = local
                            counts["posters_downloaded"] += 1
                        else:
                            counts["posters_missing"] += 1
                else:
                    record["poster_local"] = get_poster_local(record, imdb_id)
            else:
                counts["omdb_errors"] += 1
                if reason == "movie_not_found":
                    counts["omdb_not_found"] += 1
                if previous and record_has_enrichment(previous):
                    counts["stale_preserved"] += 1
                else:
                    counts["partial_records"] += 1
                record = merge_failed_record(record, reason, previous is not None)
                errors.append({"imdb_id": imdb_id, "title": row["title"], "reason": reason, "key": fingerprint(used_key) if used_key else ""})
        else:
            counts["cache_reused"] += 1
            if previous:
                # Keep every enriched/cached field exactly as it was, while
                # making CSV-origin fields current.
                keep = deepcopy(previous)
                keep.update(row)
                record = keep
            if not record.get("cache_updated_at") and previous:
                record["cache_updated_at"] = previous.get("cache_updated_at") or previous.get("data_fetched_at", "")
            if complete:
                record["data_status"] = "cached"

        # Independent poster state is useful for diagnostics and does not imply
        # that an API call is required.
        final_local_poster = get_poster_local(record, imdb_id)
        if final_local_poster:
            record["poster_local"] = final_local_poster
            record["poster_status"] = "local"
        elif clean(record.get("poster")) or clean(record.get("poster_remote")):
            record["poster_status"] = "remote_only"
            counts["posters_missing"] += 1
        else:
            record["poster_status"] = "unavailable"
            counts["posters_missing"] += 1

        if not record_has_enrichment(record):
            record["data_status"] = "partial"
        record["schema_record_version"] = 2

        output.append(record)

        if idx % 100 == 0 or idx == len(rows):
            log(
                f"progress={idx}/{len(rows)} "
                f"api={counts['api_attempts']} fresh={counts['omdb_success']} "
                f"cache={counts['cache_reused']} stale={counts['stale_preserved']} "
                f"partial={counts['partial_records']} posters={counts['posters_downloaded']}",
            )

        # Small pacing delay avoids hammering endpoints while keeping the run practical.
        time.sleep(0.015)

    finished = now_iso()
    prior_meta = old_data.get("data_meta") if isinstance(old_data.get("data_meta"), dict) else {}
    key_state = key_state_load()
    key_state = key_state_update(key_state, pool, run_date)

    # Only a successful non-empty run can replace movies.json.
    payload = {
        "schema_version": 6,
        "last_manual_update": finished,
        "data_meta": {
            **prior_meta,
            **counts,
            "output_records": len(output),
            "cache_ttl_days": CACHE_TTL_DAYS,
            "force_refresh": force_refresh,
            "incomplete_retry_hours": INCOMPLETE_RETRY_HOURS,
            "network_retry_hours": NETWORK_RETRY_HOURS,
            "omdb_key_count": len(keys),
            "omdb_request_budget_per_key": MAX_REQUESTS_PER_KEY_PER_DAY_BUDGET,
            "omdb_key_status": pool.summary(),
            "policy": (
                "new_or_incomplete_records_retry_with_cooldown; "
                "complete_records_use_repository_cache_until_30_days; "
                "monthly_refresh_preserves_previous_snapshot_on_failure"
            ),
        },
        "movies": output,
        "errors": errors[:MAX_ERRORS_IN_REPORT],
    }

    POSTERS.mkdir(parents=True, exist_ok=True)
    if len(output) != len(rows):
        raise RuntimeError("خروجی کامل نیست؛ movies.json قبلی حفظ شد.")

    atomic_json_write(OUTPUT_PATH, payload)
    atomic_json_write(KEY_STATE_PATH, key_state)

    run_report = {
        "started_at": started,
        "finished_at": finished,
        "duration_seconds": round((now_utc() - run_started_dt).total_seconds(), 2),
        "mode": "update",
        "keys_detected": len(keys),
        "counts": counts,
        "keys": pool.summary(),
        "errors": errors[:MAX_ERRORS_IN_REPORT],
        "message": "اطلاعات قبلی هنگام شکست دریافت جدید حفظ می‌شود.",
    }

    status = "healthy"
    if counts["omdb_errors"] > 0 or counts["posters_missing"] > 0:
        status = "degraded"
    if not output:
        status = "error"

    system_status = {
        "schema_version": 2,
        "status": status,
        "message": "IMDb Showcase pipeline diagnostics",
        "generated_at": finished,
        "run": run_report,
        "keys": pool.summary(),
        "errors": errors[:MAX_ERRORS_IN_REPORT],
    }
    atomic_json_write(SYSTEM_STATUS_PATH, system_status)
    update_run_history(system_status)

    log(f"✅ movies.json written with {len(output)} records.")
    log(f"📊 {json.dumps(counts, ensure_ascii=False)}")
    log("🔐 Key diagnostics:")
    for row in pool.summary():
        log(
            f"  {row['label']} [{row['fingerprint']}] status={row['status']} "
            f"requests={row['requests_this_run']} success={row['success_this_run']} "
            f"errors={row['errors_this_run']}"
        )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("Pipeline توسط کاربر متوقف شد.", "ERROR")
        raise SystemExit(130)
    except Exception as exc:
        log(f"❌ Pipeline failed; existing movies.json was not intentionally replaced: {exc}", "ERROR")
        # Do not write a replacement dataset on unhandled exceptions.
        try:
            atomic_json_write(
                SYSTEM_STATUS_PATH,
                {
                    "schema_version": 2,
                    "status": "error",
                    "message": "Pipeline crashed before completing the dataset.",
                    "generated_at": now_iso(),
                    "run": {"mode": "update", "error": str(exc)},
                    "keys": list((read_json(KEY_STATE_PATH, {"keys": {}}).get("keys") or {}).values()),
                    "errors": [{"reason": type(exc).__name__, "message": str(exc)[:500]}],
                },
            )
        except Exception:
            pass
        raise SystemExit(1)
