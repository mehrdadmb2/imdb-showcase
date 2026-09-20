"""
IMDb Showcase — resilient repository-local data pipeline.

Design goals
------------
* One shared dataset: docs/movies.json
* One shared poster cache: docs/posters/<IMDb-ID>.webp
* OMDb_API_KEYS is the preferred Secret and may contain multiple keys.
* New/incomplete records are retried once per day until enriched.
* Complete records are refreshed only when their successful cache is >= 30 days old.
* Poster repair never consumes OMDb quota and can happen independently of metadata refresh.
* A failed request never erases the previous successful record.
* The workflow commits movies.json + poster files + diagnostics together.
* Diagnostics are sanitized; API secrets/cookies are never written.
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
from PIL import Image, ImageOps, UnidentifiedImageError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
DOCS = REPO_ROOT / "docs"
POSTERS = DOCS / "posters"
CSV_PATH = ROOT / "ratings.csv"
OUTPUT_PATH = DOCS / "movies.json"
SYSTEM_STATUS_PATH = DOCS / "system-status.json"
KEY_STATE_PATH = DOCS / "omdb-key-state.json"
RUN_LOG_PATH = DOCS / "update-log.json"


def _env_days(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default

CACHE_TTL_DAYS = _env_days('CACHE_TTL_DAYS', 30)
INCOMPLETE_RETRY_HOURS = 24
POSTER_RETRY_HOURS = 24
IMDB_POSTER_RETRY_HOURS = 48
MAX_PER_KEY_PER_DAY = 950
REQUEST_TIMEOUT = 20
POSTER_TIMEOUT = 25
POSTER_MAX_SIZE = (420, 630)
POSTER_QUALITY = 72
MAX_POSTER_BYTES = 8 * 1024 * 1024
MAX_ERRORS = 150
MAX_RUNS = 30

session = requests.Session()
session.headers.update(
    {
        "User-Agent": "IMDb-Showcase/12.0 (+https://github.com/mehrdadmb2/imdb-showcase)",
        "Accept-Language": "en-US,en;q=0.8",
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
adapter = HTTPAdapter(max_retries=retry, pool_connections=24, pool_maxsize=24)
session.mount("https://", adapter)
session.mount("http://", adapter)


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


def age_hours(value: Any) -> float:
    dt = parse_iso(value)
    if not dt:
        return float("inf")
    return max(0.0, (now_utc() - dt).total_seconds() / 3600)


def age_days(value: Any) -> float:
    return age_hours(value) / 24.0


def imdb_id(value: Any) -> str:
    text = clean(value)
    return text if re.fullmatch(r"tt\d{5,12}", text, re.I) else ""


def fingerprint(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:12]


def atomic_json_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp.replace(path)


def read_json(path: Path, fallback: dict) -> dict:
    if not path.exists():
        return deepcopy(fallback)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else deepcopy(fallback)
    except Exception as exc:
        log(f"خواندن {path.name} ناموفق بود: {type(exc).__name__}", "WARN")
        return deepcopy(fallback)


def parse_keys(value: str) -> list[str]:
    text = clean(value)
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [clean(x) for x in parsed if clean(x)]
        except json.JSONDecodeError:
            pass
    return [x for x in re.split(r"[\s,;|]+", text) if x]


def load_keys() -> list[str]:
    found: list[str] = []
    found.extend(parse_keys(os.getenv("OMDB_API_KEYS", "")))
    for name in (
        "OMDB_API_KEY_1",
        "OMDB_API_KEY_2",
        "OMDB_API_KEY_3",
        "OMDB_API_KEY_4",
        "OMDB_API_KEY",
    ):
        found.extend(parse_keys(os.getenv(name, "")))
    return list(dict.fromkeys(x.strip() for x in found if x.strip()))


class KeyPool:
    def __init__(self, keys: list[str], prior_state: dict):
        self.keys = keys
        self.index = 0
        self.requests = {k: 0 for k in keys}
        self.success = {k: 0 for k in keys}
        self.not_found = {k: 0 for k in keys}
        self.errors = {k: 0 for k in keys}
        self.disabled: set[str] = set()
        self.last_status: dict[str, str] = {}
        self.last_error: dict[str, str] = {}

        today = now_utc().date().isoformat()
        self.prior_daily = {k: 0 for k in keys}
        prior_keys = (prior_state or {}).get("keys") or {}
        for item in prior_keys.values():
            if item.get("daily_date") != today:
                continue
            fp = clean(item.get("fingerprint"))
            for key in keys:
                if fingerprint(key) == fp:
                    self.prior_daily[key] = int(item.get("daily_requests") or 0)
                    break

    def remaining_today(self, key: str) -> int:
        return max(
            0,
            MAX_PER_KEY_PER_DAY
            - self.prior_daily.get(key, 0)
            - self.requests.get(key, 0),
        )

    def next_key(self) -> str | None:
        if not self.keys:
            return None
        for _ in range(len(self.keys)):
            key = self.keys[self.index]
            self.index = (self.index + 1) % len(self.keys)
            if key in self.disabled:
                continue
            if self.remaining_today(key) <= 0:
                self.disabled.add(key)
                self.last_status[key] = "daily_budget_exhausted"
                continue
            return key
        return None

    def record(self, key: str, outcome: str, message: str = "") -> None:
        self.requests[key] += 1
        self.last_status[key] = outcome
        if outcome == "success":
            self.success[key] += 1
            self.last_error.pop(key, None)
        elif outcome == "not_found":
            self.not_found[key] += 1
            self.last_error.pop(key, None)
        else:
            self.errors[key] += 1
            if message:
                self.last_error[key] = clean(message)[:300]
        if outcome in {"invalid", "rate_limited", "daily_budget_exhausted"}:
            self.disabled.add(key)

    def summary(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for i, key in enumerate(self.keys, 1):
            remaining = self.remaining_today(key)
            status = self.last_status.get(key, "not_used")
            if key in self.disabled and status not in {"invalid", "rate_limited", "daily_budget_exhausted"}:
                status = "disabled"
            elif remaining <= 0:
                status = "daily_budget_exhausted"
            elif status == "not_used":
                status = "active"
            result.append(
                {
                    "label": f"key-{i}",
                    "fingerprint": fingerprint(key),
                    "status": status,
                    "requests_this_run": self.requests[key],
                    "requests_before_run_today": self.prior_daily.get(key, 0),
                    "requests_today_total": self.prior_daily.get(key, 0) + self.requests[key],
                    "remaining_today_budget": remaining,
                    "success_this_run": self.success[key],
                    "not_found_this_run": self.not_found[key],
                    "errors_this_run": self.errors[key],
                    "last_error": self.last_error.get(key, ""),
                }
            )
        return result


def read_csv() -> list[dict]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"{CSV_PATH} پیدا نشد.")
    rows: list[dict] = []
    seen: set[str] = set()
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError("CSV فاقد header است.")
        headers = {str(x).strip().lower() for x in reader.fieldnames if x}
        if "const" not in headers:
            raise ValueError("ستون Const در CSV پیدا نشد.")
        for raw in reader:
            ident = imdb_id(raw.get("Const"))
            if not ident or ident in seen:
                continue
            seen.add(ident)
            raw_csv = {
                str(k): "" if v is None else str(v).strip()
                for k, v in raw.items()
                if k is not None
            }
            title = clean(raw.get("Title"), "Untitled")
            rows.append(
                {
                    "imdb_id": ident,
                    "title": title,
                    "original_title": clean(raw.get("Original Title"), title),
                    "year": clean(raw.get("Year")),
                    "user_rating": number(raw.get("Your Rating")),
                    "date_rated": clean(raw.get("Date Rated")),
                    "title_type": clean(raw.get("Title Type"), "Other"),
                    "imdb_rating": clean(raw.get("IMDb Rating")),
                    "runtime": clean(raw.get("Runtime (mins)")),
                    "genres": clean(raw.get("Genres")),
                    "num_votes": clean(raw.get("Num Votes")),
                    "release_date": clean(raw.get("Release Date")),
                    "directors": clean(raw.get("Directors")),
                    "url": clean(raw.get("URL")),
                    "raw_csv": raw_csv,
                }
            )
    if not rows:
        raise ValueError("CSV خوانده شد اما هیچ رکورد معتبر ندارد.")
    return rows


def poster_path(ident: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]", "", ident) or "unknown"
    return POSTERS / f"{safe}.webp"


def poster_rel(ident: str) -> str:
    return f"posters/{poster_path(ident).name}"


def valid_local_poster(path: Path) -> bool:
    try:
        if not path.exists() or path.stat().st_size < 256:
            return False
        with Image.open(path) as image:
            return image.width >= 80 and image.height >= 120
    except Exception:
        return False


def local_poster_from_record(record: dict, ident: str) -> str:
    candidate = clean(record.get("poster_local"))
    if candidate:
        normalized = candidate.replace("\\", "/").lstrip("./")
        if normalized.startswith("docs/"):
            normalized = normalized[5:]
        if normalized.startswith("posters/") and valid_local_poster(DOCS / normalized):
            return normalized
    path = poster_path(ident)
    return poster_rel(ident) if valid_local_poster(path) else ""


def poster_candidates(record: dict) -> list[str]:
    raw = record.get("raw_omdb") if isinstance(record.get("raw_omdb"), dict) else {}
    values = [record.get("poster"), record.get("poster_remote"), raw.get("Poster")]
    result: list[str] = []
    for value in values:
        value = clean(value)
        if not value or value.lower() in {"n/a", "false", "null"}:
            continue
        if value not in result:
            result.append(value)
    return result


def imdb_poster_candidates(ident: str) -> list[str]:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": f"https://www.imdb.com/title/{ident}/",
    }
    cookies = os.getenv("IMDB_COOKIES", "").strip()
    if cookies:
        headers["Cookie"] = cookies
    try:
        response = session.get(
            f"https://www.imdb.com/title/{ident}/",
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            log(f"IMDb poster lookup {ident}: HTTP {response.status_code}", "WARN")
            return []
        soup = BeautifulSoup(response.text, "html.parser")
        result: list[str] = []
        for tag in (
            soup.find("meta", property="og:image"),
            soup.find("meta", attrs={"name": "twitter:image"}),
        ):
            value = clean(tag.get("content") if tag else "")
            if value and value not in result:
                result.append(value)
        return result
    except requests.RequestException as exc:
        log(f"IMDb poster lookup failed {ident}: {type(exc).__name__}", "WARN")
        return []


def save_local_poster(ident: str, urls: list[str]) -> str:
    target = poster_path(ident)
    if valid_local_poster(target):
        return poster_rel(ident)
    POSTERS.mkdir(parents=True, exist_ok=True)
    headers = {
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": f"https://www.imdb.com/title/{ident}/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    }
    cookies = os.getenv("IMDB_COOKIES", "").strip()
    if cookies:
        headers["Cookie"] = cookies

    unique_urls = []
    for url in urls[:8]:
        url = clean(url)
        if url and url not in unique_urls:
            unique_urls.append(url)

    for url in unique_urls:
        for attempt in range(1, 4):
            try:
                response = session.get(
                    url,
                    headers=headers,
                    timeout=POSTER_TIMEOUT,
                    allow_redirects=True,
                    stream=True,
                )
                if response.status_code >= 400:
                    if attempt < 3:
                        time.sleep(0.7 * attempt)
                        continue
                    break
                raw = response.content
                if not raw or len(raw) > MAX_POSTER_BYTES:
                    break
                try:
                    with Image.open(BytesIO(raw)) as opened:
                        image = ImageOps.exif_transpose(opened).convert("RGB")
                except (UnidentifiedImageError, OSError):
                    break
                if image.width < 80 or image.height < 120:
                    break
                image.thumbnail(POSTER_MAX_SIZE, Image.Resampling.LANCZOS)
                temp = target.with_suffix(".tmp.webp")
                image.save(temp, format="WEBP", quality=POSTER_QUALITY, method=6)
                if not valid_local_poster(temp):
                    temp.unlink(missing_ok=True)
                    break
                temp.replace(target)
                log(f"🖼️ Poster cached: {ident} -> {target.name}")
                return poster_rel(ident)
            except requests.RequestException as exc:
                if attempt == 3:
                    log(f"Poster request failed {ident}: {type(exc).__name__}", "WARN")
                else:
                    time.sleep(0.7 * attempt)
            except Exception as exc:
                log(f"Poster processing failed {ident}: {type(exc).__name__}", "WARN")
                break
    return ""


def has_omdb_enrichment(record: dict) -> bool:
    raw = record.get("raw_omdb")
    return bool(
        record.get("omdb_found")
        or (isinstance(raw, dict) and raw.get("Response") == "True" and raw.get("imdbID"))
    )


def should_retry(record: dict, now: datetime | None = None) -> bool:
    retry_at = parse_iso(record.get("next_retry_at"))
    if not retry_at:
        return True
    return (now or now_utc()) >= retry_at


def api_due(record: dict | None, force_refresh: bool) -> tuple[bool, str]:
    if not record:
        return True, "new"
    if not has_omdb_enrichment(record):
        return should_retry(record), "incomplete"
    refreshed_at = record.get("cache_updated_at") or record.get("data_fetched_at")
    if force_refresh:
        return should_retry(record), "forced"
    if age_days(refreshed_at) >= CACHE_TTL_DAYS:
        return should_retry(record), "monthly"
    return False, "cached"


def fetch_omdb(ident: str, pool: KeyPool) -> tuple[dict | None, str, str | None]:
    attempted: set[str] = set()
    last_reason = "all_keys_unavailable"
    last_key: str | None = None

    while len(attempted) < len(pool.keys):
        key = pool.next_key()
        if not key or key in attempted:
            break
        attempted.add(key)
        last_key = key

        for attempt in range(2):
            try:
                response = session.get(
                    "https://www.omdbapi.com/",
                    params={
                        "i": ident,
                        "apikey": key,
                        "plot": "full",
                        "r": "json",
                    },
                    timeout=REQUEST_TIMEOUT,
                )
                status = response.status_code
                if status == 429:
                    pool.record(key, "rate_limited", "HTTP 429")
                    log(f"🔑 {fingerprint(key)} rate limited; rotating key", "WARN")
                    break
                if status in (401, 403):
                    pool.record(key, "invalid", f"HTTP {status}")
                    log(f"🔑 {fingerprint(key)} rejected: HTTP {status}", "ERROR")
                    break
                if status in (500, 502, 503, 504) and attempt == 0:
                    pool.record(key, "http_retry", f"HTTP {status}")
                    time.sleep(0.8)
                    continue
                if status != 200:
                    pool.record(key, "http_error", f"HTTP {status}")
                    last_reason = f"http_{status}"
                    break

                try:
                    body = response.json()
                except ValueError:
                    pool.record(key, "api_error", "invalid_json")
                    last_reason = "invalid_json"
                    break

                if body.get("Response") == "True":
                    pool.record(key, "success")
                    return body, "ok", key

                error = clean(body.get("Error"), "omdb_failed")
                lower = error.lower()
                if "invalid api key" in lower or "unauthorized" in lower:
                    pool.record(key, "invalid", error)
                    log(f"🔑 {fingerprint(key)} invalid: {error}", "ERROR")
                    break
                if "limit" in lower or "quota" in lower:
                    pool.record(key, "rate_limited", error)
                    log(f"🔑 {fingerprint(key)} limited: {error}", "WARN")
                    break
                if "not found" in lower:
                    pool.record(key, "not_found")
                    return None, "movie_not_found", key

                pool.record(key, "api_error", error)
                last_reason = error
                break

            except requests.RequestException as exc:
                pool.record(key, "network", type(exc).__name__)
                last_reason = f"network_{type(exc).__name__}"
                log(f"🌐 OMDb network error {ident}: {type(exc).__name__}", "WARN")
                if attempt == 0:
                    time.sleep(0.8)
                    continue
                break
        # Move to the next key after this key's outcome.

    return None, last_reason, last_key


def merge_record(row: dict, old: dict | None, omdb: dict | None, reason: str) -> dict:
    result = deepcopy(old) if old else {}
    result.update(row)
    if omdb:
        now = now_iso()
        values = {
            "poster": clean(omdb.get("Poster")),
            "poster_remote": clean(omdb.get("Poster")),
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
            "episode_title": clean(omdb.get("Title"), row.get("title", "")),
            "total_seasons": int(number(omdb.get("totalSeasons"))),
            "is_episode": row.get("title_type") == "TV Episode" or bool(omdb.get("Episode")),
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
        fallback_fields = {
            "imdb_rating": "imdbRating",
            "num_votes": "imdbVotes",
            "runtime": "Runtime",
            "directors": "Director",
            "genres": "Genre",
            "release_date": "Released",
        }
        for field, source in fallback_fields.items():
            if not clean(result.get(field)):
                values[field] = clean(omdb.get(source))
        for key, value in values.items():
            if value not in ("", None, [], {}) or key in {"ratings", "raw_omdb"}:
                result[key] = value
        return result

    if old:
        # Preserve the complete previous snapshot. Only CSV-controlled values are updated.
        result["data_status"] = "stale" if has_omdb_enrichment(old) else "partial"
        result["data_stale_reason"] = reason
        result["omdb_found"] = bool(old.get("omdb_found") or old.get("raw_omdb"))
        if old.get("cache_updated_at"):
            result["cache_updated_at"] = old["cache_updated_at"]
        if old.get("data_fetched_at"):
            result["data_fetched_at"] = old["data_fetched_at"]
        result["last_api_attempt_at"] = now_iso()
        result["failure_count"] = int(old.get("failure_count") or 0) + 1
        result["next_retry_at"] = (now_utc() + timedelta(hours=INCOMPLETE_RETRY_HOURS)).isoformat()
        return result

    result.update(
        {
            "poster": "",
            "poster_remote": "",
            "plot": "",
            "rated": "",
            "actors": "",
            "writer": "",
            "country": "",
            "language": "",
            "awards": "",
            "box_office": "",
            "production": "",
            "metascore": "",
            "website": "",
            "ratings": [],
            "raw_omdb": {},
            "poster_local": "",
            "omdb_found": False,
            "data_status": "partial",
            "data_stale_reason": reason,
            "data_fetched_at": "",
            "cache_updated_at": "",
            "last_api_attempt_at": now_iso(),
            "failure_count": 1,
            "next_retry_at": (now_utc() + timedelta(hours=INCOMPLETE_RETRY_HOURS)).isoformat(),
        }
    )
    return result


def key_state_load() -> dict:
    return read_json(KEY_STATE_PATH, {"schema_version": 3, "updated_at": "", "keys": {}})


def update_key_state(state: dict, pool: KeyPool) -> dict:
    today = now_utc().date().isoformat()
    keys = state.setdefault("keys", {})
    for row in pool.summary():
        fp = row["fingerprint"]
        item = keys.setdefault(
            fp,
            {
                "label": row["label"],
                "fingerprint": fp,
                "total_requests": 0,
                "total_success": 0,
                "total_not_found": 0,
                "total_errors": 0,
                "last_status": "not_used",
                "last_error": "",
                "daily_date": today,
                "daily_requests": 0,
                "daily_success": 0,
                "daily_errors": 0,
            },
        )
        if item.get("daily_date") != today:
            item.update({"daily_date": today, "daily_requests": 0, "daily_success": 0, "daily_errors": 0})
        item["label"] = row["label"]
        item["total_requests"] = int(item.get("total_requests") or 0) + row["requests_this_run"]
        item["total_success"] = int(item.get("total_success") or 0) + row["success_this_run"]
        item["total_not_found"] = int(item.get("total_not_found") or 0) + row["not_found_this_run"]
        item["total_errors"] = int(item.get("total_errors") or 0) + row["errors_this_run"]
        item["daily_requests"] = row["requests_today_total"]
        item["daily_success"] = int(item.get("daily_success") or 0) + row["success_this_run"]
        item["daily_errors"] = int(item.get("daily_errors") or 0) + row["errors_this_run"]
        item["last_status"] = row["status"]
        if row["last_error"]:
            item["last_error"] = row["last_error"]
        item["last_seen_at"] = now_iso()
    state["schema_version"] = 3
    state["updated_at"] = now_iso()
    state["policy"] = "950 OMDb requests per key/day, tracked across workflow runs"
    return state


def update_history(system_status: dict) -> None:
    history = read_json(RUN_LOG_PATH, {"schema_version": 2, "runs": []})
    runs = history.setdefault("runs", [])
    runs.insert(0, system_status)
    history["runs"] = runs[:MAX_RUNS]
    history["schema_version"] = 2
    history["updated_at"] = now_iso()
    atomic_json_write(RUN_LOG_PATH, history)


def health_check(keys: list[str]) -> int:
    pool = KeyPool(keys, key_state_load())
    started = now_iso()
    for key in keys:
        if pool.remaining_today(key) <= 0:
            pool.disabled.add(key)
            pool.last_status[key] = "daily_budget_exhausted"
            continue
        try:
            response = session.get(
                "https://www.omdbapi.com/",
                params={"i": "tt0133093", "apikey": key, "plot": "short", "r": "json"},
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code == 200:
                body = response.json()
                if body.get("Response") == "True":
                    pool.record(key, "success")
                else:
                    text = clean(body.get("Error"), "unknown_error")
                    lower = text.lower()
                    pool.record(key, "rate_limited" if "limit" in lower or "quota" in lower else "api_error", text)
            elif response.status_code == 429:
                pool.record(key, "rate_limited", "HTTP 429")
            elif response.status_code in (401, 403):
                pool.record(key, "invalid", f"HTTP {response.status_code}")
            else:
                pool.record(key, "http_error", f"HTTP {response.status_code}")
        except requests.RequestException as exc:
            pool.record(key, "network", type(exc).__name__)
    finished = now_iso()
    rows = pool.summary()
    healthy = bool(rows) and all(x["status"] == "active" for x in rows)
    state = update_key_state(key_state_load(), pool)
    atomic_json_write(KEY_STATE_PATH, state)
    system = {
        "schema_version": 4,
        "status": "healthy" if healthy else "degraded",
        "message": "OMDb API key health check",
        "generated_at": finished,
        "run": {
            "mode": "health_check",
            "started_at": started,
            "finished_at": finished,
            "keys_detected": len(keys),
        },
        "keys": rows,
        "errors": [],
    }
    atomic_json_write(SYSTEM_STATUS_PATH, system)
    update_history(system)
    log(json.dumps(system, ensure_ascii=False))
    return 0 if healthy else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--health-check", action="store_true")
    args = parser.parse_args()

    keys = load_keys()
    if not keys:
        raise RuntimeError("هیچ OMDb API Key پیدا نشد. Secret OMDB_API_KEYS بررسی شود.")

    if args.health_check:
        return health_check(keys)

    old_data = read_json(OUTPUT_PATH, {"schema_version": 7, "movies": [], "data_meta": {}})
    old_movies = old_data.get("movies") if isinstance(old_data.get("movies"), list) else []
    old_map = {clean(x.get("imdb_id")): x for x in old_movies if clean(x.get("imdb_id"))}
    rows = read_csv()
    state = key_state_load()
    pool = KeyPool(keys, state)
    force_refresh = os.getenv("FORCE_REFRESH", "false").strip().lower() in {"1", "true", "yes", "on"}

    counts = {
        "source_records": len(rows),
        "cache_reused": 0,
        "api_attempts": 0,
        "omdb_success": 0,
        "omdb_not_found": 0,
        "omdb_errors": 0,
        "stale_preserved": 0,
        "partial_records": 0,
        "records_missing_enrichment": 0,
        "records_due_monthly_refresh": 0,
        "records_deferred_retry": 0,
        "poster_reused": 0,
        "poster_attempts": 0,
        "posters_downloaded": 0,
        "posters_missing": 0,
        "imdb_poster_fallback_attempts": 0,
    }
    errors: list[dict] = []
    output: list[dict] = []
    started_dt = now_utc()
    started = started_dt.isoformat()

    log(f"🔐 {len(keys)} OMDb key(s) detected. Secret values are never logged.")
    log(f"📚 {len(rows)} CSV records loaded.")

    for index, row in enumerate(rows, 1):
        ident = row["imdb_id"]
        old = deepcopy(old_map.get(ident)) if ident in old_map else None
        old_local = local_poster_from_record(old or {}, ident)
        if old_local:
            if old is not None and old.get("poster_local") != old_local:
                old["poster_local"] = old_local
            counts["poster_reused"] += 1

        # Poster repair is independent from OMDb metadata requests.
        record = deepcopy(old) if old else None
        urls = poster_candidates(record or {})
        poster_attempt_at = (record or {}).get("poster_last_attempt_at")
        if old_local:
            pass
        elif urls and (not poster_attempt_at or age_hours(poster_attempt_at) >= POSTER_RETRY_HOURS):
            counts["poster_attempts"] += 1
            if record is None:
                record = deepcopy(row)
            record["poster_last_attempt_at"] = now_iso()
            record["poster_remote"] = urls[0]
            local = save_local_poster(ident, urls)
            if local:
                record["poster_local"] = local
                record["poster_status"] = "local"
                counts["posters_downloaded"] += 1
            else:
                record["poster_status"] = "remote_only"
                counts["posters_missing"] += 1
        elif not urls and record and has_omdb_enrichment(record):
            imdb_last = record.get("imdb_poster_last_attempt_at")
            if not imdb_last or age_hours(imdb_last) >= IMDB_POSTER_RETRY_HOURS:
                counts["imdb_poster_fallback_attempts"] += 1
                record["imdb_poster_last_attempt_at"] = now_iso()
                candidates = imdb_poster_candidates(ident)
                if candidates:
                    local = save_local_poster(ident, candidates)
                    if local:
                        record["poster_local"] = local
                        record["poster_remote"] = candidates[0]
                        record["poster_status"] = "local"
                        counts["posters_downloaded"] += 1
                    else:
                        counts["posters_missing"] += 1
                else:
                    counts["posters_missing"] += 1

        due, reason_kind = api_due(record, force_refresh)
        if reason_kind == "monthly":
            counts["records_due_monthly_refresh"] += 1
        if reason_kind in {"new", "incomplete"} and not has_omdb_enrichment(record or {}):
            counts["records_missing_enrichment"] += 1

        if due:
            counts["api_attempts"] += 1
            omdb, reason, used_key = fetch_omdb(ident, pool)
            new_record = merge_record(row, record, omdb, reason)
            if omdb:
                counts["omdb_success"] += 1
                # Always keep the latest poster URL from successful OMDb.
                poster_url = clean(omdb.get("Poster"))
                new_record["poster_remote"] = poster_url or clean(new_record.get("poster_remote"))
                local = local_poster_from_record(new_record, ident)
                if not local and poster_url:
                    counts["poster_attempts"] += 1
                    new_record["poster_last_attempt_at"] = now_iso()
                    local = save_local_poster(ident, [poster_url])
                    if local:
                        counts["posters_downloaded"] += 1
                if not local:
                    # Even when OMDb returns no poster URL (or its CDN blocks the request),
                    # try IMDb's page metadata as an independent poster source. This costs no OMDb quota.
                    imdb_last = new_record.get("imdb_poster_last_attempt_at")
                    if not imdb_last or age_hours(imdb_last) >= IMDB_POSTER_RETRY_HOURS:
                        counts["imdb_poster_fallback_attempts"] += 1
                        new_record["imdb_poster_last_attempt_at"] = now_iso()
                        candidates = imdb_poster_candidates(ident)
                        if candidates:
                            local = save_local_poster(ident, candidates)
                            if local:
                                new_record["poster_remote"] = candidates[0]
                                counts["posters_downloaded"] += 1
                new_record["poster_local"] = local
                new_record["poster_status"] = "local" if local else ("remote_only" if poster_url else "unavailable")
            else:
                if record and has_omdb_enrichment(record):
                    counts["stale_preserved"] += 1
                else:
                    counts["partial_records"] += 1
                if reason == "movie_not_found":
                    counts["omdb_not_found"] += 1
                counts["omdb_errors"] += 1
                new_record = merge_record(row, record, None, reason)
                errors.append(
                    {
                        "imdb_id": ident,
                        "title": row["title"],
                        "reason": reason,
                        "key": fingerprint(used_key) if used_key else "",
                    }
                )
            record = new_record
        else:
            counts["cache_reused"] += 1
            if record is None:
                record = merge_record(row, None, None, "cache_missing")
            else:
                record.update(row)
                if has_omdb_enrichment(record):
                    record["data_status"] = "cached"
            if reason_kind == "incomplete":
                counts["records_deferred_retry"] += 1

        # Reconcile local poster path one final time.
        final_local = local_poster_from_record(record, ident)
        record["poster_local"] = final_local
        record["poster_status"] = "local" if final_local else ("remote_only" if poster_candidates(record) else "unavailable")
        record["schema_record_version"] = 4
        output.append(record)

        if index % 100 == 0 or index == len(rows):
            log(
                f"progress={index}/{len(rows)} api={counts['api_attempts']} "
                f"success={counts['omdb_success']} cache={counts['cache_reused']} "
                f"stale={counts['stale_preserved']} partial={counts['partial_records']} "
                f"posters={counts['posters_downloaded']}"
            )

        time.sleep(0.02)

    if len(output) != len(rows):
        raise RuntimeError("تعداد خروجی با CSV برابر نیست؛ فایل قبلی حفظ شد.")

    finished = now_iso()
    duration = round((now_utc() - started_dt).total_seconds(), 2)
    key_state = update_key_state(state, pool)
    status = "healthy"
    if counts["omdb_errors"] or counts["partial_records"] or counts["posters_missing"]:
        status = "degraded"

    run = {
        "mode": "update",
        "started_at": started,
        "finished_at": finished,
        "duration_seconds": duration,
        "keys_detected": len(keys),
        "counts": counts,
        "keys": pool.summary(),
        "errors": errors[:MAX_ERRORS],
        "policy": {
            "cache_ttl_days": CACHE_TTL_DAYS,
            "incomplete_retry_hours": INCOMPLETE_RETRY_HOURS,
            "poster_retry_hours": POSTER_RETRY_HOURS,
            "monthly_refresh_only_for_complete_records": True,
            "failure_preservation": True,
            "repository_local_posters": True,
        },
    }

    system = {
        "schema_version": 4,
        "status": status,
        "message": "IMDb Showcase production pipeline diagnostics",
        "generated_at": finished,
        "run": run,
        "keys": pool.summary(),
        "errors": errors[:MAX_ERRORS],
    }

    payload = {
        "schema_version": 8,
        "last_manual_update": finished,
        "data_meta": {
            **(old_data.get("data_meta") if isinstance(old_data.get("data_meta"), dict) else {}),
            **counts,
            "output_records": len(output),
            "omdb_key_count": len(keys),
            "daily_budget_per_key": MAX_PER_KEY_PER_DAY,
            "cache_ttl_days": CACHE_TTL_DAYS,
            "shared_dataset": True,
            "local_posters_dir": "docs/posters",
        },
        "movies": output,
        "errors": errors[:MAX_ERRORS],
    }

    POSTERS.mkdir(parents=True, exist_ok=True)
    atomic_json_write(OUTPUT_PATH, payload)
    atomic_json_write(KEY_STATE_PATH, key_state)
    atomic_json_write(SYSTEM_STATUS_PATH, system)
    update_history(system)

    log(f"✅ movies.json written: {len(output)} records")
    log(json.dumps(counts, ensure_ascii=False))
    for row in pool.summary():
        log(
            f"🔐 {row['label']} [{row['fingerprint']}] "
            f"status={row['status']} run={row['requests_this_run']} "
            f"today={row['requests_today_total']}/{MAX_PER_KEY_PER_DAY}"
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("Pipeline stopped by user.", "WARN")
        raise SystemExit(130)
    except Exception as exc:
        log(f"❌ Pipeline failed: {type(exc).__name__}: {str(exc)[:500]}", "ERROR")
        try:
            atomic_json_write(
                SYSTEM_STATUS_PATH,
                {
                    "schema_version": 4,
                    "status": "error",
                    "message": "Pipeline crashed before completing the dataset.",
                    "generated_at": now_iso(),
                    "run": {"mode": "update", "error": str(exc)[:500]},
                    "keys": [],
                    "errors": [{"reason": type(exc).__name__, "message": str(exc)[:500]}],
                },
            )
        except Exception:
            pass
        raise SystemExit(1)
