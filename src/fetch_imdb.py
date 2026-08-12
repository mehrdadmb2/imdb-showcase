import json
import os
import re
import csv
import cloudscraper
from bs4 import BeautifulSoup
from datetime import datetime
import sys
import traceback

print("🚀 شروع فرآیند دریافت اطلاعات...")

# دریافت کوکی‌ها از Environment Variable
cookies_str = os.environ.get('IMDB_COOKIES', '')
OMDB_API_KEY = os.environ.get('OMDB_API_KEY', '')

if not OMDB_API_KEY:
    print("❌ خطا: کلید OMDb API تنظیم نشده است.")
    sys.exit(1)

# تبدیل کوکی‌ها به دیکشنری
cookies = {}
if cookies_str:
    for item in cookies_str.split(';'):
        item = item.strip()
        if '=' in item:
            key, value = item.split('=', 1)
            cookies[key.strip()] = value.strip()
    print(f"✅ {len(cookies)} کوکی شناسایی شد.")
else:
    print("⚠️ کوکی‌ها تنظیم نشده‌اند. از روش CSV استفاده می‌شود.")

# ===== تنظیمات cloudscraper =====
scraper = cloudscraper.create_scraper(
    browser={
        'browser': 'chrome',
        'platform': 'windows',
        'mobile': False
    }
)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,fa;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
}

# ===== بخش ۱: تلاش برای دریافت از IMDb با کوکی =====
def try_fetch_from_imdb():
    """تلاش برای دریافت اطلاعات از IMDb با استفاده از کوکی‌ها"""
    if not cookies:
        print("⚠️ کوکی وجود ندارد. از روش CSV استفاده می‌شود.")
        return None
    
    print("📡 تلاش برای دریافت اطلاعات از IMDb با کوکی...")
    
    try:
        # ابتدا به صفحه اصلی می‌رویم
        print("   مرحله 1: اتصال به صفحه اصلی...")
        response = scraper.get('https://www.imdb.com/', headers=HEADERS, cookies=cookies, timeout=30)
        if response.status_code != 200:
            print(f"   ❌ صفحه اصلی پاسخ نداد: {response.status_code}")
            return None
        print("   ✅ صفحه اصلی بارگذاری شد.")
        
        # تلاش با آدرس‌های مختلف برای Ratings
        urls = [
            'https://www.imdb.com/list/ratings',
            'https://www.imdb.com/user/ur0/ratings',
            'https://www.imdb.com/ratings',
        ]
        
        for url in urls:
            print(f"   مرحله 2: تلاش برای {url}...")
            response = scraper.get(url, headers=HEADERS, cookies=cookies, timeout=30)
            if response.status_code != 200:
                print(f"   ❌ {url} پاسخ نداد: {response.status_code}")
                continue
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # جستجوی آیتم‌های فیلم
            items = soup.select('.lister-item')
            if not items:
                items = soup.select('[data-testid="list-item"]')
            if not items:
                items = soup.select('.ipc-list-card')
            
            if items:
                print(f"   ✅ {len(items)} فیلم در {url} پیدا شد.")
                return extract_movies_from_items(items)
            else:
                print(f"   ⚠️ در {url} فیلمی پیدا نشد.")
        
        print("❌ هیچ فیلمی از IMDb دریافت نشد.")
        return None
        
    except Exception as e:
        print(f"❌ خطا در دریافت از IMDb: {e}")
        traceback.print_exc()
        return None

def extract_movies_from_items(items):
    """استخراج اطلاعات فیلم‌ها از آیتم‌های HTML"""
    movies = []
    for item in items:
        try:
            title_link = item.select_one('a[href*="/title/tt"]')
            if not title_link:
                title_link = item.select_one('.lister-item-header a')
            if not title_link:
                continue
            
            imdb_id_match = re.search(r'tt(\d+)', title_link.get('href', ''))
            if not imdb_id_match:
                continue
            
            imdb_id = f"tt{imdb_id_match.group(1)}"
            title = title_link.text.strip()
            
            rating_elem = item.select_one('.ipl-rating-star .ipl-rating-star__rating')
            if not rating_elem:
                rating_elem = item.select_one('[data-testid="rating-star"]')
            user_rating = rating_elem.text.strip() if rating_elem else "N/A"
            
            year_elem = item.select_one('.lister-item-year')
            if not year_elem:
                year_elem = item.select_one('[data-testid="release-date"]')
            year = year_elem.text.strip().replace('(', '').replace(')', '') if year_elem else "N/A"
            
            movies.append({
                'imdb_id': imdb_id,
                'title': title,
                'year': year,
                'user_rating': float(user_rating) if user_rating != 'N/A' else 0
            })
        except Exception as e:
            print(f"⚠️ خطا در پردازش یک آیتم: {e}")
            continue
    return movies

# ===== بخش ۲: خواندن از فایل CSV =====
def try_fetch_from_csv():
    """خواندن اطلاعات از فایل CSV"""
    csv_file = 'ratings.csv'
    if not os.path.exists(csv_file):
        print(f"⚠️ فایل {csv_file} پیدا نشد.")
        return None
    
    print(f"📄 خواندن اطلاعات از فایل {csv_file}...")
    movies = []
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                imdb_id = row.get('Const', '')
                if not imdb_id:
                    continue
                
                title = row.get('Title', '')
                year = row.get('Year', '')
                user_rating = row.get('Your Rating', '')
                
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
        return None
    
    if movies:
        print(f"✅ {len(movies)} فیلم از CSV دریافت شد.")
    return movies

# ===== بخش ۳: دریافت جزئیات از OMDb API =====
def fetch_omdb_details(imdb_id, api_key):
    """دریافت جزئیات فیلم از OMDb API"""
    url = f"http://www.omdbapi.com/?i={imdb_id}&apikey={api_key}"
    try:
        import requests
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

# ===== بخش ۴: ذخیره نهایی =====
def save_movies(movies):
    """ذخیره فیلم‌ها در فایل JSON در پوشه public"""
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
                'rated': details.get('rated', 'N/A')
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
                'rated': 'N/A'
            })
    
    # اطمینان از وجود پوشه public
    os.makedirs('../public', exist_ok=True)
    
    # ذخیره در فایل JSON
    with open('../public/movies.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"✅ {len(output)} فیلم با موفقیت ذخیره شد.")
    print(f"📁 مسیر: public/movies.json")
    print(f"🕐 زمان به‌روزرسانی: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# ===== اجرای اصلی =====
def main():
    try:
        # تلاش برای دریافت از IMDb با کوکی
        movies = try_fetch_from_imdb()
        
        # اگر از IMDb دریافت نشد، از CSV بخوان
        if not movies:
            print("🔄 تلاش برای دریافت از فایل CSV...")
            movies = try_fetch_from_csv()
        
        # اگر هیچکدام کار نکرد، خطا بده
        if not movies:
            print("❌ هیچ فیلمی از هیچ منبعی دریافت نشد.")
            print("💡 لطفاً یکی از این کارها را انجام دهید:")
            print("   1. کوکی‌های معتبر را در Secrets تنظیم کنید.")
            print("   2. فایل ratings.csv را در پوشه src قرار دهید.")
            sys.exit(1)
        
        # ذخیره در public/movies.json
        save_movies(movies)
        
    except Exception as e:
        print(f"❌ خطای کلی: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
