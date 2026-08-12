import json
import os
import re
import requests
from bs4 import BeautifulSoup
from datetime import datetime

# کوکی‌ها را از Environment Variable می‌خوانیم
cookies_str = os.environ.get('IMDB_COOKIES', '')
if not cookies_str:
    print("❌ خطا: کوکی‌ها در IMDB_COOKIES تنظیم نشده‌اند.")
    exit(1)

# تبدیل کوکی‌ها به دیکشنری
cookies = {}
for item in cookies_str.split('; '):
    if '=' in item:
        key, value = item.split('=', 1)
        cookies[key] = value

# دریافت کلید OMDb API
OMDB_API_KEY = os.environ.get('OMDB_API_KEY', '')
if not OMDB_API_KEY:
    print("❌ خطا: کلید OMDb API در OMDB_API_KEY تنظیم نشده است.")
    exit(1)

def get_imdb_ratings(cookies):
    """دریافت لیست فیلم‌های امتیاز داده شده از IMDb"""
    url = "https://www.imdb.com/user/ur0/ratings?sort=date_added&direction=desc"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    
    all_movies = []
    page = 1
    max_pages = 20  # حداکثر 20 صفحه (هر صفحه 100 فیلم)
    
    while page <= max_pages:
        try:
            print(f"📥 دریافت صفحه {page}...")
            response = requests.get(f"{url}&page={page}", cookies=cookies, headers=headers)
            
            if response.status_code != 200:
                print(f"⚠️ خطا در دریافت صفحه {page}: {response.status_code}")
                break
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # پیدا کردن آیتم‌های فیلم
            items = soup.select('.lister-item')
            if not items:
                print("❌ آیتمی پیدا نشد. ممکن است صفحه خالی باشد یا نیاز به بروزرسانی کوکی باشد.")
                break
            
            for item in items:
                try:
                    # استخراج آی‌دی فیلم از لینک
                    title_link = item.select_one('.lister-item-header a')
                    if not title_link:
                        continue
                    
                    imdb_id_match = re.search(r'tt(\d+)', title_link.get('href', ''))
                    if not imdb_id_match:
                        continue
                    
                    imdb_id = f"tt{imdb_id_match.group(1)}"
                    title = title_link.text.strip()
                    
                    # استخراج امتیاز کاربر
                    rating_elem = item.select_one('.ipl-rating-star .ipl-rating-star__rating')
                    user_rating = rating_elem.text.strip() if rating_elem else "N/A"
                    
                    # استخراج سال
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
                break
            
            page += 1
            
        except Exception as e:
            print(f"❌ خطا در دریافت صفحه {page}: {e}")
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
    except:
        pass
    return None

def main():
    print("🚀 شروع دریافت اطلاعات از IMDb...")
    
    # دریافت لیست فیلم‌های امتیاز داده شده
    movies = get_imdb_ratings(cookies)
    
    if not movies:
        print("❌ هیچ فیلمی دریافت نشد. لطفاً کوکی‌ها را بررسی کنید.")
        exit(1)
    
    print("🎬 دریافت جزئیات فیلم‌ها از OMDb API...")
    
    output = []
    total = len(movies)
    
    for idx, movie in enumerate(movies):
        print(f"⏳ {idx+1}/{total}: {movie['title']} - {movie['imdb_id']}")
        
        # دریافت اطلاعات کامل از OMDb
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
            # اگر OMDb اطلاعاتی نداشت، فقط اطلاعات پایه را نگه می‌داریم
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

if __name__ == '__main__':
    main()
