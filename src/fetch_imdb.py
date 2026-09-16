import csv
import json
import os
import re
import sys
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
DOCS = REPO_ROOT / 'docs'
POSTERS = DOCS / 'posters'
CSV_PATH = ROOT / 'ratings.csv'
OUTPUT_PATH = DOCS / 'movies.json'

TIMEOUT = 15
POSTER_TIMEOUT = 20
CACHE_TTL_DAYS = 30
MAX_REQUESTS_PER_KEY_PER_RUN = 950
POSTER_MAX_SIZE = (900, 1350)
POSTER_QUALITY = 78

session = requests.Session()
session.headers.update({
    'User-Agent': 'IMDb-Showcase/9.0 (+https://github.com/mehrdadmb2/imdb-showcase)'
})


def log(message: str) -> None:
    print(message, flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).strip().replace('Z', '+00:00')
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def days_old(value: Any) -> float:
    dt = parse_iso(value)
    if not dt:
        return float('inf')
    return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 86400)


def clean(value: Any, fallback: str = '') -> str:
    if value is None:
        return fallback
    text = str(value).replace('\x00', '').strip()
    if not text or text.upper() == 'N/A':
        return fallback
    return text


def number(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return default


def read_old_data() -> dict:
    if not OUTPUT_PATH.exists():
        return {'schema_version': 5, 'movies': [], 'data_meta': {}}
    try:
        data = json.loads(OUTPUT_PATH.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {'movies': []}
    except Exception as exc:
        log(f'⚠️ فایل قبلی قابل خواندن نیست: {exc}')
        return {'movies': []}


def read_csv() -> list[dict]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f'{CSV_PATH} پیدا نشد.')
    rows: list[dict] = []
    with CSV_PATH.open('r', encoding='utf-8-sig', newline='') as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError('CSV فاقد header است.')
        for row in reader:
            imdb_id = clean(row.get('Const'))
            if not imdb_id:
                continue
            raw = {str(k): ('' if v is None else str(v).strip()) for k, v in row.items()}
            rows.append({
                'imdb_id': imdb_id,
                'title': clean(row.get('Title'), 'Untitled'),
                'original_title': clean(row.get('Original Title'), clean(row.get('Title'), 'Untitled')),
                'year': clean(row.get('Year')),
                'user_rating': number(row.get('Your Rating')),
                'date_rated': clean(row.get('Date Rated')),
                'title_type': clean(row.get('Title Type'), 'Other'),
                'imdb_rating': clean(row.get('IMDb Rating')),
                'runtime': clean(row.get('Runtime (mins)')),
                'genres': clean(row.get('Genres')),
                'num_votes': clean(row.get('Num Votes')),
                'release_date': clean(row.get('Release Date')),
                'directors': clean(row.get('Directors')),
                'url': clean(row.get('URL')),
                'raw_csv': raw,
            })
    if not rows:
        raise ValueError('CSV خوانده شد اما هیچ رکوردی ندارد.')
    return rows


def load_keys() -> list[str]:
    # OMDB_API_KEYS is the preferred comprehensive secret.
    combined = os.getenv('OMDB_API_KEYS', '')
    candidates = []
    if combined:
        candidates.extend(re.split(r'[;,\s]+', combined.strip()))
    # Also accept the legacy single secret and optional split secrets.
    for name in ('OMDB_API_KEY_1', 'OMDB_API_KEY_2', 'OMDB_API_KEY_3', 'OMDB_API_KEY_4', 'OMDB_API_KEY'):
        value = os.getenv(name, '').strip()
        if value:
            candidates.append(value)
    return list(dict.fromkeys(x.strip() for x in candidates if x.strip()))


class KeyPool:
    def __init__(self, keys: list[str]):
        self.keys = keys
        self.index = 0
        self.usage = {k: 0 for k in keys}
        self.disabled: set[str] = set()

    def next(self) -> str | None:
        if not self.keys:
            return None
        for _ in range(len(self.keys)):
            key = self.keys[self.index]
            self.index = (self.index + 1) % len(self.keys)
            if key in self.disabled:
                continue
            if self.usage[key] < MAX_REQUESTS_PER_KEY_PER_RUN:
                return key
        return None

    def disable(self, key: str) -> None:
        self.disabled.add(key)


def fetch_omdb(imdb_id: str, pool: KeyPool) -> tuple[dict | None, str, str | None]:
    while True:
        key = pool.next()
        if not key:
            return None, 'all-keys-exhausted', None
        try:
            response = session.get(
                'https://www.omdbapi.com/',
                params={'i': imdb_id, 'apikey': key, 'plot': 'full'},
                timeout=TIMEOUT,
            )
            pool.usage[key] += 1
            if response.status_code in (401, 403, 429):
                pool.disable(key)
                log(f'⚠️ کلید OMDb غیرفعال شد ({response.status_code}). کلید بعدی...')
                continue
            if response.status_code != 200:
                return None, f'http-{response.status_code}', key
            data = response.json()
            if data.get('Response') == 'True':
                return data, 'ok', key
            error = clean(data.get('Error'), 'omdb-failed')
            if 'limit' in error.lower() or 'request' in error.lower() and 'limit' in error.lower():
                pool.disable(key)
                continue
            return None, error, key
        except requests.RequestException as exc:
            pool.usage[key] += 1
            return None, f'network:{type(exc).__name__}', key


def fetch_imdb_poster_url(imdb_id: str) -> str:
    headers = {}
    cookie = os.getenv('IMDB_COOKIES', '').strip()
    if cookie:
        headers['Cookie'] = cookie
    try:
        response = session.get(
            f'https://www.imdb.com/title/{imdb_id}/',
            headers=headers,
            timeout=TIMEOUT,
        )
        if response.status_code != 200:
            return ''
        soup = BeautifulSoup(response.text, 'html.parser')
        tag = soup.find('meta', property='og:image')
        return clean(tag.get('content') if tag else '')
    except requests.RequestException:
        return ''


def poster_filename(imdb_id: str) -> Path:
    safe_id = re.sub(r'[^A-Za-z0-9._-]', '', imdb_id) or 'unknown'
    return POSTERS / f'{safe_id}.webp'


def save_local_poster(imdb_id: str, poster_url: str) -> str:
    if not poster_url or poster_url in ('N/A', 'False'):
        return ''
    target = poster_filename(imdb_id)
    if target.exists() and target.stat().st_size > 500:
        return f'posters/{target.name}'
    try:
        response = session.get(poster_url, timeout=POSTER_TIMEOUT, stream=True)
        response.raise_for_status()
        content_type = (response.headers.get('content-type') or '').lower()
        raw = response.content
        if len(raw) < 500:
            return ''
        if 'image' not in content_type and not poster_url.lower().split('?')[0].endswith(('.jpg', '.jpeg', '.png', '.webp')):
            return ''
        image = Image.open(BytesIO(raw)).convert('RGB')
        image.thumbnail(POSTER_MAX_SIZE, Image.Resampling.LANCZOS)
        POSTERS.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix('.tmp.webp')
        image.save(tmp, 'WEBP', quality=POSTER_QUALITY, method=6)
        if tmp.stat().st_size < 500:
            tmp.unlink(missing_ok=True)
            return ''
        tmp.replace(target)
        return f'posters/{target.name}'
    except Exception as exc:
        log(f'⚠️ ذخیره پوستر {imdb_id} ناموفق بود: {exc}')
        return ''


def record_has_enough_info(record: dict) -> bool:
    # A title is considered cache-complete when the OMDb enrichment is present
    # and the local poster has been successfully cached. A missing poster URL
    # does not force endless API calls if OMDb itself has no poster.
    raw = record.get('raw_omdb') or {}
    enriched = bool(record.get('omdb_found') or raw.get('imdbID'))
    core = sum(bool(clean(record.get(k))) for k in ('plot', 'actors', 'writer', 'country', 'language', 'awards'))
    poster_ok = bool(clean(record.get('poster_local')) or clean(record.get('poster')))
    return enriched and core >= 2 and poster_ok


def merge_record(csv_row: dict, old: dict | None, omdb: dict | None, reason: str, refreshed: bool) -> tuple[dict, bool]:
    base = deepcopy(old) if old else {}
    base.update(csv_row)
    changed = old is None

    if omdb:
        fields = {
            'poster': clean(omdb.get('Poster')),
            'plot': clean(omdb.get('Plot')),
            'rated': clean(omdb.get('Rated')),
            'actors': clean(omdb.get('Actors')),
            'writer': clean(omdb.get('Writer')),
            'country': clean(omdb.get('Country')),
            'language': clean(omdb.get('Language')),
            'awards': clean(omdb.get('Awards')),
            'box_office': clean(omdb.get('BoxOffice')),
            'production': clean(omdb.get('Production')),
            'website': clean(omdb.get('Website')),
            'metascore': clean(omdb.get('Metascore')),
            'ratings': omdb.get('Ratings') if isinstance(omdb.get('Ratings'), list) else [],
            'series_id': clean(omdb.get('seriesID')),
            'series_title': clean(omdb.get('series')),
            'season_number': int(number(omdb.get('Season'))),
            'episode_number': int(number(omdb.get('Episode'))),
            'episode_title': clean(omdb.get('Title'), csv_row['title']),
            'total_seasons': int(number(omdb.get('totalSeasons'))),
            'is_episode': csv_row['title_type'] == 'TV Episode' or bool(omdb.get('Episode')),
            'raw_omdb': omdb,
            'omdb_found': True,
            'data_status': 'fresh',
            'data_fetched_at': utc_now(),
            'data_stale_reason': '',
            'cache_updated_at': utc_now(),
        }
        for key, omdb_key in {
            'imdb_rating': 'imdbRating', 'num_votes': 'imdbVotes', 'runtime': 'Runtime',
            'directors': 'Director', 'genres': 'Genre', 'release_date': 'Released'
        }.items():
            if not clean(base.get(key)):
                fields[key] = clean(omdb.get(omdb_key))
        for key, value in fields.items():
            if value not in ('', None, [], {}) or key in ('ratings', 'raw_omdb'):
                if base.get(key) != value:
                    changed = True
                base[key] = value
        return base, changed

    # Failure: retain old enrichment and explicitly mark it stale only if an
    # old enriched record exists. Never erase old poster/info.
    if old:
        base['data_status'] = 'stale'
        base['data_stale_reason'] = reason
        base['omdb_found'] = bool(old.get('omdb_found') or old.get('raw_omdb'))
        if old.get('data_fetched_at'):
            base['data_fetched_at'] = old['data_fetched_at']
        return base, False

    # New record without enrichment: keep CSV data; it will be retried later.
    base.update({
        'poster': '', 'plot': '', 'rated': '', 'actors': '', 'writer': '', 'country': '',
        'language': '', 'awards': '', 'box_office': '', 'production': '', 'metascore': '',
        'website': '', 'ratings': [], 'raw_omdb': {}, 'poster_local': '',
        'omdb_found': False, 'data_status': 'partial', 'data_stale_reason': reason,
        'data_fetched_at': '', 'cache_updated_at': '',
    })
    return base, True


def main() -> None:
    log('🚀 IMDb Showcase — resilient monthly cache pipeline')
    old_data = read_old_data()
    old_map = {m.get('imdb_id'): m for m in old_data.get('movies', []) if m.get('imdb_id')}
    rows = read_csv()
    keys = load_keys()
    if not keys:
        raise RuntimeError('هیچ OMDB API Key پیدا نشد. Secret مربوط به OMDB_API_KEYS را تنظیم کن.')

    pool = KeyPool(keys)
    output: list[dict] = []
    fresh = cached = stale = partial = api_attempts = poster_saved = 0
    errors: list[dict] = []

    log(f'✅ {len(keys)} کلید OMDb شناسایی شد.')
    log(f'📚 {len(rows)} رکورد CSV شناسایی شد.')

    for index, row in enumerate(rows, 1):
        imdb_id = row['imdb_id']
        old = old_map.get(imdb_id)
        age = days_old((old or {}).get('cache_updated_at') or (old or {}).get('data_fetched_at'))
        complete = bool(old and record_has_enough_info(old))
        needs_api = old is None or (not complete) or age >= CACHE_TTL_DAYS
        record = None
        status = 'cached'

        # First repair local poster directly from the cached external URL or old raw OMDb;
        # this does NOT consume an OMDb API request.
        if old and not clean(old.get('poster_local')):
            poster_url = clean(old.get('poster')) or clean((old.get('raw_omdb') or {}).get('Poster'))
            if poster_url:
                local = save_local_poster(imdb_id, poster_url)
                if local:
                    old = deepcopy(old)
                    old['poster_local'] = local
                    poster_saved += 1
                    changed_local = True
                else:
                    changed_local = False
            else:
                changed_local = False
        else:
            changed_local = False

        if needs_api:
            api_attempts += 1
            omdb, reason, used_key = fetch_omdb(imdb_id, pool)
            record, changed = merge_record(row, old, omdb, reason, age >= CACHE_TTL_DAYS)
            if omdb:
                fresh += 1
                poster_url = clean(omdb.get('Poster'))
                local = save_local_poster(imdb_id, poster_url)
                if local:
                    if record.get('poster_local') != local:
                        poster_saved += 1
                    record['poster_local'] = local
                elif old and old.get('poster_local'):
                    record['poster_local'] = old['poster_local']
            else:
                if old:
                    stale += 1
                else:
                    partial += 1
                errors.append({'imdb_id': imdb_id, 'title': row['title'], 'reason': reason})
        else:
            record = deepcopy(old)
            record.update(row)  # rating/date/title changes from CSV are always current.
            record['data_status'] = 'cached'
            changed = changed_local or record.get('poster_local') != old.get('poster_local')
            cached += 1

        # When monthly refresh fails, preserve the previous successful timestamp and data.
        if old and record.get('data_status') in ('stale', 'cached'):
            record['cache_updated_at'] = old.get('cache_updated_at') or old.get('data_fetched_at', '')

        output.append(record)

        if index % 100 == 0 or index == len(rows):
            log(f'⏳ {index}/{len(rows)} | fresh={fresh} cached={cached} stale={stale} partial={partial} posters={poster_saved}')
        time.sleep(0.03)

    now = utc_now()
    payload = {
        'schema_version': 5,
        'last_manual_update': now,
        'data_meta': {
            'generated_at': now,
            'source_csv_records': len(rows),
            'output_records': len(output),
            'omdb_fresh': fresh,
            'cache_reused': cached,
            'omdb_stale': stale,
            'omdb_partial': partial,
            'api_attempts': api_attempts,
            'local_posters_saved': poster_saved,
            'cache_ttl_days': CACHE_TTL_DAYS,
            'policy': 'use_local_cache_until_30_days_old; retry_new_or_incomplete; preserve_previous_on_failure',
            'omdb_key_count': len(keys),
            'omdb_key_usage': pool.usage,
            'disabled_keys': len(pool.disabled),
        },
        'movies': output,
        'errors': errors[:150],
    }

    DOCS.mkdir(parents=True, exist_ok=True)
    POSTERS.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT_PATH.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(OUTPUT_PATH)
    log(f'✅ Dataset ذخیره شد: {OUTPUT_PATH}')
    log(f'📊 fresh={fresh} cached={cached} stale={stale} partial={partial} api_attempts={api_attempts} posters={poster_saved}')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        log(f'❌ Pipeline شکست خورد؛ فایل movies.json قبلی دست‌نخورده ماند: {exc}')
        sys.exit(1)
