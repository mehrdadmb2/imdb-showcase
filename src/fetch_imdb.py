import json
import os
import csv
import requests
from datetime import datetime
import sys
import traceback
from collections import defaultdict
import time

print("🚀 شروع فرآیند دریافت اطلاعات از فایل CSV...")

# ===== لیست کلیدهای OMDb (۴ کلید) =====
OMDB_KEYS = [
    '4243603a',   # کلید قبلی
    '47b7a160',   # جدید
    '963db753',   # جدید
    'bab92b09'    # جدید
]

# ===== مدیریت چرخشی کلیدها =====
current_key_index = 0
key_usage_count = {key: 0 for key in OMDB_KEYS}
MAX_REQUESTS_PER_KEY = 1000

def get_next_omdb_key():
    global current_key_index
    # پیدا کردن کلیدی که کمتر از ۱۰۰۰ درخواست استفاده شده
    for _ in range(len(OMDB_KEYS)):
        key = OMDB_KEYS[current_key_index]
        if key_usage_count[key] < MAX_REQUESTS_PER_KEY:
            current_key_index = (current_key_index + 1) % len(OMDB_KEYS)
            return key
        current_key_index = (current_key_index + 1) % len(OMDB_KEYS)
    # اگر همه کلیدها پر شده بودند
    print("⚠️ همه کلیدها به محدودیت روزانه رسیده‌اند!")
    return None

# ===== خواندن CSV =====
def read_csv():
    csv_file = 'ratings.csv'
    if not os.path.exists(csv_file):
        print(f"❌ فایل {csv_file} پیدا نشد!")
        return None
    
    print(f"📄 خواندن اطلاعات از فایل {csv_file}...")
    movies = []
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                imdb_id = row.get('Const', '').strip()
                if not imdb_id:
                    continue
                
                # تاریخ را به فرمت استاندارد تبدیل می‌کنیم
                date_rated = row.get('Date Rated', '').strip()
                if date_rated:
                    try:
                        # تاریخ به فرمت M/D/YYYY
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
                    'url': row.get('URL', '').strip(),
                    'title_type': row.get('Title Type', '').strip(),
                    'imdb_rating': row.get('IMDb Rating', '').strip(),
                    'runtime': row.get('Runtime (mins)', '').strip(),
                    'genres': row.get('Genres', '').strip(),
                    'num_votes': row.get('Num Votes', '').strip(),
                    'release_date': row.get('Release Date', '').strip(),
                    'directors': row.get('Directors', '').strip(),
                })
    except Exception as e:
        print(f"❌ خطا در خواندن CSV: {e}")
        traceback.print_exc()
        return None
    
    print(f"✅ {len(movies)} فیلم از CSV دریافت شد.")
    return movies

# ===== دریافت از OMDb با مدیریت کلیدها =====
omdb_cache = {}
omdb_success_count = 0
omdb_fail_count = 0

def fetch_omdb(imdb_id):
    global omdb_success_count, omdb_fail_count
    if imdb_id in omdb_cache:
        return omdb_cache[imdb_id]
    
    # دریافت کلید بعدی
    key = get_next_omdb_key()
    if not key:
        # همه کلیدها پر شده‌اند
        omdb_cache[imdb_id] = None
        return None
    
    url = f"http://www.omdbapi.com/?i={imdb_id}&apikey={key}"
    try:
        response = requests.get(url, timeout=10)
        key_usage_count[key] += 1
        if response.status_code == 200:
            data = response.json()
            if data.get('Response') == 'True':
                omdb_cache[imdb_id] = data
                omdb_success_count += 1
                return data
            else:
                # ممکن است فیلم در OMDb نباشد
                omdb_cache[imdb_id] = None
                omdb_fail_count += 1
                return None
        else:
            omdb_cache[imdb_id] = None
            omdb_fail_count += 1
            return None
    except Exception as e:
        print(f"⚠️ خطا در OMDb برای {imdb_id}: {e}")
        omdb_cache[imdb_id] = None
        omdb_fail_count += 1
        return None

# ===== پردازش نهایی =====
def process_movies(movies):
    print(f"🎬 پردازش {len(movies)} فیلم...")
    
    output = []
    total = len(movies)
    
    for idx, movie in enumerate(movies):
        print(f"⏳ {idx+1}/{total}: {movie['title']} - {movie['imdb_id']}")
        
        # اطلاعات پایه از CSV
        result = {
            'imdb_id': movie['imdb_id'],
            'title': movie['title'],
            'year': movie['year'],
            'user_rating': movie['user_rating'],
            'date_rated': movie['date_rated'],
            'title_type': movie['title_type'],
            'imdb_rating': movie['imdb_rating'] or 'N/A',
            'runtime': movie['runtime'] or 'N/A',
            'genres': movie['genres'] or 'N/A',
            'num_votes': movie['num_votes'] or 'N/A',
            'release_date': movie['release_date'] or 'N/A',
            'directors': movie['directors'] or 'N/A',
            'poster': '',
            'plot': 'N/A',
            'rated': 'N/A',
            'actors': 'N/A',
            'writer': 'N/A',
            'omdb_found': False
        }
        
        # تلاش برای دریافت از OMDb (فقط برای پوستر و خلاصه)
        omdb_data = fetch_omdb(movie['imdb_id'])
        if omdb_data:
            result['poster'] = omdb_data.get('Poster', '')
            result['plot'] = omdb_data.get('Plot', 'N/A')
            result['rated'] = omdb_data.get('Rated', 'N/A')
            result['actors'] = omdb_data.get('Actors', 'N/A')
            result['writer'] = omdb_data.get('Writer', 'N/A')
            # اگر اطلاعات CSV کامل‌تر بود، آن را نگه می‌داریم
            if not result['genres'] or result['genres'] == 'N/A':
                result['genres'] = omdb_data.get('Genre', 'N/A')
            if not result['imdb_rating'] or result['imdb_rating'] == 'N/A':
                result['imdb_rating'] = omdb_data.get('imdbRating', 'N/A')
            if not result['runtime'] or result['runtime'] == 'N/A':
                result['runtime'] = omdb_data.get('Runtime', 'N/A')
            if not result['directors'] or result['directors'] == 'N/A':
                result['directors'] = omdb_data.get('Director', 'N/A')
            result['omdb_found'] = True
        
        output.append(result)
    
    print(f"✅ OMDb موفق: {omdb_success_count} از {total} فیلم")
    print(f"⚠️ فیلم‌های بدون پوستر: {total - omdb_success_count} (از ایموجی استفاده می‌شود)")
    print(f"📊 وضعیت کلیدها:")
    for key, count in key_usage_count.items():
        print(f"   کلید {key}: {count} درخواست")
    
    return output

# ===== ذخیره در docs =====
def save_json(data):
    os.makedirs('../docs', exist_ok=True)
    with open('../docs/movies.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"✅ {len(data)} فیلم در docs/movies.json ذخیره شد.")
    print(f"🕐 زمان: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# ===== اجرا =====
def main():
    try:
        movies = read_csv()
        if not movies:
            print("❌ هیچ فیلمی دریافت نشد.")
            sys.exit(1)
        
        processed = process_movies(movies)
        save_json(processed)
        
    except Exception as e:
        print(f"❌ خطای کلی: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
