(() => {
  'use strict';

  const DATA_URL = 'movies.json';
  const CACHE_KEY = 'imdb-showcase-cache-v6';
  const SETTINGS_KEY = 'imdb-showcase-settings-v6';

  const state = {
    movies: [],
    filtered: [],
    latest: [],
    seriesGroups: [],
    currentId: null,
    page: 1,
    pageSize: 24,
    view: 'card',
    sort: 'date_rated-desc',
    filters: {
      q: '',
      type: 'all',
      genre: 'all',
      year: 'all',
      minRating: 0,
      freshness: 'all',
      serial: 'all'
    },
    charts: {},
    searchTimer: null,
    resizeTimer: null,
    searchIndex: new Map()
  };

  const $ = id => document.getElementById(id);

  const safe = (value, fallback = '—') => {
    if (value === undefined || value === null || value === '' || value === 'N/A') return fallback;
    return String(value);
  };

  const num = value => {
    const n = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);

  const arr = value => {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    return String(value || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  };

  const parseYear = value => {
    const match = String(value || '').match(/\b(?:18|19|20)\d{2}\b/);
    return match ? match[0] : '';
  };

  const parseDate = value => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const dateValue = value => parseDate(value)?.getTime() || 0;

  const localDate = value => {
    const d = parseDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(d);
  };

  const formatNumber = value => Number(value || 0).toLocaleString('fa-IR');

  function runtimeMinutes(value) {
    if (typeof value === 'number') return Math.max(0, Math.round(value));
    const text = String(value || '').trim();
    if (!text) return 0;
    const hm = text.match(/(\d+)\s*h(?:\s*(\d+)\s*m)?/i);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
    const min = text.match(/(\d+(?:\.\d+)?)\s*(?:min|minutes?)/i);
    if (min) return Math.round(Number(min[1]));
    const numeric = num(text);
    return numeric > 0 ? Math.round(numeric) : 0;
  }

  function runtimeLabel(value) {
    const minutes = runtimeMinutes(value);
    if (!minutes) return safe(value);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return `${h} ساعت و ${m} دقیقه`;
    if (h) return `${h} ساعت`;
    return `${m} دقیقه`;
  }

  function totalRuntimeLabel(records) {
    return runtimeLabel(records.reduce((sum, movie) => sum + runtimeMinutes(movie.runtime), 0));
  }

  function freshness(movie) {
    return movie.data_status || (movie.omdb_found === false ? 'stale' : 'fresh');
  }

  function typeLabel(movie) {
    if (movie.is_episode || movie.title_type === 'TV Episode') return 'قسمت';
    if (movie.title_type === 'TV Series') return 'سریال';
    if (movie.title_type === 'Movie') return 'فیلم';
    if (movie.title_type === 'Short') return 'کوتاه';
    return safe(movie.title_type, 'عنوان');
  }

  function statusLabel(movie) {
    const f = freshness(movie);
    if (f === 'fresh') return 'به‌روز';
    if (f === 'stale') return 'حفظ‌شده';
    if (f === 'partial') return 'ناقص';
    return 'نامشخص';
  }

  function posterFallback(movie) {
    const title = safe(movie.title, 'Untitled');
    const initials = title
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(word => word[0] || '')
      .join('')
      .toUpperCase() || 'IM';

    const palettes = [
      ['#ff466b', '#7258ff'],
      ['#00d5c8', '#315fff'],
      ['#ff9f43', '#e83f72'],
      ['#6178ff', '#a34cff'],
      ['#009df5', '#7c2cff'],
      ['#e14b83', '#2477ff']
    ];

    let seed = 0;
    for (const char of title) seed = (seed * 31 + char.codePointAt(0)) >>> 0;
    const palette = palettes[seed % palettes.length];
    const label = movie.is_episode ? 'EPISODE' : movie.title_type === 'TV Series' ? 'SERIES' : 'CINEMA';
    const year = parseYear(movie.year) || '—';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/>
        </linearGradient>
        <radialGradient id="r" cx="25%" cy="10%" r="90%">
          <stop offset="0" stop-color="#fff" stop-opacity=".27"/>
          <stop offset="1" stop-color="#000" stop-opacity=".42"/>
        </radialGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="34"/></filter>
      </defs>
      <rect width="600" height="900" fill="#080811"/>
      <rect width="600" height="900" fill="url(#g)"/>
      <circle cx="70" cy="130" r="180" fill="#fff" opacity=".15" filter="url(#blur)"/>
      <circle cx="520" cy="700" r="220" fill="#000" opacity=".27" filter="url(#blur)"/>
      <rect width="600" height="900" fill="url(#r)"/>
      <path d="M0 640 C170 560 270 825 600 600 L600 900 L0 900Z" fill="#05050a" opacity=".60"/>
      <circle cx="470" cy="170" r="74" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>
      <circle cx="470" cy="170" r="42" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="2"/>
      <text x="40" y="72" fill="#fff" opacity=".72" font-family="Arial,sans-serif" font-size="21" letter-spacing="5">${label}</text>
      <text x="40" y="730" fill="#fff" font-family="Arial,sans-serif" font-size="86" font-weight="800">${esc(initials)}</text>
      <text x="40" y="790" fill="#fff" opacity=".9" font-family="Arial,sans-serif" font-size="25">${esc(year)}</text>
      <text x="40" y="840" fill="#fff" opacity=".62" font-family="Arial,sans-serif" font-size="17" letter-spacing="3">NO POSTER AVAILABLE</text>
    </svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function posterSrc(movie) {
    return movie.poster && movie.poster !== 'N/A' ? movie.poster : posterFallback(movie);
  }

  function setImgWithFallback(img, movie) {
    if (!img) return;
    const fallback = posterFallback(movie);
    img.onerror = () => {
      if (img.dataset.fallbackApplied === '1') return;
      img.dataset.fallbackApplied = '1';
      img.src = fallback;
    };
    img.src = posterSrc(movie);
  }

  function toast(message, kind = 'ok') {
    const stack = $('toastStack');
    if (!stack) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    stack.appendChild(node);
    window.setTimeout(() => node.remove(), 3600);
  }

  function saveCache(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        payload
      }));
    } catch (_) {}
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        filters: state.filters,
        sort: state.sort,
        view: state.view,
        pageSize: state.pageSize
      }));
    } catch (_) {}
  }

  function restoreSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!raw) return;
      state.filters = { ...state.filters, ...(raw.filters || {}) };
      state.sort = raw.sort || state.sort;
      state.view = raw.view === 'list' ? 'list' : 'card';
      state.pageSize = [12, 24, 36, 48].includes(Number(raw.pageSize)) ? Number(raw.pageSize) : state.pageSize;
    } catch (_) {}
  }

  async function fetchJson(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${url}?v=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.movies)) throw new Error('Invalid movies.json schema');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeMovies(items) {
    return (Array.isArray(items) ? items : []).map((movie, index) => {
      const raw = movie.raw_csv && typeof movie.raw_csv === 'object' ? movie.raw_csv : {};
      const mergedRaw = { ...raw, ...movie };
      const normalized = {
        ...movie,
        imdb_id: safe(movie.imdb_id, `unknown-${index}`),
        title: safe(movie.title, 'بدون عنوان'),
        original_title: safe(movie.original_title, movie.title),
        year: safe(movie.year),
        user_rating: num(movie.user_rating),
        date_rated: movie.date_rated || '',
        title_type: safe(movie.title_type, 'Other'),
        imdb_rating: safe(movie.imdb_rating),
        runtime: safe(movie.runtime),
        genres: safe(movie.genres, 'N/A'),
        num_votes: safe(movie.num_votes),
        release_date: safe(movie.release_date),
        directors: safe(movie.directors),
        actors: safe(movie.actors),
        writer: safe(movie.writer),
        url: safe(movie.url, ''),
        poster: safe(movie.poster, ''),
        plot: safe(movie.plot),
        rated: safe(movie.rated),
        country: safe(movie.country),
        language: safe(movie.language),
        awards: safe(movie.awards),
        box_office: safe(movie.box_office),
        production: safe(movie.production),
        website: safe(movie.website, ''),
        metascore: safe(movie.metascore),
        ratings: Array.isArray(movie.ratings) ? movie.ratings : [],
        series_id: safe(movie.series_id, ''),
        series_title: safe(movie.series_title, ''),
        season_number: num(movie.season_number),
        episode_number: num(movie.episode_number),
        episode_title: safe(movie.episode_title, movie.title),
        total_seasons: num(movie.total_seasons),
        total_episodes: num(movie.total_episodes),
        is_episode: movie.is_episode === true || movie.title_type === 'TV Episode',
        data_status: freshness(movie),
        data_stale_reason: safe(movie.data_stale_reason, ''),
        data_fetched_at: safe(movie.data_fetched_at, ''),
        omdb_found: movie.omdb_found !== false,
        fields_fresh: Array.isArray(movie.fields_fresh) ? movie.fields_fresh : [],
        raw_csv: mergedRaw
      };
      normalized.search_text = buildSearchText(normalized);
      return normalized;
    });
  }

  function buildSearchText(movie) {
    const values = [];
    for (const [key, value] of Object.entries(movie)) {
      if (key === 'search_text') continue;
      if (Array.isArray(value)) values.push(value.join(' '));
      else if (value && typeof value === 'object') values.push(Object.values(value).join(' '));
      else values.push(String(value ?? ''));
    }
    return values.join(' ').toLocaleLowerCase('fa');
  }

  async function loadData() {
    renderSkeletons();
    const cached = loadCache();

    try {
      const data = await fetchJson(DATA_URL);
      state.movies = normalizeMovies(data.movies);
      saveCache({
        last_manual_update: data.last_manual_update || '',
        data_meta: data.data_meta || {},
        movies: state.movies
      });
      finalizeLoad(data, 'online');
      toast('داده‌ها با موفقیت به‌روز شدند.', 'ok');
    } catch (error) {
      console.warn('Live dataset unavailable:', error);

      if (cached?.payload?.movies?.length) {
        state.movies = normalizeMovies(cached.payload.movies);
        finalizeLoad(cached.payload, 'cached');
        toast('اتصال به Dataset جدید ناموفق بود؛ آخرین نسخه سالم استفاده شد.', 'warn');
      } else {
        state.movies = [];
        updateHealth(null, 'error');
        hide($('skeletonGrid'));
        show($('emptyState'));
        $('emptyText').textContent = 'movies.json در دسترس نیست یا ساختار آن معتبر نیست.';
        hide($('paginationBar'));
        toast('بارگذاری داده‌ها شکست خورد.', 'error');
      }
    }
  }

  function finalizeLoad(meta, mode) {
    restoreSettings();
    state.page = 1;
    syncControls();
    populateFilters();
    buildSeriesCache();
    rebuildSearchIndex();
    applyFilters(false);
    renderLatest();
    updateHeaderStats();
    updateFirstLast(meta);
    updateHealth(meta, mode);
    hide($('skeletonGrid'));
    $('lastUpdate').textContent = `آخرین به‌روزرسانی: ${safe(meta?.last_manual_update)}`;
    const dm = meta?.data_meta || {};
    $('omdbStatus').textContent = `OMDb: ${formatNumber(dm.omdb_success)} موفق • ${formatNumber(dm.omdb_stale)} حفظ‌شده • ${formatNumber(dm.omdb_partial)} ناقص`;
  }

  function rebuildSearchIndex() {
    state.searchIndex = new Map(state.movies.map(movie => [movie.imdb_id, movie.search_text]));
  }

  function updateHealth(meta, mode) {
    const card = $('dataHealthCard');
    if (!card) return;

    if (!meta) {
      setText('dataHealth', 'نامشخص');
      setText('dataMeta', 'Dataset در دسترس نیست');
      card.dataset.state = 'error';
      return;
    }

    const dm = meta.data_meta || {};

    if (mode === 'online') {
      setText('dataHealth', 'LIVE');
      setText('dataMeta', `${formatNumber(dm.updated_records)} رکورد • ${formatNumber(dm.api_errors)} خطا`);
      card.dataset.state = Number(dm.api_errors || 0) ? 'warning' : 'ok';
    } else {
      setText('dataHealth', 'CACHED');
      setText('dataMeta', 'آخرین Dataset سالم حفظ شده است');
      card.dataset.state = 'warning';
    }
  }

  function updateFirstLast(meta) {
    const rated = state.movies.filter(movie => movie.date_rated).sort((a, b) => dateValue(a.date_rated) - dateValue(b.date_rated));
    const first = rated[0];
    const last = rated[rated.length - 1];
    setText('firstTitle', first?.title || '—');
    setText('firstDate', first ? localDate(first.date_rated) : '—');
    setText('lastTitle', last?.title || '—');
    setText('lastDate', last ? localDate(last.date_rated) : '—');
    setText('dataSnapshot', meta?.data_meta ? `${formatNumber(meta.data_meta.updated_records)} records` : '—');
  }

  function populateFilters() {
    const genres = new Set();
    const years = new Set();
    for (const movie of state.movies) {
      arr(movie.genres).forEach(g => genres.add(g));
      const year = parseYear(movie.year);
      if (year) years.add(year);
    }
    $('genreFilter').innerHTML = `<option value="all">همه</option>${[...genres].sort((a,b) => a.localeCompare(b)).map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}`;
    $('yearFilter').innerHTML = `<option value="all">همه</option>${[...years].sort((a,b) => Number(b)-Number(a)).map(y => `<option value="${y}">${y}</option>`).join('')}`;
  }

  function applyFilters(resetPage = true) {
    if (resetPage) state.page = 1;
    const f = state.filters;
    const query = f.q.trim().toLocaleLowerCase('fa');

    state.filtered = state.movies.filter(movie => {
      if (query && !(state.searchIndex.get(movie.imdb_id) || '').includes(query)) return false;

      if (f.type !== 'all') {
        if (f.type === 'Other') {
          if (['Movie', 'TV Series', 'TV Episode', 'Short'].includes(movie.title_type)) return false;
        } else if (movie.title_type !== f.type) {
          return false;
        }
      }

      if (f.genre !== 'all' && !arr(movie.genres).includes(f.genre)) return false;
      if (f.year !== 'all' && parseYear(movie.year) !== f.year) return false;
      if (num(movie.user_rating) < Number(f.minRating)) return false;
      if (f.freshness !== 'all' && freshness(movie) !== f.freshness) return false;
      if (f.serial === 'series-only' && movie.title_type !== 'TV Series') return false;
      if (f.serial === 'episodes' && !movie.is_episode) return false;
      if (f.serial === 'groupable' && !(movie.series_id || movie.series_title)) return false;
      return true;
    });

    sortFiltered();
    renderMovies();
    updateFilterCounter();
    updateResultsCount();
    saveSettings();
  }

  function sortFiltered() {
    const [field, direction] = state.sort.split('-');
    state.filtered.sort((a, b) => {
      if (field === 'title') {
        const av = a.title.toLocaleLowerCase('fa');
        const bv = b.title.toLocaleLowerCase('fa');
        return direction === 'asc' ? av.localeCompare(bv, 'fa') : bv.localeCompare(av, 'fa');
      }
      if (field === 'date_rated') {
        const diff = dateValue(a.date_rated) - dateValue(b.date_rated);
        return direction === 'asc' ? diff : -diff;
      }
      if (field === 'year') {
        const diff = num(parseYear(a.year)) - num(parseYear(b.year));
        return direction === 'asc' ? diff : -diff;
      }
      const av = num(a[field]);
      const bv = num(b[field]);
      return direction === 'asc' ? av - bv : bv - av;
    });
  }

  function renderSkeletons() {
    const count = Math.min(state.pageSize, 12);
    $('skeletonGrid').innerHTML = Array.from({ length: count }, () => '<div class="skeleton"><div class="sk-poster"></div><div class="sk-body"><div class="sk-line"></div><div class="sk-line w70"></div><div class="sk-line w45"></div></div></div>').join('');
    show($('skeletonGrid'));
  }

  function cardHtml(movie) {
    const stale = freshness(movie) !== 'fresh';
    const episode = movie.is_episode;
    const tags = arr(movie.genres).slice(0, 4).map(g => `<span class="tag">${esc(g)}</span>`).join('');
    const episodeMeta = episode ? `<div class="episode-meta"><span class="pill">S${String(movie.season_number || 0).padStart(2,'0')}</span><span class="pill">E${String(movie.episode_number || 0).padStart(2,'0')}</span>${movie.series_title ? `<span class="pill series-pill">${esc(movie.series_title)}</span>` : ''}</div>` : '';

    return `<article class="movie-card ${!movie.poster ? 'no-poster-card' : ''}" data-id="${esc(movie.imdb_id)}" tabindex="0" role="button" aria-label="جزئیات ${esc(movie.title)}">
      <div class="poster-wrap">
        <img class="movie-poster" data-poster-id="${esc(movie.imdb_id)}" src="${esc(posterSrc(movie))}" alt="${esc(movie.title)}" loading="lazy" decoding="async">
        <div class="poster-shine"></div>
        <div class="poster-bottom-glow"></div>
        <div class="card-top"><span class="badge accent">${esc(typeLabel(movie))}</span><span class="badge ${stale ? 'stale' : 'ok'}">${esc(statusLabel(movie))}</span></div>
        <div class="poster-bottom-info"><span>${esc(parseYear(movie.year) || '—')}</span><b>⭐ ${movie.user_rating || '—'}</b></div>
      </div>
      <div class="card-body">
        <div class="movie-title">${esc(movie.title)}</div>
        <div class="movie-sub">${movie.date_rated ? esc(localDate(movie.date_rated)) : ''}${movie.series_title ? ` • ${esc(movie.series_title)}` : ''}</div>
        ${episodeMeta}
        <div class="card-tags">${tags}</div>
        <div class="rating-line"><span class="rating-user">⭐ ${movie.user_rating || '—'}</span><span class="rating-imdb">IMDb ${safe(movie.imdb_rating)}</span></div>
        <div class="card-extra-line"><span>${esc(runtimeLabel(movie.runtime))}</span><span>${formatNumber(num(movie.num_votes))} رأی</span></div>
      </div>
    </article>`;
  }

  function renderMovies() {
    const grid = $('moviesGrid');
    grid.classList.toggle('list-view', state.view === 'list');
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;

    const start = (state.page - 1) * state.pageSize;
    const pageItems = state.filtered.slice(start, start + state.pageSize);

    if (!pageItems.length) {
      grid.innerHTML = '';
      show($('emptyState'));
      hide($('paginationBar'));
      return;
    }

    hide($('emptyState'));
    show($('paginationBar'));
    grid.innerHTML = pageItems.map(cardHtml).join('');
    wirePageImages(pageItems);
    renderPagination();
  }

  function wirePageImages(items) {
    for (const movie of items) {
      const img = document.querySelector(`img[data-poster-id="${CSS.escape(movie.imdb_id)}"]`);
      if (img) setImgWithFallback(img, movie);
    }
  }

  function renderPagination() {
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    const start = total ? (state.page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(state.page * state.pageSize, total);

    $('paginationSummary').textContent = total ? `${formatNumber(start)} تا ${formatNumber(end)} از ${formatNumber(total)} عنوان` : '۰ عنوان';
    $('firstPage').disabled = state.page <= 1;
    $('prevPage').disabled = state.page <= 1;
    $('nextPage').disabled = state.page >= pages;
    $('lastPage').disabled = state.page >= pages;

    const maxButtons = window.innerWidth < 600 ? 5 : 7;
    let from = Math.max(1, state.page - Math.floor(maxButtons / 2));
    let to = Math.min(pages, from + maxButtons - 1);
    from = Math.max(1, to - maxButtons + 1);

    const buttons = [];
    if (from > 1) {
      buttons.push('<button class="page-number" data-page="1">1</button>');
      if (from > 2) buttons.push('<span class="page-ellipsis">…</span>');
    }
    for (let i = from; i <= to; i++) buttons.push(`<button class="page-number ${i === state.page ? 'active' : ''}" data-page="${i}">${i.toLocaleString('fa-IR')}</button>`);
    if (to < pages) {
      if (to < pages - 1) buttons.push('<span class="page-ellipsis">…</span>');
      buttons.push(`<button class="page-number" data-page="${pages}">${pages.toLocaleString('fa-IR')}</button>`);
    }
    $('pageNumbers').innerHTML = buttons.join('');
  }

  function goToPage(page) {
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    const next = Math.min(Math.max(1, Number(page) || 1), pages);
    if (next === state.page) return;
    state.page = next;
    renderMovies();
    requestAnimationFrame(() => {
      const top = $('libraryHeading')?.getBoundingClientRect().top + window.scrollY - 125;
      if (Number.isFinite(top)) window.scrollTo({ top, behavior: 'smooth' });
    });
  }

  function renderLatest() {
    const latest = [...state.movies]
      .filter(movie => movie.date_rated)
      .sort((a, b) => dateValue(b.date_rated) - dateValue(a.date_rated))
      .slice(0, 10);
    state.latest = latest;

    $('latestRail').innerHTML = latest.length ? latest.map((movie, index) => `
      <article class="latest-card" data-id="${esc(movie.imdb_id)}" tabindex="0" role="button">
        <span class="latest-rank">#${index + 1}</span>
        <div class="latest-poster-wrap"><img data-latest-id="${esc(movie.imdb_id)}" src="${esc(posterSrc(movie))}" alt="${esc(movie.title)}" loading="lazy"></div>
        <div class="latest-copy"><strong>${esc(movie.title)}</strong><span>${esc(localDate(movie.date_rated))}</span><em>⭐ ${movie.user_rating || '—'} • ${esc(typeLabel(movie))}</em></div>
      </article>`).join('') : '<div class="source-note">هنوز عنوانی با Date Rated در Dataset وجود ندارد.</div>';

    for (const movie of latest) {
      const img = document.querySelector(`img[data-latest-id="${CSS.escape(movie.imdb_id)}"]`);
      if (img) setImgWithFallback(img, movie);
    }
  }

  function buildSeriesCache() {
    const map = new Map();
    for (const movie of state.movies) {
      const isSeriesLike = movie.is_episode || movie.title_type === 'TV Series' || movie.series_id || movie.series_title;
      if (!isSeriesLike) continue;
      const key = movie.series_id || movie.series_title || movie.imdb_id;
      if (!map.has(key)) map.set(key, { key, title: movie.series_title || movie.title, poster: movie.poster || '', series: null, episodes: [] });
      const group = map.get(key);
      if (!group.poster && movie.poster) group.poster = movie.poster;
      if (movie.is_episode) group.episodes.push(movie);
      else if (!group.series && movie.title_type === 'TV Series') group.series = movie;
    }
    state.seriesGroups = [...map.values()].filter(g => g.series || g.episodes.length);
    state.seriesGroups.sort((a, b) => a.title.localeCompare(b.title, 'fa'));
    renderSeriesHub();
  }

  function renderSeriesHub() {
    const groups = state.seriesGroups.slice(0, 36);
    $('seriesCount').textContent = `${formatNumber(state.seriesGroups.length)} مجموعه`;

    $('seriesGrid').innerHTML = groups.length ? groups.map(group => {
      const eps = [...group.episodes].sort((a,b) => num(a.season_number)-num(b.season_number) || num(a.episode_number)-num(b.episode_number));
      const seasons = new Set(eps.map(e => e.season_number).filter(Boolean)).size;
      const rated = eps.filter(e => e.user_rating > 0).length;
      const runtime = totalRuntimeLabel(eps);
      const progress = eps.length ? Math.round((rated / eps.length) * 100) : 0;
      const target = group.series || eps[0];
      return `<article class="series-card" data-series="${esc(group.key)}" tabindex="0" role="button">
        <div class="series-cover"><img data-series-id="${esc(group.key)}" src="${esc(posterSrc(target || group))}" alt="${esc(group.title)}" loading="lazy"><div class="series-cover-glow"></div></div>
        <div class="series-card-body">
          <div class="series-card-topline"><span class="pill">SERIES</span>${seasons ? `<span class="pill">${seasons} فصل</span>` : ''}</div>
          <div class="series-title">${esc(group.title)}</div>
          <div class="series-meta">${eps.length ? `${eps.length} قسمت • ${esc(runtime)}` : 'اطلاعات قسمت محدود'}</div>
          <div class="series-badges"><span class="pill">${rated}/${eps.length || 0} امتیاز</span><span class="pill">${progress}% پوشش</span></div>
          <div class="progress"><i style="width:${progress}%"></i></div>
        </div>
      </article>`;
    }).join('') : '<div class="source-note">مجموعه سریالی قابل گروه‌بندی در Dataset پیدا نشد.</div>';

    for (const group of groups) {
      const target = group.series || group.episodes[0] || group;
      const img = document.querySelector(`img[data-series-id="${CSS.escape(group.key)}"]`);
      if (img) setImgWithFallback(img, target);
    }
  }

  function updateHeaderStats() {
    const movies = state.movies.filter(m => m.title_type === 'Movie' || m.title_type === 'Short');
    const series = state.movies.filter(m => m.title_type === 'TV Series');
    const episodes = state.movies.filter(m => m.is_episode);
    const rated = state.movies.filter(m => m.user_rating > 0);
    const totalMinutes = state.movies.reduce((sum, m) => sum + runtimeMinutes(m.runtime), 0);
    const genres = new Set();
    state.movies.forEach(m => arr(m.genres).forEach(g => genres.add(g)));
    const avg = rated.length ? rated.reduce((sum,m) => sum + m.user_rating, 0) / rated.length : 0;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    setText('totalTitles', formatNumber(state.movies.length));
    setText('totalMovies', formatNumber(movies.length));
    setText('totalSeries', formatNumber(series.length));
    setText('totalEpisodes', formatNumber(episodes.length));
    setText('totalHours', formatNumber(hours));
    setText('totalMinutes', `${String(minutes).padStart(2,'0')} دقیقه`);
    setText('avgRating', avg.toFixed(1));
    setText('genreCount', formatNumber(genres.size));
    setText('heroCount', formatNumber(state.movies.length));
    setText('heroSub', `${formatNumber(rated.length)} امتیاز ثبت‌شده • ${formatNumber(state.seriesGroups.length)} مجموعه`);

    const progress = state.movies.length ? Math.round((rated.length / state.movies.length) * 100) : 0;
    setText('heroPulse', `${progress}%`);
    if ($('heroPulseBar')) $('heroPulseBar').style.width = `${progress}%`;
  }

  function updateResultsCount() {
    setText('resultsCount', `${formatNumber(state.filtered.length)} نتیجه`);
    setText('sortLabel', sortLabel(state.sort));
  }

  function sortLabel(value) {
    return ({
      'date_rated-desc': 'جدیدترین',
      'date_rated-asc': 'قدیمی‌ترین',
      'user_rating-desc': 'بالاترین امتیاز',
      'user_rating-asc': 'پایین‌ترین امتیاز',
      'imdb_rating-desc': 'IMDb بالا',
      'imdb_rating-asc': 'IMDb پایین',
      'title-asc': 'الفبا A→Z',
      'title-desc': 'الفبا Z→A',
      'year-desc': 'سال جدید',
      'year-asc': 'سال قدیم'
    })[value] || value;
  }

  function updateFilterCounter() {
    const f = state.filters;
    const count = [
      f.q,
      f.type !== 'all',
      f.genre !== 'all',
      f.year !== 'all',
      Number(f.minRating) > 0,
      f.freshness !== 'all',
      f.serial !== 'all'
    ].filter(Boolean).length;
    setText('activeFilterCount', count);
  }

  function syncControls() {
    $('searchInput').value = state.filters.q;
    $('typeFilter').value = state.filters.type;
    $('genreFilter').value = state.filters.genre;
    $('yearFilter').value = state.filters.year;
    $('minRating').value = state.filters.minRating;
    $('minRatingValue').textContent = state.filters.minRating;
    $('freshnessFilter').value = state.filters.freshness;
    $('serialFilter').value = state.filters.serial;
    $('pageSize').value = String(state.pageSize);
    $('viewBtn').textContent = `نمایش: ${state.view === 'card' ? 'کارت' : 'لیست'}`;
  }

  function resetDetailPanels() {
    ['seriesPanel','episodePanel'].forEach(id => hide($(id)));
    if ($('seriesSummary')) $('seriesSummary').innerHTML = '';
    if ($('seasonList')) $('seasonList').innerHTML = '';
  }

  function openModal(id, forceSeries = false, seriesKey = null) {
    const movie = state.movies.find(m => m.imdb_id === id);
    if (!movie) {
      toast('جزئیات این عنوان در Dataset پیدا نشد.', 'error');
      return;
    }

    state.currentId = id;
    resetDetailPanels();

    setText('modalTypeBadge', typeLabel(movie).toUpperCase());
    setText('modalDataStatus', statusLabel(movie));
    setText('modalTitle', movie.title);
    setText('modalYearLarge', parseYear(movie.year) || '—');
    setText('modalOriginalTitle', movie.original_title);
    setText('modalUserRating', movie.user_rating || '—');
    setText('modalImdbRating', movie.imdb_rating);
    setText('modalMetascore', movie.metascore);
    setText('modalVotesTop', formatNumber(num(movie.num_votes)));
    setText('modalPlot', movie.plot || 'توضیحی برای این عنوان ذخیره نشده است.');
    setText('modalYear', movie.year);
    setText('modalRuntime', runtimeLabel(movie.runtime));
    setText('modalRated', movie.rated);
    setText('modalReleased', movie.release_date);
    setText('modalGenre', movie.genres);
    setText('modalDirector', movie.directors);
    setText('modalWriter', movie.writer);
    setText('modalActors', movie.actors);
    setText('modalCountry', movie.country);
    setText('modalLanguage', movie.language);
    setText('modalDateRated', localDate(movie.date_rated));
    setText('modalAwards', movie.awards);
    setText('modalBoxOffice', movie.box_office);
    setText('modalProduction', movie.production);

    $('modalTags').innerHTML = [
      ...arr(movie.genres).map(g => `<span class="tag">${esc(g)}</span>`),
      `<span class="tag">${esc(typeLabel(movie))}</span>`,
      movie.year ? `<span class="tag">${esc(parseYear(movie.year) || movie.year)}</span>` : '',
      movie.series_title ? `<span class="tag">${esc(movie.series_title)}</span>` : '',
      movie.season_number ? `<span class="tag">S${movie.season_number}</span>` : '',
      movie.episode_number ? `<span class="tag">E${movie.episode_number}</span>` : '',
      `<span class="tag status-tag">${esc(statusLabel(movie))}</span>`
    ].filter(Boolean).join('');

    const poster = $('modalPoster');
    setImgWithFallback(poster, movie);
    $('modalPosterFallback').style.display = 'none';

    const backdrop = $('detailBackdrop');
    if (backdrop) backdrop.style.backgroundImage = `url("${posterSrc(movie)}")`;

    const imdbHref = movie.url?.startsWith('http') ? movie.url : `https://www.imdb.com/title/${encodeURIComponent(movie.imdb_id)}/`;
    $('modalImdbLink').href = imdbHref;

    const website = movie.website?.startsWith('http') ? movie.website : '';
    $('modalWebsiteLink').hidden = !website;
    if (website) $('modalWebsiteLink').href = website;

    $('modalRatingsSources').innerHTML = movie.ratings.length
      ? movie.ratings.map(r => `<span class="rating-source">${esc(r.Source || 'Source')}: <b>${esc(r.Value || '—')}</b></span>`).join('')
      : '<span class="source-note">منبع امتیاز دیگری ثبت نشده است.</span>';

    $('modalSourceNote').textContent = freshness(movie) === 'stale'
      ? `اطلاعات تکمیلی این عنوان از نسخه سالم قبلی حفظ شده است. علت: ${movie.data_stale_reason || 'خطای دریافت جدید'}.`
      : `آخرین دریافت تکمیلی: ${movie.data_fetched_at || 'ثبت نشده'} • فیلدهای تازه: ${movie.fields_fresh?.join(', ') || 'CSV'}`;

    renderRawData(movie);
    buildSerialContext(movie, forceSeries, seriesKey);

    $('modalOverlay').hidden = false;
    document.body.classList.add('modal-open');
  }

  function renderRawData(movie) {
    const hidden = new Set(['search_text', 'raw_csv']);
    const labels = {
      Const: 'IMDb ID',
      'Your Rating': 'Your Rating',
      'Date Rated': 'Date Rated',
      Title: 'Title',
      'Original Title': 'Original Title',
      URL: 'URL',
      'Title Type': 'Title Type',
      'IMDb Rating': 'IMDb Rating',
      'Runtime (mins)': 'Runtime (mins)',
      Year: 'Year',
      Genres: 'Genres',
      'Num Votes': 'Num Votes',
      'Release Date': 'Release Date',
      Directors: 'Directors'
    };

    const values = { ...movie.raw_csv };
    for (const [key, value] of Object.entries(movie)) {
      if (!(key in values)) values[key] = value;
    }

    const entries = Object.entries(values)
      .filter(([key, value]) => !hidden.has(key) && value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `<div class="raw-data-cell"><span>${esc(labels[key] || key)}</span><b>${esc(Array.isArray(value) ? value.join(', ') : value)}</b></div>`);

    $('modalRawData').innerHTML = entries.length ? entries.join('') : '<div class="source-note">فیلد خامی برای این رکورد ثبت نشده است.</div>';
  }

  function buildSerialContext(movie, forceSeries = false, seriesKey = null) {
    if (movie.is_episode) {
      show($('episodePanel'));
      const eps = state.movies
        .filter(item => item.is_episode && (movie.series_id ? item.series_id === movie.series_id : item.series_title === movie.series_title))
        .sort((a,b) => num(a.season_number)-num(b.season_number) || num(a.episode_number)-num(b.episode_number));
      const index = eps.findIndex(item => item.imdb_id === movie.imdb_id);
      const prev = eps[index - 1];
      const next = eps[index + 1];
      setText('episodeSeriesTitle', movie.series_title || 'سریال');
      setText('episodePosition', `S${movie.season_number || '?'} E${movie.episode_number || '?'}`);
      setText('episodeProgressText', `${index + 1} / ${eps.length}`);
      $('episodeProgressBar').style.width = eps.length ? `${((index + 1) / eps.length) * 100}%` : '0%';
      $('prevEpisode').disabled = !prev;
      $('nextEpisode').disabled = !next;
      $('prevEpisode').onclick = () => prev && openModal(prev.imdb_id);
      $('nextEpisode').onclick = () => next && openModal(next.imdb_id);
    }

    const needsSeries = movie.title_type === 'TV Series' || forceSeries || seriesKey;
    if (!needsSeries) return;

    const groupKey = seriesKey || movie.series_id || movie.series_title || movie.imdb_id;
    const group = state.seriesGroups.find(g => g.key === groupKey);
    if (!group) return;

    show($('seriesPanel'));
    setText('seriesPanelTitle', group.title);
    const episodes = [...group.episodes].sort((a,b) => num(a.season_number)-num(b.season_number) || num(a.episode_number)-num(b.episode_number));
    const rated = episodes.filter(e => e.user_rating > 0).length;
    const seasonCount = new Set(episodes.map(e => e.season_number).filter(Boolean)).size;
    setText('seriesProgressLabel', `${rated}/${episodes.length} قسمت • ${totalRuntimeLabel(episodes)}`);
    $('seriesSummary').innerHTML = `
      <div class="series-summary-card"><span>فصل‌ها</span><b>${seasonCount || '—'}</b></div>
      <div class="series-summary-card"><span>قسمت‌ها</span><b>${episodes.length}</b></div>
      <div class="series-summary-card"><span>زمان کل</span><b>${esc(totalRuntimeLabel(episodes))}</b></div>
      <div class="series-summary-card"><span>میانگین امتیاز</span><b>${rated ? (episodes.filter(e => e.user_rating > 0).reduce((s,e) => s + e.user_rating, 0) / rated).toFixed(1) : '—'}</b></div>`;

    const seasons = new Map();
    episodes.forEach(ep => {
      const season = ep.season_number || 0;
      if (!seasons.has(season)) seasons.set(season, []);
      seasons.get(season).push(ep);
    });

    $('seasonList').innerHTML = [...seasons.entries()].map(([season, list]) => `
      <details class="season" ${season === num(movie.season_number) || !season ? 'open' : ''}>
        <summary><span>فصل ${season || 'نامشخص'}</span><span>${list.length} قسمت • ${esc(totalRuntimeLabel(list))}</span></summary>
        <div class="episode-list">
          ${list.map(ep => `<div class="episode-item" data-episode-id="${esc(ep.imdb_id)}">
            <div class="episode-thumb"><img src="${esc(posterSrc(ep))}" alt="" loading="lazy"></div>
            <div class="episode-item-copy"><div class="episode-num">E${String(ep.episode_number || 0).padStart(2,'0')}</div><div class="episode-name">${esc(ep.episode_title || ep.title)}</div><div class="episode-score">⭐ ${ep.user_rating || '—'} • IMDb ${safe(ep.imdb_rating)} • ${esc(runtimeLabel(ep.runtime))}</div></div>
          </div>`).join('')}
        </div>
      </details>`).join('') || '<div class="source-note">اطلاعات فصل/قسمت ثبت نشده است.</div>';
  }

  function closeModal() {
    hide($('modalOverlay'));
    document.body.classList.remove('modal-open');
    state.currentId = null;
  }

  function generateStats() {
    if (!state.movies.length || typeof Chart === 'undefined') return;

    const directors = new Set();
    const years = new Set();
    const genres = {};
    const ratings = {};
    const yearly = {};
    let top = 0;
    let stale = 0;

    state.movies.forEach(movie => {
      arr(movie.directors).forEach(d => directors.add(d));
      const year = parseYear(movie.year);
      if (year) { years.add(year); yearly[year] = (yearly[year] || 0) + 1; }
      arr(movie.genres).forEach(g => genres[g] = (genres[g] || 0) + 1);
      if (movie.user_rating > 0) ratings[Math.round(movie.user_rating)] = (ratings[Math.round(movie.user_rating)] || 0) + 1;
      if (movie.user_rating > top) top = movie.user_rating;
      if (freshness(movie) === 'stale') stale++;
    });

    const yearKeys = Object.keys(yearly).sort((a,b) => Number(a)-Number(b));
    const topGenre = Object.entries(genres).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
    setText('statDirectors', formatNumber(directors.size));
    setText('statYears', formatNumber(years.size));
    setText('statTopRating', top || 0);
    setText('statTopGenre', topGenre);
    setText('statAvgPerYear', yearKeys.length ? Math.round(state.movies.length / yearKeys.length) : 0);
    setText('statRuntime', totalRuntimeLabel(state.movies));
    setText('statStale', formatNumber(stale));

    destroyCharts();
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: 'easeOutQuart' },
      plugins: { legend: { labels: { color: '#bdb9cb', font: { family: 'Vazirmatn', size: 10 } } } },
      scales: {
        x: { ticks: { color: '#8f8b9f', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { beginAtZero: true, ticks: { color: '#8f8b9f', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } }
      }
    };

    const topGenres = Object.entries(genres).sort((a,b) => b[1]-a[1]).slice(0,12);
    state.charts.genre = new Chart($('genreChart'), { type: 'bar', data: { labels: topGenres.map(x=>x[0]), datasets: [{ label: 'تعداد', data: topGenres.map(x=>x[1]), backgroundColor: 'rgba(255,70,107,.72)', borderRadius: 8 }] }, options: opts });

    const ratingKeys = Object.keys(ratings).sort((a,b)=>Number(a)-Number(b));
    state.charts.rating = new Chart($('ratingChart'), { type: 'bar', data: { labels: ratingKeys.map(x=>`${x}⭐`), datasets: [{ label: 'تعداد', data: ratingKeys.map(x=>ratings[x]), backgroundColor: 'rgba(255,211,92,.75)', borderRadius: 8 }] }, options: opts });

    const recentYears = yearKeys.slice(-15);
    state.charts.year = new Chart($('yearChart'), { type: 'line', data: { labels: recentYears, datasets: [{ label: 'عنوان', data: recentYears.map(y=>yearly[y]), borderColor: '#26dfd0', backgroundColor: 'rgba(38,223,208,.08)', fill: true, tension: .32 }] }, options: opts });

    const compare = [...state.movies].filter(m => m.user_rating > 0 && num(m.imdb_rating) > 0).sort((a,b)=>dateValue(b.date_rated)-dateValue(a.date_rated)).slice(0,20);
    state.charts.compare = new Chart($('compareChart'), { type: 'bar', data: { labels: compare.map(m => m.title.length > 14 ? `${m.title.slice(0,13)}…` : m.title), datasets: [{ label: 'من', data: compare.map(m=>m.user_rating), backgroundColor: 'rgba(255,211,92,.75)' }, { label: 'IMDb', data: compare.map(m=>num(m.imdb_rating)), backgroundColor: 'rgba(132,108,255,.72)' }] }, options: opts });

    const topMovies = [...state.movies].sort((a,b)=>b.user_rating-a.user_rating || dateValue(b.date_rated)-dateValue(a.date_rated)).slice(0,12);
    $('topMoviesList').innerHTML = topMovies.map((m,i)=>`<div class="rank-row" data-id="${esc(m.imdb_id)}"><div class="rank-number">#${i+1}</div><div><div class="rank-title">${esc(m.title)}</div><div class="rank-sub">${esc(m.year)} • ${esc(typeLabel(m))}</div></div><b style="color:var(--gold)">⭐ ${m.user_rating || '—'}</b></div>`).join('');
  }

  function destroyCharts() {
    Object.values(state.charts).forEach(chart => { try { chart.destroy(); } catch (_) {} });
    state.charts = {};
  }

  function cycleSort() {
    const options = ['date_rated-desc','date_rated-asc','user_rating-desc','user_rating-asc','imdb_rating-desc','title-asc','year-desc'];
    const index = options.indexOf(state.sort);
    state.sort = options[(index + 1) % options.length];
    applyFilters();
    toast(`مرتب‌سازی: ${sortLabel(state.sort)}`);
  }

  function resetFilters() {
    state.filters = { q:'', type:'all', genre:'all', year:'all', minRating:0, freshness:'all', serial:'all' };
    syncControls();
    applyFilters();
    toast('فیلترها بازنشانی شدند.');
  }

  function openCommand() {
    $('commandOverlay').hidden = false;
    document.body.classList.add('command-open');
    $('commandSearch').value = '';
    renderCommands('');
    requestAnimationFrame(() => $('commandSearch').focus());
  }

  function closeCommand() {
    hide($('commandOverlay'));
    document.body.classList.remove('command-open');
  }

  const commands = [
    ['جستجو','فوکوس روی جستجو',()=>$('searchInput').focus()],
    ['فیلترها','نمایش یا بستن فیلترها',()=>$('filterPanel').hidden = !$('filterPanel').hidden],
    ['آمار','نمایش یا بستن آمار',()=>{ $('statsSection').hidden = !$('statsSection').hidden; if(!$('statsSection').hidden) generateStats(); }],
    ['تازه‌ترین‌ها','پرش به بخش جدیدترین‌ها',()=>$('latestSection').scrollIntoView({behavior:'smooth'})],
    ['سریال‌ها','پرش به بخش سریال‌ها',()=>$('seriesGrid').scrollIntoView({behavior:'smooth'})],
    ['بازنشانی','پاک کردن فیلترها',resetFilters],
    ['مرتب‌سازی','چرخش مرتب‌سازی',cycleSort]
  ];

  function renderCommands(query) {
    const q = query.trim().toLocaleLowerCase('fa');
    const list = commands.filter(command => !q || command[0].toLocaleLowerCase('fa').includes(q) || command[1].toLocaleLowerCase('fa').includes(q));
    $('commandList').innerHTML = list.map((command,index)=>`<div class="command-item ${index===0?'active':''}" data-index="${index}"><span>${esc(command[0])}</span><small>${esc(command[1])}</small></div>`).join('');
    $('commandList').onclick = event => {
      const item = event.target.closest('.command-item');
      if (!item) return;
      list[Number(item.dataset.index)]?.[2]();
      closeCommand();
    };
  }

  function openSeriesModal(key) {
    const group = state.seriesGroups.find(g => g.key === key);
    const target = group?.series || group?.episodes?.[0];
    if (target) openModal(target.imdb_id, true, key);
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function hide(node) { if (node) node.hidden = true; }
  function show(node) { if (node) node.hidden = false; }

  document.addEventListener('click', event => {
    const movieCard = event.target.closest('.movie-card');
    if (movieCard) { openModal(movieCard.dataset.id); return; }
    const latestCard = event.target.closest('.latest-card');
    if (latestCard) { openModal(latestCard.dataset.id); return; }
    const seriesCard = event.target.closest('.series-card');
    if (seriesCard) { openSeriesModal(seriesCard.dataset.series); return; }
    const episode = event.target.closest('.episode-item');
    if (episode) { openModal(episode.dataset.episodeId); return; }
    const rank = event.target.closest('.rank-row');
    if (rank) openModal(rank.dataset.id);
  });

  document.addEventListener('keydown', event => {
    const tag = document.activeElement?.tagName;
    if (event.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(tag)) { event.preventDefault(); $('searchInput').focus(); }
    if (event.key === 'Escape') {
      if (!$('modalOverlay').hidden) closeModal();
      else if (!$('commandOverlay').hidden) closeCommand();
    }
    if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); openCommand(); }
    const active = document.activeElement;
    if (active?.matches('.movie-card,.latest-card,.series-card')) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (active.classList.contains('series-card')) openSeriesModal(active.dataset.series);
        else openModal(active.dataset.id);
      }
    }
  });

  $('searchInput').addEventListener('input', event => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => { state.filters.q = event.target.value; applyFilters(); }, 150);
  });

  ['typeFilter','genreFilter','yearFilter','freshnessFilter','serialFilter'].forEach(id => {
    $(id).addEventListener('change', event => {
      state.filters[id.replace('Filter','')] = event.target.value;
      applyFilters();
    });
  });

  $('minRating').addEventListener('input', event => {
    state.filters.minRating = Number(event.target.value);
    $('minRatingValue').textContent = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => applyFilters(), 70);
  });

  $('pageSize').addEventListener('change', event => {
    state.pageSize = [12,24,36,48].includes(Number(event.target.value)) ? Number(event.target.value) : 24;
    state.page = 1;
    renderSkeletons();
    requestAnimationFrame(() => { renderMovies(); hide($('skeletonGrid')); });
    saveSettings();
  });

  $('paginationBar').addEventListener('click', event => {
    const number = event.target.closest('[data-page]');
    if (number) { goToPage(number.dataset.page); return; }
    if (event.target.closest('#firstPage')) goToPage(1);
    if (event.target.closest('#prevPage')) goToPage(state.page - 1);
    if (event.target.closest('#nextPage')) goToPage(state.page + 1);
    if (event.target.closest('#lastPage')) goToPage(Math.ceil(state.filtered.length / state.pageSize));
  });

  $('filterBtn').onclick = () => $('filterPanel').hidden = !$('filterPanel').hidden;
  $('sortBtn').onclick = cycleSort;
  $('viewBtn').onclick = () => { state.view = state.view === 'card' ? 'list' : 'card'; syncControls(); renderMovies(); saveSettings(); };
  $('statsBtn').onclick = () => { $('statsSection').hidden = !$('statsSection').hidden; if (!$('statsSection').hidden) generateStats(); };
  $('heroStats').onclick = () => { $('statsSection').hidden = false; generateStats(); $('statsSection').scrollIntoView({behavior:'smooth'}); };
  $('themeBtn').onclick = () => document.body.classList.toggle('soft-theme');
  $('commandBtn').onclick = openCommand;
  $('commandOverlay').onclick = event => { if (event.target === $('commandOverlay')) closeCommand(); };
  $('commandSearch').addEventListener('input', event => renderCommands(event.target.value));
  $('collapseSeries').onclick = () => {
    const grid = $('seriesGrid');
    const collapsed = grid.hidden;
    grid.hidden = !collapsed;
    $('collapseSeries').textContent = collapsed ? 'جمع‌کردن' : 'نمایش';
  };
  $('modalClose').onclick = closeModal;
  $('modalOverlay').onclick = event => { if (event.target === $('modalOverlay')) closeModal(); };
  $('emptyReset').onclick = resetFilters;
  $('resetFilters').onclick = resetFilters;
  $('modalCopyId').onclick = async () => {
    if (!state.currentId) return;
    try { await navigator.clipboard.writeText(state.currentId); toast('IMDb ID کپی شد.'); }
    catch (_) { toast('کپی خودکار در این مرورگر در دسترس نیست.', 'warn'); }
  };

  window.addEventListener('resize', () => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => {
      renderPagination();
      Object.values(state.charts).forEach(chart => chart.resize?.());
    }, 100);
  });

  window.addEventListener('scroll', () => {
    $('siteHeader')?.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  document.addEventListener('DOMContentLoaded', loadData, { once: true });
})();
