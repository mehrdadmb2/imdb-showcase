import json
import os
import csv
import requests
from datetime import datetime
import sys
import time
from bs4 import BeautifulSoup  # 用于解析 IMDb 页面

print("🚀 شروع فرآیند دریافت اطلاعات از فایل CSV...")

# --- 配置与密钥 ---
omdb_keys_str = os.environ.get('OMDB_API_KEYS', '')
if not omdb_keys_str:
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
    print("⚠️ همه کلیدها به محدودیت روزانه رسیده‌اند!")
    return None

# --- 辅助函数：从 IMDb 页面抓取海报 ---
def fetch_poster_from_imdb(imdb_id):
    """尝试从 IMDb 的电影页面获取海报 URL"""
    url = f"https://www.imdb.com/title/{imdb_id}/"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None
        
        soup = BeautifulSoup(response.text, 'html.parser')
        # 查找海报图片标签
        poster_tag = soup.find('meta', property='og:image')
        if poster_tag and poster_tag.get('content'):
            poster_url = poster_tag['content']
            # 确保 URL 是高清版本
            if '_V1_' in poster_url:
                # 尝试获取更高分辨率的图片
                poster_url = poster_url.split('._V1_')[0] + '._V1_.jpg'
            return poster_url
        return None
    except Exception as e:
        print(f"⚠️ 从 IMDb 获取海报失败 ({imdb_id}): {e}")
        return None

# --- 读取 CSV ---
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
            # 处理日期格式
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

# --- 从 OMDb 获取数据 ---
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

# --- 处理所有电影数据 ---
def process_movies(movies):
    total = len(movies)
    print(f"🎬 پردازش {total} فیلم...")

    output = []
    for idx, m in enumerate(movies):
        print(f"⏳ {idx+1}/{total}: {m['title']}")

        # 基础信息（全部来自 CSV）
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

        # 1. 尝试从 OMDb 获取
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

        # 2. 如果 OMDb 没有海报，尝试从 IMDb 抓取
        if not result['poster'] or result['poster'] == 'N/A':
            imdb_poster = fetch_poster_from_imdb(m['imdb_id'])
            if imdb_poster:
                result['poster'] = imdb_poster
                print(f"   ✅ 从 IMDb 获取到海报: {m['title']}")

        output.append(result)

    print(f"✅ OMDb 成功: {success_count} از {total}")
    print(f"📊 وضعیت کلیدها:")
    for k, v in key_usage.items():
        print(f"   {k}: {v} درخواست")
    return output

# --- 保存 JSON，并记录最后手动更新时间 ---
def save_json(data):
    os.makedirs('../docs', exist_ok=True)
    
    # 添加元数据
    final_data = {
        'last_manual_update': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'movies': data
    }
    
    with open('../docs/movies.json', 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ {len(data)} فیلم در docs/movies.json ذخیره شد.")
    print(f"🕐 آخرین به‌روزرسانی دستی: {final_data['last_manual_update']}")

# --- 主程序 ---
def main():
    movies = read_csv()
    if not movies:
        sys.exit(1)
    output = process_movies(movies)
    save_json(output)

if __name__ == '__main__':
    main()
