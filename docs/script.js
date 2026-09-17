/*
 * IMDb Showcase - Classic Runtime (V10)
 *
 * Goal:
 * - preserve the original Classic UI/UX structure
 * - render only one page of cards at a time
 * - keep movie-card click -> full detail modal reliable
 * - survive missing/null/malformed data
 * - use local poster cache first, then fallback to the original placeholder
 * - work with both the old movies.json schema and the new resilient schema
 * - defer expensive Chart.js work until the Statistics panel is opened
 */
(() => {
    'use strict';

    const CACHE_KEY = 'imdb-showcase-classic-data-v10';
    const PAGE_SIZE_KEY = 'imdb-showcase-classic-page-size-v10';
    const DATA_URL = 'movies.json';

    let allMovies = [];
    let filteredMovies = [];
    let currentSort = 'date_rated-desc';
    let currentFilters = { minRating: 0, genre: 'all', year: 'all', type: 'all' };
    let viewMode = 'all';
    let lastManualUpdate = '';
    let statsVisible = false;
    let charts = {};
    let currentPage = 1;
    let pageSize = loadPageSize();

    const $ = (id) => document.getElementById(id);

    function log(...args) { console.info('[IMDb Classic]', ...args); }
    function warn(...args) { console.warn('[IMDb Classic]', ...args); }
    function error(...args) { console.error('[IMDb Classic]', ...args); }

    function getSafeString(value, fallback = '') {
        if (value === null || value === undefined) return fallback;
        const text = String(value).replace(/\u0000/g, '').trim();
        return text && text.toUpperCase() !== 'N/A' ? text : fallback;
    }

    function getYearNumber(value) {
        const match = String(value ?? '').match(/\b(?:18|19|20)\d{2}\b/);
        return match ? Number(match[0]) : 0;
    }

    function getDateValue(value) {
        if (!value) return 0;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? time : 0;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        }[ch]));
    }

    function toNumber(value, fallback = 0) {
        const n = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : fallback;
    }

    function splitValues(value) {
        if (Array.isArray(value)) return value.map(x => String(x).trim()).filter(Boolean);
        return String(value ?? '').split(',').map(x => x.trim()).filter(Boolean);
    }

    function ratingEmoji(rating) {
        const r = toNumber(rating);
        if (r >= 9.5) return '🤯🔥🏆';
        if (r >= 9) return '🔥🏆';
        if (r >= 8) return '🌟😍';
        if (r >= 7) return '😎👍';
        if (r >= 6) return '🙂👌';
        if (r >= 5) return '😐🎬';
        if (r > 0) return '😕';
        return '🎬';
    }

    function ratingLabel(rating) {
        const r = toNumber(rating);
        if (r >= 9.5) return 'افسانه‌ای';
        if (r >= 9) return 'عالی';
        if (r >= 8) return 'خیلی خوب';
        if (r >= 7) return 'خوب';
        if (r >= 6) return 'قابل‌قبول';
        if (r >= 5) return 'متوسط';
        if (r > 0) return 'ضعیف';
        return 'بدون امتیاز';
    }

    function formatRuntime(value) {
        const match = String(value ?? '').match(/\d+/);
        const minutes = match ? Number(match[0]) : 0;
        if (!minutes) return getSafeString(value, 'N/A');
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours && mins) return `${hours} ساعت و ${mins} دقیقه`;
        if (hours) return `${hours} ساعت`;
        return `${mins} دقیقه`;
    }

    function formatDate(value) {
        const d = value ? new Date(value) : null;
        if (!d || Number.isNaN(d.getTime())) return getSafeString(value, '—');
        try { return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(d); }
        catch { return getSafeString(value, '—'); }
    }

    function loadPageSize() {
        try {
            const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
            return [12, 24, 36, 48].includes(saved) ? saved : 24;
        } catch { return 24; }
    }

    function savePageSize() {
        try { localStorage.setItem(PAGE_SIZE_KEY, String(pageSize)); } catch {}
    }

    function loadCachedDataset() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.movies) ? parsed : null;
        } catch (e) {
            warn('Cache local خراب است و نادیده گرفته شد.', e);
            return null;
        }
    }

    function saveCachedDataset(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                savedAt: new Date().toISOString(),
                movies: data.movies,
                lastManualUpdate: data.last_manual_update || ''
            }));
        } catch (e) {
            warn('ذخیره cache محلی ممکن نشد.', e);
        }
    }

    function safeAddEventListener(id, event, handler, options) {
        const el = $(id);
        if (!el) {
            warn(`المان #${id} پیدا نشد.`);
            return;
        }
        el.addEventListener(event, handler, options);
    }

    function getLocalPosterUrl(movie) {
        const candidate = getSafeString(movie?.poster_local, '');
        if (!candidate) return '';
        if (/^https?:\/\//i.test(candidate)) return candidate;
        if (candidate.startsWith('/')) return candidate;
        if (candidate.startsWith('../')) return candidate;
        return candidate.startsWith('posters/') ? candidate : `posters/${candidate.replace(/^\//, '')}`;
    }

    function normalizeMovieRecord(movie) {
        const m = movie && typeof movie === 'object' ? movie : {};
        return {
            ...m,
            imdb_id: getSafeString(m.imdb_id, ''),
            title: getSafeString(m.title, 'بدون عنوان'),
            original_title: getSafeString(m.original_title, getSafeString(m.title, 'بدون عنوان')),
            year: getSafeString(m.year, 'N/A'),
            user_rating: toNumber(m.user_rating),
            date_rated: getSafeString(m.date_rated, ''),
            title_type: getSafeString(m.title_type, 'Other'),
            imdb_rating: getSafeString(m.imdb_rating, 'N/A'),
            runtime: getSafeString(m.runtime, 'N/A'),
            genres: getSafeString(m.genres, 'N/A'),
            num_votes: getSafeString(m.num_votes, 'N/A'),
            release_date: getSafeString(m.release_date, 'N/A'),
            directors: getSafeString(m.directors, 'N/A'),
            url: getSafeString(m.url, ''),
            poster: getSafeString(m.poster, ''),
            poster_local: getSafeString(m.poster_local, ''),
            plot: getSafeString(m.plot, 'N/A'),
            rated: getSafeString(m.rated, 'N/A'),
            actors: getSafeString(m.actors, 'N/A'),
            writer: getSafeString(m.writer, 'N/A'),
            country: getSafeString(m.country, 'N/A'),
            language: getSafeString(m.language, 'N/A'),
            awards: getSafeString(m.awards, 'N/A'),
            box_office: getSafeString(m.box_office, 'N/A'),
            production: getSafeString(m.production, 'N/A'),
            metascore: getSafeString(m.metascore, 'N/A'),
            website: getSafeString(m.website, ''),
            ratings: Array.isArray(m.ratings) ? m.ratings : [],
            data_status: getSafeString(m.data_status, m.omdb_found ? 'fresh' : 'partial'),
            data_stale_reason: getSafeString(m.data_stale_reason, ''),
            data_fetched_at: getSafeString(m.data_fetched_at, ''),
            cache_updated_at: getSafeString(m.cache_updated_at, ''),
            poster_status: getSafeString(m.poster_status, ''),
            series_id: getSafeString(m.series_id, ''),
            series_title: getSafeString(m.series_title, ''),
            season_number: toNumber(m.season_number),
            episode_number: toNumber(m.episode_number),
            episode_title: getSafeString(m.episode_title, ''),
            is_episode: m.is_episode === true || m.title_type === 'TV Episode',
            total_seasons: toNumber(m.total_seasons),
            total_episodes: toNumber(m.total_episodes),
            raw_csv: m.raw_csv && typeof m.raw_csv === 'object' ? m.raw_csv : {},
            raw_omdb: m.raw_omdb && typeof m.raw_omdb === 'object' ? m.raw_omdb : {}
        };
    }

    async function fetchJson(url, timeoutMs = 15000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`, {
                cache: 'no-store',
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || (!Array.isArray(data.movies) && !Array.isArray(data))) {
                throw new Error('فرمت movies.json معتبر نیست.');
            }
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    async function loadMovies() {
        const loading = $('loading');
        if (loading) {
            loading.classList.add('active');
            loading.textContent = '⏳ در حال بارگذاری داده‌ها...';
        }

        try {
            const data = await fetchJson(DATA_URL);
            const movies = Array.isArray(data.movies) ? data.movies : data;
            allMovies = movies.map(normalizeMovieRecord).filter(m => m.imdb_id);
            lastManualUpdate = getSafeString(data.last_manual_update, '');
            saveCachedDataset({ movies: allMovies, last_manual_update: lastManualUpdate });
            updateFooter(data);
            log(`✅ ${allMovies.length} رکورد از Repository خوانده شد.`);
        } catch (e) {
            error('بارگذاری اصلی ناموفق بود:', e);
            const cached = loadCachedDataset();
            if (cached?.movies?.length) {
                allMovies = cached.movies.map(normalizeMovieRecord).filter(m => m.imdb_id);
                lastManualUpdate = getSafeString(cached.lastManualUpdate, '');
                updateFooter({ last_manual_update: lastManualUpdate, data_meta: { cache_fallback: true } });
                toast('اتصال به Dataset فعلی ناموفق بود؛ آخرین نسخه سالم محلی نمایش داده شد.', 'warn');
                log(`🟡 ${allMovies.length} رکورد از localStorage cache خوانده شد.`);
            } else {
                allMovies = [];
                showLoadFailure(e);
                return;
            }
        }

        populateFilters();
        applyFiltersAndSort(true);
        updateStats();
        updateFirstLast();
        updateOmdbStatus();
        if (loading) loading.classList.remove('active');
    }

    function showLoadFailure(e) {
        const loading = $('loading');
        if (!loading) return;
        loading.classList.add('active');
        loading.textContent = `❌ خطا در بارگذاری داده‌ها: ${e?.message || 'نامشخص'}`;
    }

    function updateFooter(data) {
        const lastUpdate = $('lastUpdate');
        if (lastUpdate) {
            lastUpdate.textContent = lastManualUpdate
                ? `آخرین به‌روزرسانی داده: ${formatDate(lastManualUpdate)}`
                : 'آخرین به‌روزرسانی داده: —';
        }
        const meta = data?.data_meta || {};
        const status = $('omdbStatus');
        if (status) {
            const fresh = toNumber(meta.omdb_success) || toNumber(meta.omdb_fresh);
            const cached = toNumber(meta.cache_reused);
            const partial = toNumber(meta.partial_records) || toNumber(meta.omdb_partial);
            const errors = toNumber(meta.omdb_errors) || toNumber(meta.api_errors) || toNumber(meta.api_errors_total);
            const posters = toNumber(meta.posters_downloaded) + toNumber(meta.posters_reused);
            if (fresh || cached || partial || errors || posters) {
                status.textContent = `وضعیت داده: OMDb ${fresh.toLocaleString('en-US')} • Cache ${cached.toLocaleString('en-US')} • Poster ${posters.toLocaleString('en-US')} • خطا ${errors.toLocaleString('en-US')}`;
            }
        }
    }

    function populateFilters() {
        const genres = new Set();
        const years = new Set();
        for (const movie of allMovies) {
            splitValues(movie.genres).forEach(g => genres.add(g));
            const y = getYearNumber(movie.year);
            if (y) years.add(String(y));
        }
        const genreEl = $('genreFilter');
        const yearEl = $('yearFilter');
        if (genreEl) genreEl.innerHTML = '<option value="all">همه</option>' + [...genres].sort((a,b) => a.localeCompare(b)).map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
        if (yearEl) yearEl.innerHTML = '<option value="all">همه</option>' + [...years].sort((a,b) => Number(b)-Number(a)).map(y => `<option value="${y}">${y}</option>`).join('');
    }

    function searchMatch(movie, query) {
        if (!query) return true;
        const blob = [
            movie.title,
            movie.original_title,
            movie.imdb_id,
            movie.series_title,
            movie.genres,
            movie.directors,
            movie.actors,
            movie.writer,
            movie.country,
            movie.language
        ].join(' ').toLowerCase();
        return blob.includes(query);
    }

    function applyFiltersAndSort(resetPage = true) {
        if (resetPage) currentPage = 1;
        filteredMovies = allMovies.filter(movie => {
            if (toNumber(movie.user_rating) < toNumber(currentFilters.minRating)) return false;
            if (currentFilters.genre !== 'all' && !splitValues(movie.genres).includes(currentFilters.genre)) return false;
            if (currentFilters.year !== 'all' && String(getYearNumber(movie.year)) !== String(currentFilters.year)) return false;
            if (currentFilters.type !== 'all' && movie.title_type !== currentFilters.type) return false;
            if (viewMode === 'movie' && movie.title_type !== 'Movie' && movie.title_type !== 'Short') return false;
            if (viewMode === 'series' && movie.title_type !== 'TV Episode' && movie.title_type !== 'TV Series') return false;
            return true;
        });
        sortMovies();
        renderMovies();
    }

    function sortMovies() {
        const parts = currentSort.split('-');
        const order = parts.pop();
        const field = parts.join('-');
        const desc = order === 'desc';
        filteredMovies.sort((a, b) => {
            if (field === 'title') {
                const va = String(a.title || '').toLowerCase();
                const vb = String(b.title || '').toLowerCase();
                return desc ? vb.localeCompare(va) : va.localeCompare(vb);
            }
            if (field === 'date_rated') {
                const va = getDateValue(a.date_rated);
                const vb = getDateValue(b.date_rated);
                return desc ? vb - va : va - vb;
            }
            if (field === 'year') {
                const va = getYearNumber(a.year);
                const vb = getYearNumber(b.year);
                return desc ? vb - va : va - vb;
            }
            const va = toNumber(a[field]);
            const vb = toNumber(b[field]);
            return desc ? vb - va : va - vb;
        });
    }

    function renderMovies() {
        const grid = $('moviesGrid');
        if (!grid) return;

        const total = filteredMovies.length;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        currentPage = Math.min(Math.max(1, currentPage), pages);

        if (!total) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted);"><span style="font-size:48px;">🎭</span><p style="margin-top:12px;">هیچ عنوانی پیدا نشد.</p></div>`;
            updatePaginationControls();
            return;
        }

        const start = (currentPage - 1) * pageSize;
        const visible = filteredMovies.slice(start, start + pageSize);

        grid.innerHTML = visible.map(movieCardHtml).join('');
        updatePaginationControls();
    }

    function movieCardHtml(movie) {
        const genres = splitValues(movie.genres).slice(0, 3)
            .map(g => `<span class="movie-genre-tag">${escapeHtml(g)}</span>`).join('');
        const poster = getLocalPosterUrl(movie) || getSafeString(movie.poster, '');
        const safeTitle = escapeHtml(movie.title);
        const posterHtml = poster
            ? `<img class="movie-poster" src="${escapeHtml(poster)}" alt="${safeTitle}" loading="lazy" decoding="async" data-poster-id="${escapeHtml(movie.imdb_id)}"><div class="movie-poster-placeholder" data-fallback-for="${escapeHtml(movie.imdb_id)}" style="display:none">🎬</div>`
            : `<div class="movie-poster-placeholder">🎬</div>`;
        const typeBadge = movie.title_type === 'TV Episode'
            ? '<div class="movie-type-badge">📺 قسمت</div>'
            : movie.title_type === 'TV Series'
                ? '<div class="movie-type-badge">📺 سریال</div>'
                : '';
        const rating = toNumber(movie.user_rating);
        const ratingBadge = rating > 0 ? `${ratingEmoji(rating)} ${ratingLabel(rating)}` : '';
        const ratedDate = movie.date_rated ? formatDate(movie.date_rated) : '';
        return `
        <div class="movie-card" data-imdb-id="${escapeHtml(movie.imdb_id)}" tabindex="0" role="button" aria-label="نمایش جزئیات ${safeTitle}">
            ${posterHtml}
            <div class="movie-info">
                <div class="movie-title">${safeTitle}</div>
                <div class="movie-year">${escapeHtml(movie.year || 'N/A')}</div>
                ${ratedDate ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">📅 ${escapeHtml(ratedDate)}</div>` : ''}
                <div class="movie-genres">${genres}</div>
                <div class="movie-rating">
                    <span class="user-rating">⭐ ${rating || '?'}</span>
                    <span class="imdb-rating">IMDb: ${escapeHtml(movie.imdb_rating || 'N/A')}</span>
                    ${ratingEmoji(rating) ? `<span title="${escapeHtml(ratingLabel(rating))}">${ratingEmoji(rating)}</span>` : ''}
                </div>
            </div>
            ${ratingBadge ? `<div class="movie-badge">${escapeHtml(ratingBadge)}</div>` : ''}
            ${typeBadge}
        </div>`;
    }

    function updatePaginationControls() {
        const bar = $('paginationBar');
        if (!bar) return;
        const total = filteredMovies.length;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const start = total ? (currentPage - 1) * pageSize + 1 : 0;
        const end = total ? Math.min(currentPage * pageSize, total) : 0;
        const summary = $('paginationSummary');
        if (summary) summary.textContent = `${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} از ${total.toLocaleString('en-US')}`;
        const setDisabled = (id, disabled) => { const el = $(id); if (el) el.disabled = disabled; };
        setDisabled('firstPageBtn', currentPage <= 1 || !total);
        setDisabled('prevPageBtn', currentPage <= 1 || !total);
        setDisabled('nextPageBtn', currentPage >= pages || !total);
        setDisabled('lastPageBtn', currentPage >= pages || !total);

        const box = $('pageNumbers');
        if (!box) return;
        if (pages <= 1) {
            box.innerHTML = '<button class="page-number active" type="button">1</button>';
            return;
        }
        const list = new Set([1, pages, currentPage, currentPage - 1, currentPage + 1, currentPage - 2, currentPage + 2]);
        const nums = [...list].filter(n => n >= 1 && n <= pages).sort((a,b) => a-b);
        let html = '';
        let previous = 0;
        for (const page of nums) {
            if (previous && page - previous > 1) html += '<span class="page-ellipsis">…</span>';
            html += `<button type="button" class="page-number${page === currentPage ? ' active' : ''}" data-page="${page}">${page}</button>`;
            previous = page;
        }
        box.innerHTML = html;
    }

    function goToPage(page, smooth = true) {
        const pages = Math.max(1, Math.ceil(filteredMovies.length / pageSize));
        const target = Math.min(Math.max(1, Number(page) || 1), pages);
        if (target === currentPage) return;
        currentPage = target;
        renderMovies();
        const grid = $('moviesGrid');
        if (grid) window.scrollTo({ top: Math.max(0, grid.getBoundingClientRect().top + window.scrollY - 80), behavior: smooth ? 'smooth' : 'auto' });
    }

    function updateStats() {
        const movies = allMovies.filter(m => m.title_type === 'Movie' || m.title_type === 'Short').length;
        const series = allMovies.filter(m => m.title_type === 'TV Episode' || m.title_type === 'TV Series').length;
        const episodes = allMovies.filter(m => m.is_episode || m.title_type === 'TV Episode').length;
        const totalMinutes = allMovies.reduce((sum, m) => sum + toNumber(String(m.runtime || '').match(/\d+/)?.[0]), 0);
        const rated = allMovies.filter(m => toNumber(m.user_rating) > 0);
        const avg = rated.length ? rated.reduce((sum, m) => sum + toNumber(m.user_rating), 0) / rated.length : 0;
        const genres = new Set();
        allMovies.forEach(m => splitValues(m.genres).forEach(g => genres.add(g)));

        if ($('totalMovies')) $('totalMovies').textContent = movies;
        if ($('totalSeries')) $('totalSeries').textContent = series;
        if ($('totalHours')) $('totalHours').textContent = formatCompactRuntime(totalMinutes);
        if ($('avgRating')) $('avgRating').textContent = avg ? avg.toFixed(1) : '0';
        if ($('totalGenres')) $('totalGenres').textContent = genres.size;
        if ($('statTotalEpisodes')) $('statTotalEpisodes').textContent = episodes;
    }

    function formatCompactRuntime(minutes) {
        const n = Number(minutes) || 0;
        const hours = Math.floor(n / 60);
        const mins = n % 60;
        if (hours && mins) return `${hours}س ${mins}د`;
        if (hours) return `${hours}س`;
        return `${mins}د`;
    }

    function updateFirstLast() {
        const sorted = [...allMovies].filter(m => m.date_rated).sort((a,b) => getDateValue(a.date_rated) - getDateValue(b.date_rated));
        if (!sorted.length) return;
        if ($('firstTitle')) $('firstTitle').textContent = sorted[0].title;
        if ($('firstDate')) $('firstDate').textContent = formatDate(sorted[0].date_rated);
        if ($('lastTitle')) $('lastTitle').textContent = sorted[sorted.length - 1].title;
        if ($('lastDate')) $('lastDate').textContent = formatDate(sorted[sorted.length - 1].date_rated);
    }

    function updateOmdbStatus() {
        const omdb = allMovies.filter(m => m.raw_omdb && Object.keys(m.raw_omdb).length > 0 || m.omdb_found);
        const posters = allMovies.filter(m => getLocalPosterUrl(m) || m.poster);
        const status = $('omdbStatus');
        if (!status) return;
        status.textContent = `وضعیت داده: ${omdb.length.toLocaleString('en-US')} رکورد غنی‌شده • ${posters.length.toLocaleString('en-US')} دارای پوستر/مسیر پوستر از ${allMovies.length.toLocaleString('en-US')}`;
    }

    function generateStats() {
        if (!allMovies.length || typeof Chart === 'undefined') return;
        destroyCharts();
        const directors = new Set();
        const years = new Set();
        const genreCount = {};
        const ratingDist = {};
        const yearCount = {};
        const monthCount = {};
        const genreRatings = {};
        let maxRating = 0;

        allMovies.forEach(movie => {
            splitValues(movie.directors).forEach(d => directors.add(d));
            const year = getYearNumber(movie.year);
            if (year) { years.add(year); yearCount[year] = (yearCount[year] || 0) + 1; }
            const rating = Math.round(toNumber(movie.user_rating));
            if (rating > 0) ratingDist[rating] = (ratingDist[rating] || 0) + 1;
            maxRating = Math.max(maxRating, toNumber(movie.user_rating));
            splitValues(movie.genres).forEach(g => {
                genreCount[g] = (genreCount[g] || 0) + 1;
                if (toNumber(movie.user_rating) > 0) {
                    genreRatings[g] ??= { sum: 0, count: 0 };
                    genreRatings[g].sum += toNumber(movie.user_rating);
                    genreRatings[g].count += 1;
                }
            });
            if (movie.date_rated) {
                const d = new Date(movie.date_rated);
                if (!Number.isNaN(d.getTime())) {
                    const month = d.getMonth() + 1;
                    monthCount[month] = (monthCount[month] || 0) + 1;
                }
            }
        });

        const topGenre = Object.entries(genreCount).sort((a,b) => b[1] - a[1])[0]?.[0] || '-';
        if ($('statDirectors')) $('statDirectors').textContent = directors.size;
        if ($('statYears')) $('statYears').textContent = years.size;
        if ($('statTopRating')) $('statTopRating').textContent = maxRating || 0;
        if ($('statTopGenre')) $('statTopGenre').textContent = topGenre;
        if ($('statAvgPerYear')) $('statAvgPerYear').textContent = years.size ? Math.round(allMovies.length / years.size) : 0;

        const colors = ['#e94560','#6c5ce7','#00d2d3','#fdcb6e','#e17055','#00b894','#0984e3','#fd79a8','#55efc4','#74b9ff','#a29bfe','#f0932b'];
        createChart('genreChart', 'bar', Object.entries(genreCount).sort((a,b) => b[1]-a[1]).slice(0,12).map(x => x[0]), Object.entries(genreCount).sort((a,b) => b[1]-a[1]).slice(0,12).map(x => x[1]), colors);
        const ratings = Object.entries(ratingDist).sort((a,b) => Number(a[0])-Number(b[0]));
        createChart('ratingChart', 'bar', ratings.map(x => `${x[0]}⭐`), ratings.map(x => x[1]), ['#ffd700','#fdcb6e','#f9ca24','#f0932b','#e94560','#e17055','#d63031','#6c5ce7','#0984e3','#00d2d3']);
        const yearsSorted = Object.entries(yearCount).sort((a,b) => Number(a[0])-Number(b[0])).slice(-15);
        createChart('yearChart', 'line', yearsSorted.map(x => x[0]), yearsSorted.map(x => x[1]), ['#e94560']);
        const monthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
        createChart('monthChart', 'bar', monthNames, Array.from({length:12}, (_,i) => monthCount[i+1] || 0), colors);
        const avgs = Object.entries(genreRatings).filter(([,v]) => v.count >= 3).map(([g,v]) => [g, Number((v.sum/v.count).toFixed(1))]).sort((a,b) => b[1]-a[1]).slice(0,15);
        createChart('genreRatingChart', 'bar', avgs.map(x => x[0]), avgs.map(x => x[1]), ['#ffd700','#fdcb6e','#f9ca24','#f0932b','#e94560','#e17055','#6c5ce7','#0984e3','#00d2d3','#00b894','#55efc4','#74b9ff','#a29bfe','#fd79a8','#fdcb6e']);
        const compareData = allMovies.filter(m => toNumber(m.user_rating) > 0 && toNumber(m.imdb_rating) > 0).slice(0,30).reverse();
        createChart('compareChart', 'bar', compareData.map(m => String(m.title).length > 20 ? `${String(m.title).slice(0,18)}…` : m.title), [compareData.map(m => toNumber(m.user_rating)), compareData.map(m => toNumber(m.imdb_rating))], ['#ffd700','#e94560'], ['امتیاز من','امتیاز IMDb']);

        const top = allMovies.filter(m => toNumber(m.user_rating) === 10).sort((a,b) => getDateValue(b.date_rated)-getDateValue(a.date_rated)).slice(0,20);
        const topEl = $('topMoviesList');
        if (topEl) topEl.innerHTML = top.length ? top.map((m,i) => `<div class="top-movie-item" data-id="${escapeHtml(m.imdb_id)}"><div class="top-movie-rank">#${i+1}</div><div class="top-movie-info"><div class="title">${escapeHtml(m.title)}</div><div class="year">${escapeHtml(m.year || 'N/A')} • ${escapeHtml(splitValues(m.genres).slice(0,2).join(', '))}</div></div><div class="top-movie-rating">⭐ ${m.user_rating} ${ratingEmoji(m.user_rating)}</div></div>`).join('') : '<p style="color:var(--text-muted);text-align:center;">هنوز عنوانی با امتیاز ۱۰ ثبت نشده است.</p>';
    }

    function createChart(id, type, labels, data, colors, labelsForDatasets) {
        const canvas = $(id);
        if (!canvas || typeof Chart === 'undefined') return;
        if (charts[id]) { try { charts[id].destroy(); } catch {} }
        const multiple = Array.isArray(data[0]);
        const datasets = multiple
            ? data.map((dataset, index) => ({ label: labelsForDatasets?.[index] || `Series ${index + 1}`, data: dataset, backgroundColor: colors[index] || '#e94560', borderColor: colors[index] || '#e94560', borderWidth: 2, borderRadius: 4, tension: .3 }))
            : [{ label: 'تعداد', data, backgroundColor: Array.isArray(colors) ? colors : ['#e94560'], borderColor: Array.isArray(colors) ? colors : ['#e94560'], borderWidth: 1, borderRadius: 4 }];
        charts[id] = new Chart(canvas.getContext('2d'), {
            type,
            data: { labels, datasets },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#a0a0b0', font: { family: 'Vazirmatn' } } } }, scales: { y: { beginAtZero: true, ticks: { color: '#a0a0b0' }, grid: { color: 'rgba(255,255,255,.05)' } }, x: { ticks: { color: '#a0a0b0', maxRotation: 45 }, grid: { color: 'rgba(255,255,255,.05)' } } } }
        });
    }

    function destroyCharts() {
        Object.values(charts).forEach(chart => { try { chart.destroy(); } catch {} });
        charts = {};
    }

    function openModal(id) {
        const movie = allMovies.find(x => String(x.imdb_id) === String(id));
        if (!movie) { warn('رکورد برای مودال پیدا نشد:', id); return; }
        const overlay = $('modalOverlay');
        if (!overlay) return;

        const image = $('modalPoster');
        const placeholder = $('modalPosterPlaceholder');
        const poster = getLocalPosterUrl(movie) || getSafeString(movie.poster, '');
        if (image) {
            image.onerror = () => { image.style.display = 'none'; if (placeholder) placeholder.style.display = 'flex'; };
            if (poster) { image.src = poster; image.alt = movie.title; image.style.display = 'block'; if (placeholder) placeholder.style.display = 'none'; }
            else { image.removeAttribute('src'); image.style.display = 'none'; if (placeholder) placeholder.style.display = 'flex'; }
        }

        const setText = (id2, value, fallback = 'N/A') => { const el = $(id2); if (el) el.textContent = getSafeString(value, fallback); };
        setText('modalTitle', movie.title, 'بدون عنوان');
        setText('modalYear', movie.year);
        setText('modalUserRating', movie.user_rating || '—');
        setText('modalImdbRating', movie.imdb_rating);
        setText('modalRuntime', formatRuntime(movie.runtime));
        setText('modalRated', movie.rated);
        setText('modalType', movie.title_type);
        setText('modalMood', `${ratingEmoji(movie.user_rating)} ${ratingLabel(movie.user_rating)}`);
        setText('modalPlot', movie.plot, '📝 اطلاعاتی در دسترس نیست.');
        setText('modalGenre', movie.genres);
        setText('modalDirector', movie.directors);
        setText('modalActors', movie.actors);
        setText('modalWriter', movie.writer);
        setText('modalReleased', movie.release_date);
        setText('modalVotes', movie.num_votes);
        setText('modalDateRated', formatDate(movie.date_rated));
        setText('modalOriginalTitle', movie.original_title || movie.title);
        setText('modalCountry', movie.country);
        setText('modalLanguage', movie.language);
        setText('modalAwards', movie.awards);
        setText('modalBoxOffice', movie.box_office);
        setText('modalProduction', movie.production);
        setText('modalMetascore', movie.metascore);

        const imdbLink = $('modalImdbLink');
        if (imdbLink) imdbLink.href = movie.url || `https://www.imdb.com/title/${encodeURIComponent(movie.imdb_id)}/`;

        const context = $('modalSeriesContext');
        if (context) {
            context.innerHTML = buildSeriesContext(movie);
        }

        const rawBlock = $('modalRawBlock');
        const rawData = $('modalRawData');
        const raw = JSON.stringify({ csv: movie.raw_csv, omdb: movie.raw_omdb }, null, 2);
        if (rawBlock && rawData) {
            rawBlock.hidden = !raw || raw === '{\n  "csv": {},\n  "omdb": {}\n}';
            rawData.textContent = raw;
            rawData.hidden = true;
            const button = $('toggleRawData');
            if (button) button.textContent = '🧾 نمایش اطلاعات خام';
        }

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function buildSeriesContext(movie) {
        const isSeries = movie.title_type === 'TV Series' || movie.is_episode || movie.series_id || movie.series_title;
        if (!isSeries) return '';
        const key = movie.series_id || movie.series_title || movie.imdb_id;
        const episodes = allMovies.filter(m => m.is_episode && ((movie.series_id && m.series_id === movie.series_id) || (movie.series_title && m.series_title === movie.series_title) || m.series_id === key));
        if (!episodes.length && movie.title_type !== 'TV Series') return '';
        const sorted = episodes.sort((a,b) => toNumber(a.season_number)-toNumber(b.season_number) || toNumber(a.episode_number)-toNumber(b.episode_number));
        const seasonSet = new Set(sorted.map(e => toNumber(e.season_number)).filter(Boolean));
        const items = sorted.slice(0, 80).map(e => `<span class="episode-pill">S${String(toNumber(e.season_number)).padStart(2,'0')} E${String(toNumber(e.episode_number)).padStart(2,'0')} • ${escapeHtml(e.episode_title || e.title)}</span>`).join('');
        return `<div class="episode-context"><h4>📺 ساختار سریالی</h4><div class="episode-pills"><span class="episode-pill">🎬 ${escapeHtml(movie.series_title || movie.title)}</span><span class="episode-pill">📚 ${seasonSet.size || movie.total_seasons || 0} فصل</span><span class="episode-pill">🎞️ ${episodes.length || movie.total_episodes || 0} قسمت</span></div>${items ? `<div class="episode-pills" style="margin-top:8px;max-height:180px;overflow:auto">${items}</div>` : ''}</div>`;
    }

    function closeModal() {
        const overlay = $('modalOverlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function toast(message, kind = 'ok') {
        let node = document.getElementById('classicToast');
        if (!node) {
            node = document.createElement('div');
            node.id = 'classicToast';
            node.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:5000;padding:12px 16px;border-radius:12px;background:rgba(10,10,26,.94);border:1px solid rgba(255,255,255,.1);box-shadow:0 15px 40px rgba(0,0,0,.35);color:#fff;font:12px Vazirmatn,sans-serif;opacity:0;transform:translateY(10px);transition:.25s ease;max-width:380px;pointer-events:none;';
            document.body.appendChild(node);
        }
        node.textContent = message;
        node.dataset.kind = kind;
        node.style.opacity = '1';
        node.style.transform = 'translateY(0)';
        clearTimeout(node.__timer);
        node.__timer = setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateY(10px)'; }, 3600);
    }

    function bindEvents() {
        safeAddEventListener('statsBtn', 'click', () => {
            const section = $('statsSection');
            if (!section) return;
            statsVisible = !statsVisible;
            section.style.display = statsVisible ? 'block' : 'none';
            const button = $('statsBtn');
            if (button) button.textContent = statsVisible ? '❌ بستن آمار' : '📈 آمار';
            if (statsVisible) setTimeout(generateStats, 50);
        });

        safeAddEventListener('filterBtn', 'click', () => $('filtersBar')?.classList.toggle('active'));
        safeAddEventListener('minRating', 'input', e => { currentFilters.minRating = toNumber(e.target.value); if ($('minRatingValue')) $('minRatingValue').textContent = e.target.value; applyFiltersAndSort(true); });
        safeAddEventListener('genreFilter', 'change', e => { currentFilters.genre = e.target.value; applyFiltersAndSort(true); });
        safeAddEventListener('yearFilter', 'change', e => { currentFilters.year = e.target.value; applyFiltersAndSort(true); });
        safeAddEventListener('typeFilter', 'change', e => { currentFilters.type = e.target.value; applyFiltersAndSort(true); });
        safeAddEventListener('resetFilters', 'click', () => {
            currentFilters = { minRating: 0, genre: 'all', year: 'all', type: 'all' };
            if ($('minRating')) $('minRating').value = '0';
            if ($('minRatingValue')) $('minRatingValue').textContent = '0';
            if ($('genreFilter')) $('genreFilter').value = 'all';
            if ($('yearFilter')) $('yearFilter').value = 'all';
            if ($('typeFilter')) $('typeFilter').value = 'all';
            applyFiltersAndSort(true);
        });

        safeAddEventListener('sortBtn', 'click', () => {
            const options = [
                ['date_rated-desc','📅 تاریخ (جدید به قدیم)'],['date_rated-asc','📅 تاریخ (قدیم به جدید)'],['user_rating-desc','⭐ امتیاز من (بالا به پایین)'],['user_rating-asc','⭐ امتیاز من (پایین به بالا)'],['imdb_rating-desc','⭐ IMDb (بالا به پایین)'],['title-asc','🔤 عنوان (الفبا)'],['year-desc','📅 سال (جدید به قدیم)']
            ];
            const choice = window.prompt(`مرتب‌سازی:\n${options.map((o,i)=>`${i+1}. ${o[1]}`).join('\n')}`);
            if (!choice) return;
            const index = Number.parseInt(choice, 10) - 1;
            if (options[index]) { currentSort = options[index][0]; applyFiltersAndSort(true); }
        });

        safeAddEventListener('toggleView', 'click', () => {
            const modes = ['all','movie','series'];
            const labels = ['📽️ همه','🎬 فیلم','📺 سریال'];
            viewMode = modes[(modes.indexOf(viewMode) + 1) % modes.length];
            const button = $('toggleView'); if (button) button.textContent = labels[modes.indexOf(viewMode)];
            applyFiltersAndSort(true);
        });

        safeAddEventListener('firstPageBtn', 'click', () => goToPage(1));
        safeAddEventListener('prevPageBtn', 'click', () => goToPage(currentPage - 1));
        safeAddEventListener('nextPageBtn', 'click', () => goToPage(currentPage + 1));
        safeAddEventListener('lastPageBtn', 'click', () => goToPage(Math.ceil(filteredMovies.length / pageSize)));
        safeAddEventListener('pageSizeSelect', 'change', e => { const n = Number(e.target.value); if ([12,24,36,48].includes(n)) { pageSize = n; currentPage = 1; savePageSize(); renderMovies(); } });

        $('pageNumbers')?.addEventListener('click', e => {
            const button = e.target.closest('[data-page]');
            if (button) goToPage(Number(button.dataset.page));
        });

        // Critical: delegated card click survives every pagination re-render.
        $('moviesGrid')?.addEventListener('click', e => {
            const card = e.target.closest('.movie-card');
            if (card) openModal(card.dataset.imdbId);
        });

        $('moviesGrid')?.addEventListener('keydown', e => {
            const card = e.target.closest('.movie-card');
            if (card && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                openModal(card.dataset.imdbId);
            }
        });

        $('topMoviesList')?.addEventListener('click', e => {
            const row = e.target.closest('[data-id]');
            if (row) openModal(row.dataset.id);
        });

        safeAddEventListener('modalClose', 'click', closeModal);
        $('modalOverlay')?.addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });
        safeAddEventListener('toggleRawData', 'click', () => {
            const raw = $('modalRawData');
            const button = $('toggleRawData');
            if (!raw) return;
            raw.hidden = !raw.hidden;
            if (button) button.textContent = raw.hidden ? '🧾 نمایش اطلاعات خام' : '🧾 مخفی کردن اطلاعات خام';
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeModal();
            if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
                e.preventDefault();
                $('filterBtn')?.click();
            }
        });

        document.addEventListener('error', e => {
            const img = e.target;
            if (!(img instanceof HTMLImageElement)) return;
            if (!img.classList.contains('movie-poster')) return;
            const fallback = img.parentElement?.querySelector('[data-fallback-for]');
            if (fallback) fallback.style.display = 'flex';
            img.style.display = 'none';
        }, true);
    }

    function initializeControls() {
        if ($('pageSizeSelect')) $('pageSizeSelect').value = String(pageSize);
        if ($('minRating')) $('minRating').value = String(currentFilters.minRating);
        if ($('minRatingValue')) $('minRatingValue').textContent = String(currentFilters.minRating);
    }

    window.openModal = openModal;
    window.closeModal = closeModal;
    window.goToPage = goToPage;

    window.addEventListener('error', e => console.error('[IMDb Classic] runtime error', e.error || e.message || e), { passive: true });
    window.addEventListener('unhandledrejection', e => console.error('[IMDb Classic] unhandled rejection', e.reason), { passive: true });

    bindEvents();
    initializeControls();

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadMovies, { once: true });
    else loadMovies();
})();
