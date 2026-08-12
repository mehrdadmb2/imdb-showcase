import json
import os
import re
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import sys
import traceback

print("🚀 شروع فرآیند دریافت اطلاعات...")

# کوکی‌ها را از Environment Variable می‌خوانیم
cookies_str = os.environ.get('IMDB_COOKIES', '')
print(f"📋 کوکی دریافت شد (طول: {len(cookies_str)})")

if not cookies_str:
    print("❌ خطا: کوکی‌ها در IMDB_COOKIES تنظیم نشده‌اند.")
    sys.exit(1)

# تبدیل کوکی‌ها به دیکشنری - روش پیشرفته‌تر
cookies = {}
# ابتدا با ; کوکی‌ها را جدا می‌کنیم
for item in cookies_str.split(';'):
    item = item.strip()
    if '=' in item:
        key, value = item.split('=', 1)
        # بعضی کوکی‌ها ممکن است شامل = های اضافی باشند، بنابراین فقط اولی رو جدا می‌کنیم
        cookies[key.strip()] = value.strip()

print(f"✅ {len(cookies)} کوکی شناسایی شد.")

# دریافت کلید OMDb API
OMDB_API_KEY = os.environ.get('OMDB_API_KEY', '')
if not OMDB_API_KEY:
    print("❌ خطا: کلید OMDb API در OMDB_API_KEY تنظیم نشده است.")
    sys.exit(1)

# ===== تنظیمات هدرهای مرورگر واقعی =====
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

def test_imdb_connection(session, cookies):
    """تست اتصال با رفتن به صفحه اصلی و سپس Ratings"""
    try:
        # مرحله 1: رفتن به صفحه اصلی برای دریافت کوکی‌های جلسه
        print("📡 مرحله 1: اتصال به صفحه اصلی IMDb...")
        response = session.get('https://www.imdb.com/', headers=HEADERS, timeout=15)
        print(f"   وضعیت: {response.status_code}")
        
        if response.status_code == 200:
            print("✅ صفحه اصلی با موفقیت بارگذاری شد.")
        elif response.status_code == 202:
            print("⚠️ صفحه اصلی وضعیت 202 داد (احتمالاً صفحه چالش). اما ادامه می‌دهیم...")
        else:
            print(f"❌ خطا در صفحه اصلی: {response.status_code}")
            return False
        
        # مرحله 2: رفتن به صفحه Ratings
        print("📡 مرحله 2: اتصال به صفحه Ratings...")
        ratings_url = 'https://www.imdb.com/user/ur0/ratings?sort=date_added&direction=desc'
        response = session.get(ratings_url, headers=HEADERS, timeout=15)
        print(f"   وضعیت: {response.status_code}")
        
        if response.status_code == 200:
            print("✅ صفحه Ratings با موفقیت بارگذاری شد.")
            return True
        elif response.status_code == 202:
            print("⚠️ صفحه Ratings وضعیت 202 داد. ممکن است نیاز به کوکی‌های بیشتر باشد.")
            return False
        else:
            print(f"❌ خطا در صفحه Ratings: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ خطا در اتصال: {e}")
        return False

def get_imdb_ratings(session):
    """دریافت لیست فیلم‌های امتیاز داده شده از IMDb"""
    all_movies = []
    page = 1
    max_pages = 10  # برای جلوگیری از درخواست زیاد
    
    while page <= max_pages:
        try:
            url = f'https://www.imdb.com/user/ur0/ratings?sort=date_added&direction=desc&page={page}'
            print(f"📥 دریافت صفحه {page}...")
            
            response = session.get(url, headers=HEADERS, timeout=20)
            
            if response.status_code != 200:
                print(f"⚠️ خطا در دریافت صفحه {page}: {response.status_code}")
                break
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # پیدا کردن آیتم‌های فیلم
            items = soup.select('.lister-item')
            if not items:
                # ممکن است صفحه خالی باشد یا ساختار تغییر کرده باشد
                print(f"❌ آیتمی در صفحه {page} پیدا نشد.")
                # برای دیباگ، بخش کوچکی از HTML را چاپ می‌کنیم
                print("🔍 نمونه از HTML دریافت شده:")
                print(response.text[:500])
                break
            
            print(f"✅ {len(items)} فیلم در صفحه {page} پیدا شد.")
            
            for item in items:
                try:
                    title_link = item.select_one('.lister-item-header a')
                    if not title_link:
                        continue
                    
                    imdb_id_match = re.search(r'tt(\d+)', title_link.get('href', ''))
                    if not imdb_id_match:
                        continue
                    
                    imdb_id = f"tt{imdb_id_match.group(1)}"
                    title = title_link.text.strip()
                    
                    rating_elem = item.select_one('.ipl-rating-star .ipl-rating-star__rating')
                    user_rating = rating_elem.text.strip() if rating_elem else "N/A"
                    
                    year_elem = item.select_one('.lister-item-year')
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
            
            # بررسی صفحه بعدی
            next_button = soup.select_one('.next-page')
            if not next_button:
                print("📄 صفحه آخر رسید.")
                break
            
            page += 1
            
        except Exception as e:
            print(f"❌ خطا در دریافت صفحه {page}: {e}")
            traceback.print_exc()
            break
    
    print(f"✅ {len(all_movies)} فیلم دریافت شد.")
    return all_movies

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
        print(f"⚠️ خطا در دریافت اطلاعات OMDb برای {imdb_id}: {e}")
    return None

def main():
    try:
        # ایجاد session
        session = requests.Session()
        session.cookies.update(cookies)
        
        # تست اتصال
        if not test_imdb_connection(session, cookies):
            print("❌ اتصال به IMDb ناموفق بود. لطفاً کوکی‌ها را بررسی کنید.")
            print("💡 نکته: ممکن است نیاز باشد کوکی‌های جدید از مرورگر دریافت کنید.")
            sys.exit(1)
        
        # دریافت لیست فیلم‌ها
        movies = get_imdb_ratings(session)
        
        if not movies:
            print("❌ هیچ فیلمی دریافت نشد. ممکن است صفحه Ratings خالی باشد یا نیاز به بروزرسانی کوکی داشته باشید.")
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
        print(f"❌ خطای کلی در اسکریپت: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
