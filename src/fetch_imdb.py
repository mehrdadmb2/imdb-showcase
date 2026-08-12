import json
import os
import csv
import requests
from datetime import datetime
import sys
import traceback

print("🚀 شروع فرآیند دریافت اطلاعات از فایل CSV...")

# دریافت کلید OMDb API
OMDB_API_KEY = os.environ.get('OMDB_API_KEY', '')
if not OMDB_API_KEY:
    print("❌ خطا: کلید OMDb API تنظیم نشده است.")
    sys.exit(1)

# ===== خواندن از فایل CSV =====
def read_csv_file():
    """خواندن اطلاعات از فایل CSV خروجی IMDb"""
    csv_file = 'ratings.csv'
    if not os.path.exists(csv_file):
        print(f"❌ فایل {csv_file} پیدا نشد!")
        return None
    
    print(f"📄 خواندن اطلاعات از فایل {csv_file}...")
    movies = []
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            # نمایش نام ستون‌ها برای دیباگ
            print(f"📋 ستون‌های فایل CSV: {', '.join(reader.fieldnames)}")
            
            for row in reader:
                imdb_id = row.get('Const', '').strip()
                if not imdb_id:
                    continue
                
                title = row.get('Title', '').strip()
                year = row.get('Year', '').strip()
                user_rating = row.get('Your Rating', '').strip()
                
                try:
                    user_rating = float(user_rating) if user_rating else 0
                except:
                    user_rating = 0
                
                movies.append({
                    'imdb_id': imdb_id,
                    'title': title,
                    'year': year,
                    'user_rating': user_rating
                })
    except Exception as e:
        print(f"❌ خطا در خواندن CSV: {e}")
        traceback.print_exc()
        return None
    
    if movies:
        print(f"✅ {len(movies)} فیلم از CSV دریافت شد.")
        return movies
    else:
        print("⚠️ فایل CSV خالی است یا فرمت آن صحیح نیست.")
        return None

# ===== دریافت جزئیات از OMDb API =====
def fetch_omdb_details(imdb_id, api_key):
    """دریافت جزئیات فیلم از OMDb API"""
    url = f"http://www.omdbapi.com/?i={imdb_id}&apikey={api_key}"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get('Response') == 'True':
                return {
                    'title': data.get('Title', ''),
                    'year': data.get('Year', ''),
                    'rated': data.get('Rated', 'N/A'),
                    'released': data.get('Released', 'N/A'),
                    'runtime': data.get('Runtime', 'N/A'),
                    'genre': data.get('Genre', 'N/A'),
                    'director': data.get('Director', 'N/A'),
                    'writer': data.get('Writer', 'N/A'),
                    'actors': data.get('Actors', 'N/A'),
                    'plot': data.get('Plot', 'N/A'),
                    'poster': data.get('Poster', 'N/A'),
                    'imdb_rating': data.get('imdbRating', 'N/A'),
                    'imdb_votes': data.get('imdbVotes', 'N/A')
                }
    except Exception as e:
        print(f"⚠️ خطا در OMDb برای {imdb_id}: {e}")
    return None

# ===== ذخیره در پوشه docs =====
def save_movies(movies):
    """ذخیره فیلم‌ها در فایل JSON در پوشه docs"""
    print(f"🎬 دریافت جزئیات {len(movies)} فیلم از OMDb API...")
    
    output = []
    total = len(movies)
    
    for idx, movie in enumerate(movies):
        print(f"⏳ {idx+1}/{total}: {movie['title']} - {movie['imdb_id']}")
        
        details = fetch_omdb_details(movie['imdb_id'], OMDB_API_KEY)
        
        if details:
            output.append({
                'imdb_id': movie['imdb_id'],
                'title': details.get('title', movie['title']),
                'year': details.get('year', movie['year']),
                'user_rating': movie['user_rating'],
                'imdb_rating': details.get('imdb_rating', 'N/A'),
                'genre': details.get('genre', 'N/A'),
                'director': details.get('director', 'N/A'),
                'actors': details.get('actors', 'N/A'),
                'plot': details.get('plot', 'N/A'),
                'poster': details.get('poster', ''),
                'runtime': details.get('runtime', 'N/A'),
                'rated': details.get('rated', 'N/A'),
                'released': details.get('released', 'N/A'),
                'imdb_votes': details.get('imdb_votes', 'N/A')
            })
        else:
            output.append({
                'imdb_id': movie['imdb_id'],
                'title': movie['title'],
                'year': movie['year'],
                'user_rating': movie['user_rating'],
                'imdb_rating': 'N/A',
                'genre': 'N/A',
                'director': 'N/A',
                'actors': 'N/A',
                'plot': 'N/A',
                'poster': '',
                'runtime': 'N/A',
                'rated': 'N/A',
                'released': 'N/A',
                'imdb_votes': 'N/A'
            })
    
    os.makedirs('../docs', exist_ok=True)
    
    with open('../docs/movies.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"✅ {len(output)} فیلم با موفقیت ذخیره شد.")
    print(f"📁 مسیر: docs/movies.json")
    print(f"🕐 زمان به‌روزرسانی: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# ===== اجرای اصلی =====
def main():
    try:
        movies = read_csv_file()
        
        if not movies:
            print("❌ هیچ فیلمی دریافت نشد.")
            print("💡 لطفاً فایل ratings.csv را در پوشه src قرار دهید.")
            sys.exit(1)
        
        save_movies(movies)
        
    except Exception as e:
        print(f"❌ خطای کلی: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
