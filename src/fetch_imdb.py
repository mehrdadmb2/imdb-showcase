import json
import os
import re
import cloudscraper
from bs4 import BeautifulSoup
from datetime import datetime
import sys
import traceback

print("🚀 شروع فرآیند دریافت اطلاعات با cloudscraper...")

# دریافت کوکی‌ها از Environment Variable
cookies_str = os.environ.get('IMDB_COOKIES', '')
if not cookies_str:
    print("❌ خطا: کوکی‌ها در IMDB_COOKIES تنظیم نشده‌اند.")
    sys.exit(1)

# دریافت کلید OMDb API
OMDB_API_KEY = os.environ.get('OMDB_API_KEY', '')
if not OMDB_API_KEY:
    print("❌ خطا: کلید OMDb API تنظیم نشده است.")
    sys.exit(1)

# تبدیل کوکی‌ها به دیکشنری
cookies = {}
for item in cookies_str.split(';'):
    item = item.strip()
    if '=' in item:
        key, value = item.split('=', 1)
        cookies[key.strip()] = value.strip()

print(f"✅ {len(cookies)} کوکی شناسایی شد.")

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

def test_imdb_connection():
    """تست اتصال به IMDb با آدرس‌های به‌روز"""
    try:
        print("📡 مرحله 1: اتصال به صفحه اصلی IMDb...")
        response = scraper.get('https://www.imdb.com/', headers=HEADERS, cookies=cookies, timeout=30)
        print(f"   وضعیت: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ خطا در صفحه اصلی: {response.status_code}")
            return False
        
        print("✅ صفحه اصلی با موفقیت بارگذاری شد.")
        
        # آدرس جدید صفحه Ratings (آزمایش با چند گزینه)
        ratings_urls = [
            'https://www.imdb.com/ratings',  # آدرس جدید اصلی
            'https://www.imdb.com/user/ratings',  # آدرس جایگزین
            'https://www.imdb.com/list/ratings',  # آدرس جایگزین دیگر
        ]
        
        for url in ratings_urls:
            print(f"📡 مرحله 2: تست آدرس {url}...")
            response = scraper.get(url, headers=HEADERS, cookies=cookies, timeout=30)
            print(f"   وضعیت: {response.status_code}")
            
            if response.status_code == 200:
                print(f"✅ آدرس {url} با موفقیت بارگذاری شد.")
                return True
            elif response.status_code == 404:
                print(f"⚠️ آدرس {url} موجود نیست (404).")
            else:
                print(f"⚠️ آدرس {url} وضعیت {response.status_code} داد.")
        
        print("❌ هیچ آدرسی برای صفحه Ratings کار نکرد.")
        return False
            
    except Exception as e:
        print(f"❌ خطا در اتصال: {e}")
        traceback.print_exc()
        return False

def get_imdb_ratings():
    """دریافت لیست فیلم‌های امتیاز داده شده از IMDb با آدرس جدید"""
    all_movies = []
    
    # آدرس‌های احتمالی برای صفحه Ratings
    base_urls = [
        'https://www.imdb.com/ratings',
        'https://www.imdb.com/user/ratings',
    ]
    
    for base_url in base_urls:
        print(f"📥 تلاش با آدرس: {base_url}")
        try:
            response = scraper.get(base_url, headers=HEADERS, cookies=cookies, timeout=30)
            
            if response.status_code != 200:
                print(f"⚠️ آدرس {base_url} کار نکرد (وضعیت: {response.status_code})")
                continue
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # بررسی وجود آیتم‌های فیلم در صفحه
            # IMDb ممکن است از کلاس‌های مختلف استفاده کند
            items = soup.select('.lister-item')
            if not items:
                # ممکن است ساختار صفحه تغییر کرده باشد
                # برخی از کلاس‌های جایگزین را بررسی می‌کنیم
                items = soup.select('[data-testid="list-item"]')
                if not items:
                    items = soup.select('.ipc-list-card')
                    if not items:
                        print(f"❌ هیچ آیتمی در {base_url} پیدا نشد.")
                        # برای دیباگ، بخش کوچکی از HTML را چاپ می‌کنیم
                        print("🔍 نمونه از HTML دریافت شده:")
                        print(response.text[:500])
                        continue
            
            print(f"✅ {len(items)} فیلم در {base_url} پیدا شد.")
            
            for item in items:
                try:
                    # روش‌های مختلف برای پیدا کردن لینک فیلم
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
                    
                    # پیدا کردن امتیاز کاربر
                    rating_elem = item.select_one('.ipl-rating-star .ipl-rating-star__rating')
                    if not rating_elem:
                        rating_elem = item.select_one('[data-testid="rating-star"]')
                    user_rating = rating_elem.text.strip() if rating_elem else "N/A"
                    
                    # پیدا کردن سال
                    year_elem = item.select_one('.lister-item-year')
                    if not year_elem:
                        year_elem = item.select_one('[data-testid="release-date"]')
                    year = year_elem.text.strip().replace('(', '').replace(')', '') if year_elem else "N/A"
                    
                    all_movies.append({
                        'imdb_id': imdb_id,
                        'title': title,
                        'year': year,
                        'user_rating': float(user_rating) if user_rating != 'N/A' else 0
                    })
                except Exception as e:
                    print(f"⚠️ خطا در پردازش یک آیتم: {e}")
                    continue
            
            # اگر فیلمی پیدا شد، از حلقه خارج می‌شویم
            if all_movies:
                print(f"✅ {len(all_movies)} فیلم از {base_url} دریافت شد.")
                break
                
        except Exception as e:
            print(f"❌ خطا در دریافت {base_url}: {e}")
            traceback.print_exc()
            continue
    
    if not all_movies:
        print("❌ هیچ فیلمی از هیچ آدرسی دریافت نشد.")
        print("💡 نکته: ممکن است ساختار IMDb تغییر کرده باشد یا نیاز به بروزرسانی اسکریپت باشد.")
    
    return all_movies

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

def main():
    try:
        # تست اتصال
        if not test_imdb_connection():
            print("❌ اتصال به IMDb ناموفق بود.")
            print("💡 نکات:")
            print("   1. مطمئن شوید کوکی‌ها معتبر هستند.")
            print("   2. ممکن است IMDb ساختار صفحات را تغییر داده باشد.")
            sys.exit(1)
        
        # دریافت لیست فیلم‌ها
        movies = get_imdb_ratings()
        
        if not movies:
            print("❌ هیچ فیلمی دریافت نشد.")
            print("💡 راه‌حل جایگزین: از روش خروجی CSV استفاده کنید.")
            print("   - به صفحه Ratings در IMDb بروید.")
            print("   - روی دکمه 'Export' کلیک کنید و فایل CSV را دانلود کنید.")
            print("   - سپس از آن فایل برای ساخت movies.json استفاده کنید.")
            sys.exit(1)
        
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
        
        # ذخیره در فایل JSON
        with open('../public/movies.json', 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        
        print(f"✅ {len(output)} فیلم با موفقیت ذخیره شد.")
        print(f"📁 مسیر: public/movies.json")
        print(f"🕐 زمان به‌روزرسانی: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
    except Exception as e:
        print(f"❌ خطای کلی: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
