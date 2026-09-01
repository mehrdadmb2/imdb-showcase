// ===== متغیرهای سراسری =====
let allMovies = [];
let filteredMovies = [];
let currentSort = 'date_rated-desc';
let currentFilters = { minRating: 0, genre: 'all', year: 'all', type: 'all' };
let viewMode = 'all';
let lastManualUpdate = '';
let statsVisible = false;
let charts = {};
let currentPage = 1;
let pageSize = 24;

// ===== اتصال امن رویدادها =====
function safeAddEventListener(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    else console.warn(`⚠️ ${id} پیدا نشد.`);
}

// ===== بارگذاری داده‌ها =====
async function loadMovies() {
    try {
        const res = await fetch('movies.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        
        if (data.last_manual_update) {
            lastManualUpdate = data.last_manual_update;
            document.getElementById('lastUpdate').textContent = 
                `آخرین به‌روزرسانی دستی: ${lastManualUpdate}`;
        }
        
        allMovies = data.movies || data;
        console.log(`✅ ${allMovies.length} فیلم بارگذاری شد.`);

        populateFilters();
        applyFiltersAndSort();
        updateStats();
        updateFirstLast();
        updateOmdbStatus();
        generateStats(); // تولید آمار

        const loading = document.getElementById('loading');
        if (loading) loading.classList.remove('active');
    } catch (e) {
        console.error(e);
        document.getElementById('loading').textContent = '❌ خطا: ' + e.message;
    }
}

// ===== پر کردن فیلترها =====
function populateFilters() {
    const genreSet = new Set(), yearSet = new Set();
    allMovies.forEach(m => {
        if (m.genres && m.genres !== 'N/A') {
            m.genres.split(',').forEach(g => genreSet.add(g.trim()));
        }
        if (m.year && m.year !== 'N/A') {
            const y = String(m.year || '').replace(/\D/g, '');
            if (y) yearSet.add(y);
        }
    });
    const gs = document.getElementById('genreFilter');
    if (gs) {
        gs.innerHTML = '<option value="all">همه</option>';
        [...genreSet].sort().forEach(g => gs.innerHTML += `<option value="${g}">${g}</option>`);
    }
    const ys = document.getElementById('yearFilter');
    if (ys) {
        ys.innerHTML = '<option value="all">همه</option>';
        [...yearSet].sort((a, b) => b - a).forEach(y => ys.innerHTML += `<option value="${y}">${y}</option>`);
    }
}

// ===== اعمال فیلتر و مرتب‌سازی =====
function applyFiltersAndSort() {
    filteredMovies = allMovies.filter(m => {
        if ((m.user_rating || 0) < currentFilters.minRating) return false;
        if (currentFilters.genre !== 'all') {
            if (!m.genres || m.genres === 'N/A') return false;
            if (!m.genres.split(',').map(g => g.trim()).includes(currentFilters.genre)) return false;
        }
        if (currentFilters.year !== 'all') {
            const y = String(m.year || '').replace(/\D/g, '');
            if (y !== currentFilters.year) return false;
        }
        if (currentFilters.type !== 'all' && m.title_type !== currentFilters.type) return false;
        if (viewMode === 'movie' && m.title_type !== 'Movie') return false;
        if (viewMode === 'series' && m.title_type !== 'TV Episode' && m.title_type !== 'TV Series') return false;
        return true;
    });
    sortMovies();
    currentPage = 1;
    renderMovies();
}

// ===== مرتب‌سازی =====
function sortMovies() {
    const [field, order] = currentSort.split('-');
    const isDesc = order === 'desc';
    filteredMovies.sort((a, b) => {
        let va = a[field] || 0, vb = b[field] || 0;
        if (field === 'title') {
            va = va.toString().toLowerCase();
            vb = vb.toString().toLowerCase();
            return isDesc ? vb.localeCompare(va) : va.localeCompare(vb);
        }
        if (field === 'date_rated') {
            const da = new Date(va), db = new Date(vb);
            if (isNaN(da) || isNaN(db)) {
                const ya = parseInt(a.year) || 0, yb = parseInt(b.year) || 0;
                return isDesc ? yb - ya : ya - yb;
            }
            return isDesc ? db - da : da - db;
        }
        va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
        return isDesc ? vb - va : va - vb;
    });
}

// ===== رندر فیلم‌ها =====
function getFallbackPoster(m) {
    const title = String(m.title || 'Untitled').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    const type = m.title_type === 'TV Episode' ? 'EPISODE' : m.title_type === 'TV Series' ? 'SERIES' : 'MOVIE';
    const year = String(m.year || '').replace(/[^0-9-]/g, '').slice(0, 9);
    const hue = Math.abs(hashCode(String(m.imdb_id || m.title))) % 360;
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="hsl(${hue},72%,26%)"/>
          <stop offset="0.52" stop-color="hsl(${(hue+52)%360},68%,15%)"/>
          <stop offset="1" stop-color="#090a12"/>
        </linearGradient>
        <radialGradient id="r"><stop offset="0" stop-color="white" stop-opacity=".18"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="600" height="900" fill="url(#g)"/>
      <circle cx="110" cy="180" r="170" fill="url(#r)"/>
      <circle cx="560" cy="720" r="220" fill="url(#r)" opacity=".55"/>
      <path d="M0 700 C160 590 250 820 600 570 L600 900 L0 900 Z" fill="#05060d" opacity=".58"/>
      <rect x="34" y="34" width="532" height="832" rx="28" fill="none" stroke="white" stroke-opacity=".16"/>
      <text x="52" y="88" fill="white" fill-opacity=".72" font-size="20" font-family="Arial, sans-serif" font-weight="700" letter-spacing="4">IMDB SHOWCASE</text>
      <text x="52" y="128" fill="white" fill-opacity=".42" font-size="15" font-family="Arial, sans-serif" letter-spacing="3">${type}</text>
      <text x="52" y="690" fill="white" font-size="38" font-family="Arial, sans-serif" font-weight="700">${title.slice(0, 26)}</text>
      <text x="52" y="736" fill="white" fill-opacity=".62" font-size="22" font-family="Arial, sans-serif">${year || '—'}</text>
      <text x="52" y="810" fill="white" fill-opacity=".34" font-size="16" font-family="Arial, sans-serif">POSTER UNAVAILABLE</text>
    </svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function hashCode(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function normalizeMovie(m) {
    const movie = {...m};
    movie.imdb_id = movie.imdb_id || movie.Const || '';
    movie.title = movie.title || movie.Title || 'بدون عنوان';
    movie.original_title = movie.original_title || movie['Original Title'] || movie.title;
    movie.poster = movie.poster || '';
    movie.genres = movie.genres || movie.Genres || '';
    movie.title_type = movie.title_type || movie['Title Type'] || 'Other';
    movie.user_rating = Number(movie.user_rating ?? movie['Your Rating'] ?? 0) || 0;
    movie.date_rated = movie.date_rated || movie['Date Rated'] || '';
    movie.year = movie.year || movie.Year || '';
    movie.imdb_rating = movie.imdb_rating || movie['IMDb Rating'] || '';
    movie.runtime = movie.runtime || movie['Runtime (mins)'] || '';
    return movie;
}

function buildMovieCard(m) {
    const title = escapeHtml(m.title);
    const year = escapeHtml(m.year || 'N/A');
    const genres = m.genres && m.genres !== 'N/A'
        ? String(m.genres).split(',').map(g => g.trim()).filter(Boolean).slice(0, 3)
            .map(g => `<span class="movie-genre-tag">${escapeHtml(g)}</span>`).join('')
        : '';

    const fallback = getFallbackPoster(m);
    const poster = m.poster ? escapeHtml(m.poster) : fallback;
    const ratedDate = m.date_rated ? formatDate(m.date_rated) : '';

    let typeBadge = '';
    if (m.title_type === 'TV Episode') {
        typeBadge = '<div class="movie-type-badge">📺 قسمت</div>';
    } else if (m.title_type === 'TV Series') {
        typeBadge = '<div class="movie-type-badge">📺 سریال</div>';
    } else if (m.title_type === 'Short') {
        typeBadge = '<div class="movie-type-badge">🎞️ کوتاه</div>';
    }

    const ratingBadge = m.user_rating >= 8
        ? '🔥 عالی'
        : m.user_rating >= 6
            ? '👍 خوب'
            : m.user_rating > 0
                ? '😐'
                : '';

    return `
    <article class="movie-card" data-id="${escapeHtml(m.imdb_id)}" tabindex="0" role="button" aria-label="نمایش جزئیات ${title}">
        <div class="poster-wrap">
            <img
                class="movie-poster"
                src="${poster}"
                alt="${title}"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                onerror="this.onerror=null; this.src='${fallback}';"
            />
            <div class="movie-glow"></div>
            <div class="movie-top-meta">
                <span class="movie-year-pill">${year}</span>
                ${m.user_rating ? `<span class="movie-user-pill">⭐ ${m.user_rating}</span>` : ''}
            </div>
        </div>
        <div class="movie-info">
            <div class="movie-title">${title}</div>
            <div class="movie-year">${year}${ratedDate ? ` • 📅 ${escapeHtml(ratedDate)}` : ''}</div>
            <div class="movie-genres">${genres}</div>
            <div class="movie-rating">
                <span class="user-rating">⭐ ${m.user_rating || '?'}</span>
                <span class="imdb-rating">IMDb: ${escapeHtml(m.imdb_rating || 'N/A')}</span>
            </div>
        </div>
        ${ratingBadge ? `<div class="movie-badge">${ratingBadge}</div>` : ''}
        ${typeBadge}
    </article>`;
}

function renderMovies() {
    const grid = document.getElementById('moviesGrid');
    if (!grid) return;

    const total = filteredMovies.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    if (!total) {
        grid.innerHTML = `
            <div class="empty-library">
                <span class="empty-library-icon">🎭</span>
                <strong>هیچ عنوانی پیدا نشد</strong>
                <span>فیلترها را تغییر بده یا همه فیلترها را پاک کن.</span>
            </div>`;
        renderPagination();
        return;
    }

    const start = (currentPage - 1) * pageSize;
    const pageItems = filteredMovies.slice(start, start + pageSize);

    grid.innerHTML = pageItems.map(m => buildMovieCard(normalizeMovie(m))).join('');
    renderPagination();
}

function renderPagination() {
    const total = filteredMovies.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = total ? ((currentPage - 1) * pageSize) + 1 : 0;
    const end = Math.min(currentPage * pageSize, total);

    const info = document.getElementById('pageInfo');
    const range = document.getElementById('pageRange');
    const numbers = document.getElementById('pageNumbers');
    const pagination = document.getElementById('paginationBar');

    if (info) info.textContent = `صفحه ${toFa(currentPage)} از ${toFa(totalPages)}`;
    if (range) range.textContent = `${toFa(start)}–${toFa(end)} از ${toFa(total)} عنوان`;

    if (pagination) pagination.classList.toggle('hidden', total <= pageSize);

    if (numbers) {
        const pages = buildPageWindow(currentPage, totalPages, 5);
        numbers.innerHTML = pages.map(page => {
            if (page === '…') return '<span class="page-ellipsis">…</span>';
            return `<button type="button" class="page-number ${page === currentPage ? 'active' : ''}" data-page="${page}">${toFa(page)}</button>`;
        }).join('');
    }

    setDisabled('firstPage', currentPage <= 1);
    setDisabled('prevPage', currentPage <= 1);
    setDisabled('nextPage', currentPage >= totalPages);
    setDisabled('lastPage', currentPage >= totalPages);
}

function buildPageWindow(current, total, maxVisible) {
    if (total <= maxVisible) return Array.from({length: total}, (_, i) => i + 1);
    const pages = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    if (start > 2) pages.push('…');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < total - 1) pages.push('…');
    pages.push(total);
    return pages;
}

function setDisabled(id, value) {
    const el = document.getElementById(id);
    if (el) el.disabled = value;
}

function goToPage(page) {
    const totalPages = Math.max(1, Math.ceil(filteredMovies.length / pageSize));
    const target = Math.max(1, Math.min(Number(page) || 1, totalPages));
    if (target === currentPage) return;
    currentPage = target;
    renderMovies();
    document.getElementById('moviesGrid')?.scrollIntoView({behavior: 'smooth', block: 'start'});
}

function toFa(number) {
    return String(number).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
}

function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('fa-IR');
}

// ===== آمار اصلی =====
function updateStats() {
    const totalMovies = allMovies.filter(m => m.title_type === 'Movie' || m.title_type === 'Short').length;
    const totalSeries = allMovies.filter(m => m.title_type === 'TV Series').length;
    const totalEpisodes = allMovies.filter(m => m.title_type === 'TV Episode').length;

    document.getElementById('totalMovies').textContent = totalMovies;
    document.getElementById('totalSeries').textContent = totalSeries + totalEpisodes;

    let totalMinutes = 0;
    let sumRating = 0;
    let countRating = 0;
    const genreSet = new Set();

    allMovies.forEach(m => {
        if (m.runtime && m.runtime !== 'N/A') {
            const match = String(m.runtime).match(/\d+/);
            const mins = match ? parseInt(match[0], 10) : 0;
            if (Number.isFinite(mins)) totalMinutes += mins;
        }

        const userRating = Number(m.user_rating) || 0;
        if (userRating > 0) {
            sumRating += userRating;
            countRating++;
        }

        if (m.genres && m.genres !== 'N/A') {
            String(m.genres).split(',').forEach(g => {
                const genre = g.trim();
                if (genre) genreSet.add(genre);
            });
        }
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    document.getElementById('totalHours').textContent = hours;
    const minutesNode = document.getElementById('totalMinutes');
    if (minutesNode) minutesNode.textContent = `${minutes} دقیقه`;

    document.getElementById('avgRating').textContent = countRating
        ? (sumRating / countRating).toFixed(1)
        : '0';

    const genresNode = document.getElementById('totalGenres');
    if (genresNode) genresNode.textContent = genreSet.size;

    const episodeNode = document.getElementById('statTotalEpisodes');
    if (episodeNode) episodeNode.textContent = totalEpisodes;
}

// ===== اولین و آخرین =====
function updateFirstLast() {
    const sorted = [...allMovies].filter(m => m.date_rated).sort((a, b) => new Date(a.date_rated) - new Date(b.date_rated));
    if (sorted.length) {
        document.getElementById('firstTitle').textContent = sorted[0].title;
        document.getElementById('firstDate').textContent = sorted[0].date_rated;
        document.getElementById('lastTitle').textContent = sorted[sorted.length-1].title;
        document.getElementById('lastDate').textContent = sorted[sorted.length-1].date_rated;
    }
}

// ===== وضعیت OMDb =====
function updateOmdbStatus() {
    const withPoster = allMovies.filter(m => m.poster).length;
    document.getElementById('omdbStatus').textContent =
        `وضعیت OMDb: ${withPoster} پوستر از ${allMovies.length} فیلم دریافت شد.`;
}

// ================================================================
// ===== بخش آمار پیشرفته =====
// ================================================================

function generateStats() {
    if (allMovies.length === 0) return;
    
    // 1. کارت‌های آماری
    const directors = new Set();
    const years = new Set();
    let maxRating = 0;
    const episodes = allMovies.filter(m => m.title_type === 'TV Episode').length;
    const genreCount = {};
    let totalPerYear = 0;
    const yearCount = {};

    allMovies.forEach(m => {
        if (m.directors && m.directors !== 'N/A') {
            m.directors.split(',').forEach(d => directors.add(d.trim()));
        }
        if (m.year && m.year !== 'N/A') {
            const y = String(m.year || '').replace(/\D/g, '');
            if (y) {
                years.add(y);
                yearCount[y] = (yearCount[y] || 0) + 1;
            }
        }
        if (m.user_rating > maxRating) maxRating = m.user_rating;
        if (m.genres && m.genres !== 'N/A') {
            m.genres.split(',').forEach(g => {
                const key = g.trim();
                genreCount[key] = (genreCount[key] || 0) + 1;
            });
        }
    });

    // محبوب‌ترین ژانر
    let topGenre = '-';
    let topCount = 0;
    for (const [g, count] of Object.entries(genreCount)) {
        if (count > topCount) {
            topCount = count;
            topGenre = g;
        }
    }

    // میانگین فیلم در سال
    const yearKeys = Object.keys(yearCount);
    if (yearKeys.length > 0) {
        const totalYears = yearKeys.length;
        const totalMovies = allMovies.length;
        totalPerYear = Math.round(totalMovies / totalYears);
    }

    document.getElementById('statDirectors').textContent = directors.size;
    document.getElementById('statYears').textContent = years.size;
    document.getElementById('statTopRating').textContent = maxRating > 0 ? maxRating : '0';
    document.getElementById('statTotalEpisodes').textContent = episodes;
    document.getElementById('statTopGenre').textContent = topGenre;
    document.getElementById('statAvgPerYear').textContent = totalPerYear;

    // 2. نمودار ژانرها
    const sortedGenres = Object.entries(genreCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
    
    createChart('genreChart', 'bar', 
        sortedGenres.map(g => g[0]),
        sortedGenres.map(g => g[1]),
        ['#e94560', '#6c5ce7', '#00d2d3', '#fdcb6e', '#e17055', '#00b894', '#0984e3', '#fd79a8', '#fdcb6e', '#55efc4', '#74b9ff', '#a29bfe']
    );

    // 3. توزیع امتیازات
    const ratingDist = {};
    allMovies.forEach(m => {
        const r = Math.round(m.user_rating);
        if (r > 0) {
            ratingDist[r] = (ratingDist[r] || 0) + 1;
        }
    });
    const ratingLabels = Object.keys(ratingDist).sort((a, b) => a - b);
    createChart('ratingChart', 'bar',
        ratingLabels.map(r => r + '⭐'),
        ratingLabels.map(r => ratingDist[r]),
        ['#ffd700', '#fdcb6e', '#f9ca24', '#f0932b', '#e94560', '#e17055', '#d63031', '#6c5ce7', '#0984e3', '#00d2d3']
    );

    // 4. فیلم‌ها بر اساس سال
    const sortedYears = Object.entries(yearCount)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .slice(-15); // ۱۵ سال اخیر
    createChart('yearChart', 'line',
        sortedYears.map(y => y[0]),
        sortedYears.map(y => y[1]),
        ['#e94560']
    );

    // 5. فعالیت بر اساس ماه
    const monthCount = {};
    allMovies.forEach(m => {
        if (m.date_rated) {
            try {
                const date = new Date(m.date_rated);
                const month = date.getMonth() + 1;
                monthCount[month] = (monthCount[month] || 0) + 1;
            } catch {}
        }
    });
    const monthNames = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    const monthData = [];
    for (let i = 1; i <= 12; i++) {
        monthData.push(monthCount[i] || 0);
    }
    createChart('monthChart', 'bar',
        monthNames,
        monthData,
        ['#00d2d3', '#6c5ce7', '#e94560', '#fdcb6e', '#00b894', '#0984e3', '#e17055', '#fd79a8', '#55efc4', '#74b9ff', '#a29bfe', '#fdcb6e']
    );

    // 6. میانگین امتیاز به ازای ژانر
    const genreAvg = {};
    const genreCount2 = {};
    allMovies.forEach(m => {
        if (m.genres && m.genres !== 'N/A' && m.user_rating > 0) {
            m.genres.split(',').forEach(g => {
                const key = g.trim();
                genreAvg[key] = (genreAvg[key] || 0) + m.user_rating;
                genreCount2[key] = (genreCount2[key] || 0) + 1;
            });
        }
    });
    const genreAvgData = [];
    const genreAvgLabels = [];
    for (const [g, sum] of Object.entries(genreAvg)) {
        if (genreCount2[g] >= 3) { // حداقل ۳ فیلم
            genreAvgLabels.push(g);
            genreAvgData.push(parseFloat((sum / genreCount2[g]).toFixed(1)));
        }
    }
    const sortedAvg = genreAvgLabels.map((g, i) => ({ label: g, value: genreAvgData[i] }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15);
    createChart('genreRatingChart', 'bar',
        sortedAvg.map(d => d.label),
        sortedAvg.map(d => d.value),
        ['#ffd700', '#fdcb6e', '#f9ca24', '#f0932b', '#e94560', '#e17055', '#6c5ce7', '#0984e3', '#00d2d3', '#00b894', '#55efc4', '#74b9ff', '#a29bfe', '#fd79a8', '#fdcb6e']
    );

    // 7. مقایسه امتیاز من با IMDb
    const compareData = allMovies
        .filter(m => m.user_rating > 0 && m.imdb_rating !== 'N/A')
        .slice(0, 30) // ۳۰ فیلم آخر
        .reverse();
    createChart('compareChart', 'bar',
        compareData.map(m => m.title.length > 20 ? m.title.slice(0, 18) + '...' : m.title),
        [],
        ['#ffd700', '#e94560'],
        [
            compareData.map(m => Number(m.user_rating) || 0),
            compareData.map(m => parseFloat(m.imdb_rating) || 0)
        ]
    );

    // 8. بهترین فیلم‌ها
    const topMovies = allMovies
        .filter(m => m.user_rating === 10)
        .sort((a, b) => new Date(b.date_rated) - new Date(a.date_rated))
        .slice(0, 20);
    
    const list = document.getElementById('topMoviesList');
    if (topMovies.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;">هیچ فیلمی با امتیاز ۱۰ وجود ندارد.</p>';
    } else {
        list.innerHTML = topMovies.map((m, i) => `
            <div class="top-movie-item" onclick="openModal('${m.imdb_id}')">
                <div class="top-movie-rank">#${i+1}</div>
                <div class="top-movie-info">
                    <div class="title">${m.title}</div>
                    <div class="year">${m.year || 'N/A'} • ${m.genres ? m.genres.split(',').slice(0,2).map(g => g.trim()).join(', ') : ''}</div>
                </div>
                <div class="top-movie-rating">⭐ ${m.user_rating}</div>
            </div>
        `).join('');
    }
}

// ===== ایجاد نمودار با Chart.js =====
function createChart(id, type, labels, data, colors, datasets) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    
    // حذف نمودار قبلی
    if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
    }

    const ctx = canvas.getContext('2d');
    
    // اگر داده‌های دوگانه داریم (برای مقایسه)
    let chartData;
    if (datasets && Array.isArray(datasets) && datasets.length > 0) {
        chartData = {
            labels: labels,
            datasets: datasets.map((d, i) => ({
                label: i === 0 ? 'امتیاز من' : 'امتیاز IMDb',
                data: d,
                backgroundColor: colors[i] || '#e94560',
                borderColor: colors[i] || '#e94560',
                borderWidth: 2,
                borderRadius: 4
            }))
        };
    } else {
        chartData = {
            labels: labels,
            datasets: [{
                label: 'تعداد',
                data: data,
                backgroundColor: Array.isArray(colors) ? colors : ['#e94560'],
                borderColor: Array.isArray(colors) ? colors : ['#e94560'],
                borderWidth: 1,
                borderRadius: 4
            }]
        };
    }

    charts[id] = new Chart(ctx, {
        type: type,
        data: chartData,
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: '#a0a0b0',
                        font: { family: 'Vazirmatn' }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#a0a0b0' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    ticks: { color: '#a0a0b0', maxRotation: 45 },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            }
        }
    });
}

// ================================================================
// ===== مودال =====
// ================================================================

function openModal(id) {
    const m = allMovies.find(x => x.imdb_id === id);
    if (!m) return;
    const ov = document.getElementById('modalOverlay');
    if (!ov) return;

    document.getElementById('modalPoster').src = m.poster || '';
    document.getElementById('modalPoster').style.display = m.poster ? 'block' : 'none';
    document.getElementById('modalTitle').textContent = m.title;
    document.getElementById('modalYear').textContent = m.year || 'N/A';
    document.getElementById('modalUserRating').textContent = m.user_rating || '—';
    document.getElementById('modalImdbRating').textContent = m.imdb_rating || 'N/A';
    document.getElementById('modalRuntime').textContent = m.runtime || 'N/A';
    document.getElementById('modalRated').textContent = m.rated || 'N/A';
    document.getElementById('modalType').textContent = m.title_type || 'N/A';
    document.getElementById('modalPlot').textContent = (m.plot && m.plot !== 'N/A') ? m.plot : '📝 اطلاعاتی در دسترس نیست.';
    document.getElementById('modalGenre').textContent = m.genres || 'N/A';
    document.getElementById('modalDirector').textContent = m.directors || 'N/A';
    document.getElementById('modalActors').textContent = m.actors || 'N/A';
    document.getElementById('modalWriter').textContent = m.writer || 'N/A';
    document.getElementById('modalReleased').textContent = m.release_date || 'N/A';
    document.getElementById('modalVotes').textContent = m.num_votes || 'N/A';
    document.getElementById('modalDateRated').textContent = m.date_rated || 'N/A';
    document.getElementById('modalOriginalTitle').textContent = m.original_title || m.title || 'N/A';
    
    const imdbLink = document.getElementById('modalImdbLink');
    if (imdbLink) {
        imdbLink.href = `https://www.imdb.com/title/${m.imdb_id}/`;
        imdbLink.textContent = 'مشاهده در IMDb';
    }

    ov.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const ov = document.getElementById('modalOverlay');
    if (ov) ov.classList.remove('active');
    document.body.style.overflow = '';
}

// ================================================================
// ===== رویدادها =====
// ================================================================

// دکمه نمایش/مخفی کردن آمار
safeAddEventListener('statsBtn', 'click', () => {
    const section = document.getElementById('statsSection');
    if (statsVisible) {
        section.style.display = 'none';
        document.getElementById('statsBtn').textContent = '📈 آمار';
        document.getElementById('statsBtn').style.background = 'none';
        document.getElementById('statsBtn').style.borderColor = 'rgba(255,255,255,0.08)';
        statsVisible = false;
    } else {
        section.style.display = 'block';
        document.getElementById('statsBtn').textContent = '❌ بستن آمار';
        document.getElementById('statsBtn').style.background = 'rgba(233,69,96,0.15)';
        document.getElementById('statsBtn').style.borderColor = 'var(--accent)';
        statsVisible = true;
        // اگر نمودارها ساخته نشده‌اند، دوباره بساز
        if (Object.keys(charts).length === 0) {
            setTimeout(generateStats, 300);
        }
    }
});

safeAddEventListener('filterBtn', 'click', () => {
    document.getElementById('filtersBar').classList.toggle('active');
});
safeAddEventListener('minRating', 'input', (e) => {
    currentFilters.minRating = parseFloat(e.target.value);
    document.getElementById('minRatingValue').textContent = currentFilters.minRating;
    applyFiltersAndSort();
});
safeAddEventListener('genreFilter', 'change', (e) => {
    currentFilters.genre = e.target.value;
    applyFiltersAndSort();
});
safeAddEventListener('yearFilter', 'change', (e) => {
    currentFilters.year = e.target.value;
    applyFiltersAndSort();
});
safeAddEventListener('typeFilter', 'change', (e) => {
    currentFilters.type = e.target.value;
    applyFiltersAndSort();
});
safeAddEventListener('resetFilters', 'click', () => {
    document.getElementById('minRating').value = 0;
    document.getElementById('minRatingValue').textContent = '0';
    document.getElementById('genreFilter').value = 'all';
    document.getElementById('yearFilter').value = 'all';
    document.getElementById('typeFilter').value = 'all';
    currentFilters = { minRating: 0, genre: 'all', year: 'all', type: 'all' };
    currentPage = 1;
    applyFiltersAndSort();
});
safeAddEventListener('sortBtn', 'click', () => {
    const opts = [
        { value: 'date_rated-desc', label: '📅 تاریخ (جدید به قدیم)' },
        { value: 'date_rated-asc', label: '📅 تاریخ (قدیم به جدید)' },
        { value: 'user_rating-desc', label: '⭐ امتیاز من (بالا به پایین)' },
        { value: 'user_rating-asc', label: '⭐ امتیاز من (پایین به بالا)' },
        { value: 'imdb_rating-desc', label: '⭐ IMDb (بالا به پایین)' },
        { value: 'title-asc', label: '🔤 عنوان (الفبا)' },
        { value: 'year-desc', label: '📅 سال (جدید به قدیم)' },
    ];
    const choice = prompt('مرتب‌سازی:\n' + opts.map((o,i) => `${i+1}. ${o.label}`).join('\n'));
    if (choice) {
        const idx = parseInt(choice)-1;
        if (idx>=0 && idx<opts.length) {
            currentSort = opts[idx].value;
            applyFiltersAndSort();
        }
    }
});
safeAddEventListener('pageSize', 'change', (e) => {
    const value = parseInt(e.target.value, 10);
    pageSize = [12, 24, 36, 48].includes(value) ? value : 24;
    currentPage = 1;
    renderMovies();
});

document.getElementById('paginationBar')?.addEventListener('click', (e) => {
    const pageButton = e.target.closest('[data-page]');
    if (pageButton) {
        goToPage(pageButton.dataset.page);
        return;
    }
    if (e.target.closest('#firstPage')) goToPage(1);
    if (e.target.closest('#prevPage')) goToPage(currentPage - 1);
    if (e.target.closest('#nextPage')) goToPage(currentPage + 1);
    if (e.target.closest('#lastPage')) goToPage(Math.ceil(filteredMovies.length / pageSize));
});

safeAddEventListener('toggleView', 'click', () => {
    const modes = ['all', 'movie', 'series'];
    const labels = ['📽️ همه', '🎬 فیلم', '📺 سریال'];
    let idx = modes.indexOf(viewMode);
    idx = (idx + 1) % modes.length;
    viewMode = modes[idx];
    document.getElementById('toggleView').textContent = labels[idx];
    applyFiltersAndSort();
});

document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loading')?.classList.add('active');
    loadMovies();
});
