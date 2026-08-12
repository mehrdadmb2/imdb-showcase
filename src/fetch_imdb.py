import json
import os
import csv
import requests
from datetime import datetime
import sys
import time

print("🚀 شروع دریافت اطلاعات با ۴ کلید OMDb...")

# ===== دریافت لیست کلیدها از Secrets =====
omdb_keys_str = os.environ.get('OMDB_API_KEYS', '')
if not omdb_keys_str:
    # اگر متغیر جدید نبود، از قدیمی استفاده کن
    old_key = os.environ.get('OMDB_API_KEY', '')
    if old_key:
        omdb_keys_str = old_key
    else:
        print("❌ هیچ کلید OMDb تنظیم نشده!")
        sys.exit(1)

OMDB_KEYS = [k.strip() for k in omdb_keys_str.split(',') if k.strip()]
print(f"✅ {len(OMDB_KEYS)} کلید OMDb شناسایی شد.")

if not OMDB_KEYS:
    print("❌ کلید معتبری پیدا نشد!")
    sys.exit(1)

# ===== مدیریت چرخشی کلیدها =====
current_key_index = 0
key_usage = {key: 0 for key in OMDB_KEYS}
MAX_PER_KEY = 1000

def get_next_key():
    global current_key_index
    for _ in range(len(OMDB_KEYS)):
        key = OMDB_KEYS[current_key_index]
        if key_usage[key] < MAX_PER_KEY:
            current_key_index = (current_key_index + 1) % len(OMDB_KEYS)
            return key
        current_key_index = (current_key_index + 1) % len(OMDB_KEYS)
    print("⚠️ همه کلیدها پر شدند!")
    return None

# ===== خواندن CSV =====
def read_csv():
    csv_file = 'ratings.csv'
    if not os.path.exists(csv_file):
        print(f"❌ فایل {csv_file} پیدا نشد!")
        return None

    print(f"📄 خواندن {csv_file}...")
    movies = []
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            imdb_id = row.get('Const', '').strip()
            if not imdb_id:
                continue
            # تاریخ را تبدیل می‌کنیم
            date_rated = row.get('Date Rated', '').strip()
            if date_rated:
                try:
                    parts = date_rated.split('/')
                    if len(parts) == 3:
                        date_rated = f"{parts[2]}-{parts[0].zfill(2)}-{parts[1].zfill(2)}"
                except:
                    pass
            movies.append({
                'imdb_id': imdb_id,
                'title': row.get('Title', '').strip(),
                'year': row.get('Year', '').strip(),
                'user_rating': float(row.get('Your Rating', 0) or 0),
                'date_rated': date_rated,
                'title_type': row.get('Title Type', '').strip(),
                'imdb_rating': row.get('IMDb Rating', '').strip(),
                'runtime': row.get('Runtime (mins)', '').strip(),
                'genres': row.get('Genres', '').strip(),
                'num_votes': row.get('Num Votes', '').strip(),
                'release_date': row.get('Release Date', '').strip(),
                'directors': row.get('Directors', '').strip(),
            })
    print(f"✅ {len(movies)} فیلم از CSV دریافت شد.")
    return movies

# ===== دریافت از OMDb =====
omdb_cache = {}
success_count = 0
fail_count = 0

def fetch_omdb(imdb_id):
    global success_count, fail_count
    if imdb_id in omdb_cache:
        return omdb_cache[imdb_id]

    key = get_next_key()
    if not key:
        omdb_cache[imdb_id] = None
        return None

    url = f"http://www.omdbapi.com/?i={imdb_id}&apikey={key}"
    try:
        resp = requests.get(url, timeout=10)
        key_usage[key] += 1
        if resp.status_code == 200:
            data = resp.json()
            if data.get('Response') == 'True':
                omdb_cache[imdb_id] = data
                success_count += 1
                return data
        fail_count += 1
        omdb_cache[imdb_id] = None
        return None
    except:
        fail_count += 1
        omdb_cache[imdb_id] = None
        return None

# ===== پردازش =====
def process_movies(movies):
    total = len(movies)
    print(f"🎬 پردازش {total} فیلم...")

    output = []
    for idx, m in enumerate(movies):
        print(f"⏳ {idx+1}/{total}: {m['title']}")

        result = {
            'imdb_id': m['imdb_id'],
            'title': m['title'],
            'year': m['year'],
            'user_rating': m['user_rating'],
            'date_rated': m['date_rated'],
            'title_type': m['title_type'],
            'imdb_rating': m['imdb_rating'] or 'N/A',
            'runtime': m['runtime'] or 'N/A',
            'genres': m['genres'] or 'N/A',
            'num_votes': m['num_votes'] or 'N/A',
            'release_date': m['release_date'] or 'N/A',
            'directors': m['directors'] or 'N/A',
            'poster': '',
            'plot': 'N/A',
            'rated': 'N/A',
            'actors': 'N/A',
            'writer': 'N/A',
            'omdb_found': False
        }

        # OMDb
        omdb = fetch_omdb(m['imdb_id'])
        if omdb:
            result['poster'] = omdb.get('Poster', '')
            result['plot'] = omdb.get('Plot', 'N/A')
            result['rated'] = omdb.get('Rated', 'N/A')
            result['actors'] = omdb.get('Actors', 'N/A')
            result['writer'] = omdb.get('Writer', 'N/A')
            if result['genres'] == 'N/A':
                result['genres'] = omdb.get('Genre', 'N/A')
            if result['imdb_rating'] == 'N/A':
                result['imdb_rating'] = omdb.get('imdbRating', 'N/A')
            if result['runtime'] == 'N/A':
                result['runtime'] = omdb.get('Runtime', 'N/A')
            if result['directors'] == 'N/A':
                result['directors'] = omdb.get('Director', 'N/A')
            result['omdb_found'] = True

        output.append(result)

    print(f"✅ OMDb موفق: {success_count} از {total}")
    print(f"📊 وضعیت کلیدها:")
    for k, v in key_usage.items():
        print(f"   {k}: {v} درخواست")
    return output

# ===== ذخیره =====
def save_json(data):
    os.makedirs('../docs', exist_ok=True)
    with open('../docs/movies.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"✅ {len(data)} فیلم در docs/movies.json ذخیره شد.")
    print(f"🕐 {datetime.now()}")

# ===== اجرا =====
def main():
    movies = read_csv()
    if not movies:
        sys.exit(1)
    output = process_movies(movies)
    save_json(output)

if __name__ == '__main__':
    main()
