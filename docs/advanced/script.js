(() => {
  'use strict';

  const DATA_URLS = [
    new URL('../movies.json', document.baseURI).href,
    new URL('/imdb-showcase/movies.json', location.origin).href,
    'https://raw.githubusercontent.com/mehrdadmb2/imdb-showcase/main/docs/movies.json'
  ];
  const CACHE_KEY = 'imdb-showcase-advanced-v14-cache';
  const PAGE_SIZE_KEY = 'imdb-showcase-advanced-v14-page-size';
  const THEME_KEY = 'imdb-showcase-advanced-v14-theme';

  const $ = (id) => document.getElementById(id);
  const state = {
    movies: [],
    filtered: [],
    page: 1,
    pageSize: loadPageSize(),
    query: '',
    field: 'all',
    type: 'all',
    genre: 'all',
    year: 'all',
    sort: 'date_desc',
    modalId: '',
    charts: {},
    diagnostics: { system: null, keys: null, run: null },
    motion: true
  };

  const THEMES = ['obsidian', 'aurora', 'ember', 'ocean'];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }

  function text(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const s = String(value).replace(/\u0000/g, '').trim();
    return !s || s.toUpperCase() === 'N/A' ? fallback : s;
  }

  function num(value, fallback = 0) {
    const n = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function year(value) {
    const m = String(value ?? '').match(/\b(?:18|19|20)\d{2}\b/);
    return m ? Number(m[0]) : 0;
  }

  function dateValue(value) {
    const d = new Date(value || '');
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }

  function split(value) {
    if (Array.isArray(value)) return value.map(v => text(v)).filter(Boolean);
    return String(value ?? '').split(',').map(v => v.trim()).filter(Boolean);
  }

  function formatInt(value) {
    return Math.max(0, Math.round(num(value))).toLocaleString('en-US');
  }

  function formatDecimal(value, digits = 1) {
    const n = num(value);
    return n ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  }

  function formatDate(value) {
    const d = new Date(value || '');
    return Number.isFinite(d.getTime())
      ? new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
      : text(value, '—');
  }

  function formatRuntime(value) {
    const match = String(value ?? '').match(/\d+/);
    const mins = match ? Number(match[0]) : 0;
    if (!mins) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h} ساعت و ${m} دقیقه`;
    if (h) return `${h} ساعت`;
    return `${m} دقیقه`;
  }

  function runtimeMinutes(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function set(id, value) {
    const node = $(id);
    if (node) node.textContent = value ?? '';
  }

  function notify(message, kind = 'ok') {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
    node.classList.add('show');
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.classList.remove('show'), 3500);
  }

  function log(...args) { console.info('[IMDb Advanced]', ...args); }
  function warn(...args) { console.warn('[IMDb Advanced]', ...args); }
  function error(...args) { console.error('[IMDb Advanced]', ...args); }

  function applyTheme(theme) {
    const selected = THEMES.includes(theme) ? theme : 'obsidian';
    document.body.dataset.theme = selected;
    try { localStorage.setItem(THEME_KEY, selected); } catch {}
    document.querySelectorAll('[data-theme]').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === selected));
  }

  function restoreTheme() {
    let theme = 'obsidian';
    try { theme = localStorage.getItem(THEME_KEY) || theme; } catch {}
    applyTheme(theme);
  }

  function loadPageSize() {
    try {
      const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
      return [12, 24, 36, 48].includes(n) ? n : 24;
    } catch { return 24; }
  }

  function savePageSize() {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(state.pageSize)); } catch {}
  }

  function normalizeMovie(raw) {
    const m = raw && typeof raw === 'object' ? raw : {};
    return {
      ...m,
      imdb_id: text(m.imdb_id, ''),
      title: text(m.title, 'بدون عنوان'),
      original_title: text(m.original_title, text(m.title, 'بدون عنوان')),
      year: text(m.year, ''),
      user_rating: num(m.user_rating),
      date_rated: text(m.date_rated, ''),
      title_type: text(m.title_type, 'Other'),
      imdb_rating: text(m.imdb_rating, ''),
      runtime: text(m.runtime, ''),
      genres: text(m.genres, ''),
      num_votes: text(m.num_votes, ''),
      release_date: text(m.release_date, ''),
      directors: text(m.directors, ''),
      url: text(m.url, ''),
      poster: text(m.poster, ''),
      poster_remote: text(m.poster_remote, ''),
      poster_local: text(m.poster_local, ''),
      poster_status: text(m.poster_status, ''),
      plot: text(m.plot, ''),
      rated: text(m.rated, ''),
      actors: text(m.actors, ''),
      writer: text(m.writer, ''),
      country: text(m.country, ''),
      language: text(m.language, ''),
      awards: text(m.awards, ''),
      box_office: text(m.box_office, ''),
      production: text(m.production, ''),
      metascore: text(m.metascore, ''),
      website: text(m.website, ''),
      ratings: Array.isArray(m.ratings) ? m.ratings : [],
      series_id: text(m.series_id, ''),
      series_title: text(m.series_title, ''),
      season_number: num(m.season_number),
      episode_number: num(m.episode_number),
      episode_title: text(m.episode_title, ''),
      total_seasons: num(m.total_seasons),
      total_episodes: num(m.total_episodes),
      is_episode: m.is_episode === true || m.title_type === 'TV Episode',
      data_status: text(m.data_status, m.omdb_found ? 'fresh' : 'partial'),
      cache_updated_at: text(m.cache_updated_at, ''),
      data_fetched_at: text(m.data_fetched_at, ''),
      raw_csv: m.raw_csv && typeof m.raw_csv === 'object' ? m.raw_csv : {},
      raw_omdb: m.raw_omdb && typeof m.raw_omdb === 'object' ? m.raw_omdb : {}
    };
  }

  function normalizeLocalPoster(value) {
    let p = text(value, '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\//, '');
    if (!p) return '';
    if (/^https?:\/\//i.test(p)) return p;
    if (p.startsWith('docs/')) p = p.slice(5);
    if (p.startsWith('advanced/')) p = p.slice(9);
    if (p.startsWith('posters/')) return `../${p}`;
    if (p.includes('/posters/')) return `../${p.slice(p.indexOf('posters/'))}`;
    return `../posters/${p}`;
  }

  function remotePoster(movie) {
    return [movie?.poster, movie?.poster_remote, movie?.raw_omdb?.Poster]
      .map(v => text(v, ''))
      .find(v => /^https?:\/\//i.test(v)) || '';
  }

  function posterSources(movie) {
    return [normalizeLocalPoster(movie?.poster_local), remotePoster(movie)]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  function makeFallback(movie, compact = false) {
    const score = num(movie?.user_rating);
    const color = score >= 9 ? 'mint' : score >= 7 ? 'violet' : score >= 5 ? 'amber' : 'rose';
    const type = movie?.title_type === 'TV Series' ? 'SERIES' : movie?.is_episode ? 'EPISODE' : movie?.title_type === 'Short' ? 'SHORT' : 'MOVIE';
    return `<div class="fallback-poster ${color} ${compact ? 'compact' : ''}"><span class="fp-top">IMDB SHOWCASE</span><strong>${esc((movie?.title || 'TITLE').slice(0, 26))}</strong><small>${esc(type)}${movie?.year ? ` • ${esc(movie.year)}` : ''}</small><i>${score ? `⭐ ${formatDecimal(score, 1)}` : '🎬'}</i></div>`;
  }

  function movieImage(movie, classes = 'poster-smart') {
    const sources = posterSources(movie);
    if (!sources.length) return makeFallback(movie);
    return `<img class="${classes}" src="${esc(sources[0])}" alt="${esc(movie.title)}" loading="lazy" decoding="async" data-s1="${esc(sources[0])}" data-s2="${esc(sources[1] || '')}"><div class="fallback-slot" hidden>${makeFallback(movie)}</div>`;
  }

  function bindPosterFallback(root) {
    if (!root) return;
    root.querySelectorAll('.poster-smart').forEach(img => {
      if (img.dataset.bound === '1') return;
      img.dataset.bound = '1';
      let stage = 0;
      img.addEventListener('error', () => {
        stage += 1;
        const next = stage === 1 ? img.dataset.s2 : '';
        if (next) {
          img.src = next;
          return;
        }
        img.hidden = true;
        const slot = img.parentElement?.querySelector('.fallback-slot');
        if (slot) slot.hidden = false;
      });
    });
  }

  async function fetchJson(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const sep = url.includes('?') ? '&' : '?';
      const response = await fetch(`${url}${sep}v=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || (!Array.isArray(data) && !Array.isArray(data.movies))) throw new Error('Dataset schema invalid');
      return Array.isArray(data) ? { movies: data } : data;
    } finally { clearTimeout(timer); }
  }

  async function loadDataset() {
    let lastError = null;
    for (const url of DATA_URLS) {
      try {
        const data = await fetchJson(url);
        const movies = data.movies.map(normalizeMovie).filter(m => m.imdb_id);
        if (!movies.length) throw new Error('Dataset is empty');
        log('Dataset loaded:', url, movies.length);
        return { ...data, movies };
      } catch (err) {
        lastError = err;
        warn('Dataset source failed:', url, err?.message || err);
      }
    }
    throw lastError || new Error('No dataset source available');
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return Array.isArray(data.movies) ? data : null;
    } catch (err) { warn('Cache read failed', err); return null; }
  }

  function saveCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), movies: data.movies, meta: data.data_meta || {} })); } catch (err) { warn('Cache save failed', err); }
  }

  function bootFromCache() {
    const cached = loadCache();
    if (!cached?.movies?.length) return false;
    state.movies = cached.movies.map(normalizeMovie).filter(m => m.imdb_id);
    refreshAllViews();
    set('bootHealth', 'CACHED');
    set('bootText', `${formatInt(state.movies.length)} عنوان از Cache محلی آماده است`);
    return true;
  }

  async function load() {
    bootFromCache();
    set('bootHealth', 'LOADING');
    set('bootText', state.movies.length ? 'در حال بررسی Dataset جدید…' : 'در حال بارگذاری Dataset مشترک…');
    try {
      const data = await loadDataset();
      state.movies = data.movies;
      saveCache(data);
      refreshAllViews();
      set('bootHealth', 'READY');
      set('bootText', `${formatInt(state.movies.length)} عنوان آماده نمایش است`);
    } catch (err) {
      error('Advanced load failed', err);
      if (!state.movies.length) {
        renderFatal('Dataset قابل بارگذاری نیست. ابتدا GitHub Action و movies.json را بررسی کن.');
        set('bootHealth', 'ERROR');
        set('bootText', 'خطا در Dataset');
      } else {
        set('bootHealth', 'CACHED');
        set('bootText', 'اتصال جدید در دسترس نبود؛ Cache سالم نمایش داده شد');
      }
    }
    loadDiagnostics();
  }

  function renderFatal(message) {
    const grid = $('movieGrid');
    if (grid) grid.innerHTML = `<div class="fatal-state glass"><div>⚠️</div><h3>کتابخانه آماده نیست</h3><p>${esc(message)}</p></div>`;
    ['seriesGrid','genreCloud','ratingTimeline'].forEach(id => { if ($(id)) $(id).innerHTML = ''; });
  }

  function aggregate() {
    const movies = state.movies;
    const rated = movies.filter(m => m.user_rating > 0);
    const genres = {};
    const years = {};
    const decades = {};
    const months = {};
    rated.forEach(m => {
      split(m.genres).forEach(g => genres[g] = (genres[g] || 0) + 1);
      const y = year(m.year); if (y) { years[y] = (years[y] || 0) + 1; decades[Math.floor(y / 10) * 10] = (decades[Math.floor(y / 10) * 10] || 0) + 1; }
      const d = new Date(m.date_rated); if (Number.isFinite(d.getTime())) { const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}`; months[key] = (months[key] || 0) + 1; }
    });
    const avg = rated.length ? rated.reduce((a, m) => a + m.user_rating, 0) / rated.length : 0;
    const minMovie = rated.length ? [...rated].sort((a, b) => a.user_rating - b.user_rating || dateValue(b.date_rated) - dateValue(a.date_rated))[0] : null;
    const maxMovie = rated.length ? [...rated].sort((a, b) => b.user_rating - a.user_rating || dateValue(b.date_rated) - dateValue(a.date_rated))[0] : null;
    const popularGenre = Object.entries(genres).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
    const activeDecade = Object.entries(decades).sort((a,b) => b[1]-a[1])[0]?.[0];
    return { movies, rated, genres, years, decades, months, avg, minMovie, maxMovie, popularGenre, activeDecade };
  }

  function refreshAllViews() {
    populateFilters();
    renderOverview();
    renderTaste();
    renderRatingBars();
    renderTimeline();
    renderGenreCloud();
    renderSeries();
    applyFilters();
  }

  function renderOverview() {
    const a = aggregate();
    const movieCount = state.movies.filter(m => ['Movie','Short'].includes(m.title_type)).length;
    const seriesCount = state.movies.filter(m => m.title_type === 'TV Series').length;
    const episodes = state.movies.filter(m => m.is_episode).length;
    const totalMin = state.movies.reduce((s,m) => s + runtimeMinutes(m.runtime), 0);
    const localPosters = state.movies.filter(m => !!normalizeLocalPoster(m.poster_local)).length;
    const remote = state.movies.filter(m => !!remotePoster(m)).length;
    const enriched = state.movies.filter(m => !!(m.raw_omdb?.imdbID || m.omdb_found)).length;
    set('kpiTitles', formatInt(state.movies.length));
    set('kpiAverage', formatDecimal(a.avg, 1));
    set('kpiMovies', formatInt(movieCount));
    set('kpiSeries', formatInt(seriesCount));
    set('kpiEpisodes', formatInt(episodes));
    set('kpiRuntime', formatRuntime(`${totalMin} min`));
    set('kpiPosters', `${formatInt(Math.max(localPosters, remote))} / ${formatInt(state.movies.length)}`);
    set('kpiOmdb', `${formatInt(enriched)} / ${formatInt(state.movies.length)}`);
  }

  function renderTaste() {
    const a = aggregate();
    set('tasteScore', formatDecimal(a.avg, 1));
    set('tasteGenre', a.popularGenre);
    set('tasteDecade', a.activeDecade ? `${a.activeDecade}s` : '—');
    set('tasteLow', a.minMovie ? `${formatDecimal(a.minMovie.user_rating,1)} • ${a.minMovie.title}` : '—');
    set('tasteHigh', a.maxMovie ? `${formatDecimal(a.maxMovie.user_rating,1)} • ${a.maxMovie.title}` : '—');
    set('tasteHeadline', a.avg >= 8 ? 'سلیقه سخت‌گیر اما مثبت' : a.avg >= 6 ? 'سلیقه متعادل' : a.avg ? 'امتیازدهی سخت‌گیرانه' : 'اطلاعات کافی برای تحلیل نیست');
    set('tasteDescription', a.rated.length ? `${formatInt(a.rated.length)} عنوان دارای امتیاز است و ${a.popularGenre === '—' ? 'ژانر غالبی ثبت نشده' : `ژانر پرتکرار ${a.popularGenre} است`}.` : 'برای ساخت امضای سلیقه، حداقل چند عنوان دارای امتیاز لازم است.');
  }

  function renderRatingBars() {
    const host = $('ratingBars'); if (!host) return;
    const counts = Array.from({length:10}, (_,i) => state.movies.filter(m => Math.round(m.user_rating) === i + 1).length);
    const max = Math.max(1, ...counts);
    host.innerHTML = counts.map((count, idx) => `<div class="rating-row"><span>${idx+1}</span><div><i style="width:${Math.round(count/max*100)}%"></i></div><b>${formatInt(count)}</b></div>`).join('');
  }

  function renderTimeline() {
    const host = $('ratingTimeline'); if (!host) return;
    const rows = state.movies.filter(m => m.date_rated).sort((a,b) => dateValue(a.date_rated) - dateValue(b.date_rated));
    const byYear = {};
    rows.forEach(m => { const y = new Date(m.date_rated).getFullYear(); if (y) byYear[y] = (byYear[y] || 0) + 1; });
    const entries = Object.entries(byYear).slice(-18);
    const max = Math.max(1, ...entries.map(x => x[1]));
    set('timelineSummary', rows.length ? `${formatInt(rows.length)} امتیاز ثبت‌شده` : 'بدون تاریخ');
    host.innerHTML = entries.length ? entries.map(([y,c]) => `<div class="timeline-item"><span>${y}</span><div class="timeline-bar"><i style="height:${Math.max(8, Math.round(c/max*100))}%"></i></div><b>${formatInt(c)}</b></div>`).join('') : '<div class="muted">داده تاریخی کافی نیست.</div>';
  }

  function renderGenreCloud() {
    const host = $('genreCloud'); if (!host) return;
    const entries = Object.entries(aggregate().genres).sort((a,b) => b[1]-a[1]).slice(0, 24);
    if (!entries.length) { host.innerHTML = '<span class="muted">ژانری ثبت نشده است.</span>'; return; }
    const max = Math.max(1, entries[0][1]);
    host.innerHTML = entries.map(([g,c],i) => `<button type="button" class="genre-chip" style="--scale:${0.86 + (c/max)*0.45};--delay:${i*35}ms" data-genre="${esc(g)}">${esc(g)} <b>${formatInt(c)}</b></button>`).join('');
    host.onclick = e => { const btn = e.target.closest('[data-genre]'); if (!btn) return; state.genre = btn.dataset.genre; $('genreFilter').value = state.genre; state.page = 1; applyFilters(); $('library').scrollIntoView({behavior:'smooth', block:'start'}); };
  }

  function populateFilters() {
    const genres = [...new Set(state.movies.flatMap(m => split(m.genres)))].sort((a,b) => a.localeCompare(b,'fa'));
    const years = [...new Set(state.movies.map(m => year(m.year)).filter(Boolean))].sort((a,b) => b-a);
    const g = $('genreFilter'); const y = $('yearFilter');
    if (g) g.innerHTML = `<option value="all">همه ژانرها</option>${genres.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}`;
    if (y) y.innerHTML = `<option value="all">همه سال‌ها</option>${years.map(x => `<option value="${x}">${x}</option>`).join('')}`;
  }

  function fieldValue(movie, field) {
    const values = {
      title: movie.title,
      original_title: movie.original_title,
      actors: movie.actors,
      directors: movie.directors,
      writer: movie.writer,
      genres: movie.genres,
      plot: movie.plot,
      imdb_id: movie.imdb_id,
      all: [movie.title,movie.original_title,movie.actors,movie.directors,movie.writer,movie.genres,movie.plot,movie.imdb_id,movie.series_title].join(' ')
    };
    return String(values[field] || '').toLowerCase();
  }

  function searchScore(movie, query) {
    if (!query) return 0;
    const value = fieldValue(movie, state.field).trim();
    if (!value) return -Infinity;
    const q = query.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    let score = 0;
    if (value === q) score += 1500;
    if (value.startsWith(q)) score += 800;
    if (value.includes(` ${q}`)) score += 650;
    if (value.includes(q)) score += 450;
    for (const token of tokens) score += value.includes(token) ? (value.startsWith(token) ? 95 : 50) : -120;
    if (state.field === 'title' && value.includes(q)) score += 160;
    return score;
  }

  function compare(a,b,sort) {
    if (sort === 'rating_desc') return num(b.user_rating)-num(a.user_rating) || dateValue(b.date_rated)-dateValue(a.date_rated);
    if (sort === 'imdb_desc') return num(b.imdb_rating)-num(a.imdb_rating) || dateValue(b.date_rated)-dateValue(a.date_rated);
    if (sort === 'year_desc') return year(b.year)-year(a.year) || dateValue(b.date_rated)-dateValue(a.date_rated);
    if (sort === 'title_asc') return String(a.title).localeCompare(String(b.title),'fa');
    return dateValue(b.date_rated)-dateValue(a.date_rated) || num(b.user_rating)-num(a.user_rating);
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    const scored = [];
    for (const m of state.movies) {
      if (state.type !== 'all' && m.title_type !== state.type) continue;
      if (state.genre !== 'all' && !split(m.genres).includes(state.genre)) continue;
      if (state.year !== 'all' && year(m.year) !== Number(state.year)) continue;
      const score = searchScore(m, q);
      if (q && !Number.isFinite(score)) continue;
      scored.push({m, score});
    }
    scored.sort((a,b) => q && b.score !== a.score ? b.score-a.score : compare(a.m,b.m,state.sort));
    state.filtered = scored.map(x => x.m);
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    if (state.page < 1) state.page = 1;
    set('querySummary', q ? `${formatInt(state.filtered.length)} نتیجه مرتبط` : `${formatInt(state.filtered.length)} عنوان آماده نمایش`);
    renderLibrary();
  }

  function movieCard(movie) {
    const type = movie.title_type === 'TV Episode' ? '📺 قسمت' : movie.title_type === 'TV Series' ? '📺 سریال' : movie.title_type === 'Short' ? '🎞️ کوتاه' : '🎬 فیلم';
    const tags = split(movie.genres).slice(0,3).map(g => `<span>${esc(g)}</span>`).join('');
    return `<article class="movie-card" data-id="${esc(movie.imdb_id)}" tabindex="0" role="button" aria-label="نمایش ${esc(movie.title)}"><div class="poster-frame">${movieImage(movie)}<span class="card-badge">${type}</span><span class="card-glow"></span></div><div class="movie-info"><h3>${esc(movie.title)}</h3><p>${esc(movie.year || '—')} • ${esc(formatRuntime(movie.runtime))}</p><div class="tag-row">${tags}</div><div class="score-row"><b>⭐ ${movie.user_rating ? formatDecimal(movie.user_rating,1) : '—'}</b><span>IMDb ${esc(movie.imdb_rating || '—')}</span></div></div></article>`;
  }

  function renderLibrary() {
    const host = $('movieGrid'); if (!host) return;
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * state.pageSize;
    const visible = state.filtered.slice(start, start + state.pageSize);
    host.innerHTML = visible.length ? visible.map(movieCard).join('') : '<div class="fatal-state glass"><div>🎭</div><h3>چیزی پیدا نشد</h3><p>فیلترها یا عبارت جستجو را تغییر بده.</p></div>';
    bindPosterFallback(host);
    set('resultInfo', `${formatInt(start + (visible.length ? 1 : 0))}–${formatInt(start + visible.length)} از ${formatInt(total)}`);
    set('pageCounter', `${formatInt(state.page)} / ${formatInt(pages)}`);
    setDisabled('firstPage', state.page <= 1 || !total); setDisabled('prevPage', state.page <= 1 || !total); setDisabled('nextPage', state.page >= pages || !total); setDisabled('lastPage', state.page >= pages || !total);
    renderPageNumbers(pages);
  }

  function renderPageNumbers(pages) {
    const host = $('pageNumbers'); if (!host) return;
    if (pages <= 1) { host.innerHTML = '<button class="active" type="button">1</button>'; return; }
    const list = new Set([1,pages,state.page,state.page-1,state.page+1]);
    const nums = [...list].filter(n => n >= 1 && n <= pages).sort((a,b) => a-b);
    let html = ''; let last = 0;
    nums.forEach(n => { if (last && n-last > 1) html += '<span>…</span>'; html += `<button type="button" data-page="${n}" class="${n===state.page?'active':''}">${n}</button>`; last = n; });
    host.innerHTML = html;
  }

  function setDisabled(id, value) { const el = $(id); if (el) el.disabled = value; }
  function goPage(page) { const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize)); state.page = Math.max(1, Math.min(Number(page)||1, pages)); renderLibrary(); $('library')?.scrollIntoView({behavior:'smooth',block:'start'}); }

  function seriesGroups() {
    const map = new Map();
    state.movies.forEach(m => {
      if (!(m.title_type === 'TV Series' || m.is_episode || m.series_id || m.series_title)) return;
      const key = m.series_id || m.series_title || m.imdb_id;
      if (!map.has(key)) map.set(key,{key,title:m.series_title||m.title,series:null,episodes:[],poster:m.poster_local||m.poster});
      const item = map.get(key);
      if (m.title_type === 'TV Series') item.series = m;
      if (m.is_episode) item.episodes.push(m);
      if (!item.poster && (m.poster_local || m.poster)) item.poster = m.poster_local || m.poster;
    });
    return [...map.values()].sort((a,b) => String(a.title).localeCompare(String(b.title),'fa'));
  }

  function renderSeries() {
    const host = $('seriesGrid'); if (!host) return;
    const groups = seriesGroups().slice(0, 18);
    set('seriesSummary', `${formatInt(groups.length)} مجموعه`);
    host.innerHTML = groups.length ? groups.map(g => {
      const episodes = [...g.episodes].sort((a,b)=>num(a.season_number)-num(b.season_number)||num(a.episode_number)-num(b.episode_number));
      const seasons = new Set(episodes.map(e=>num(e.season_number)).filter(Boolean)).size;
      const rated = episodes.filter(e=>e.user_rating>0);
      const avg = rated.length ? rated.reduce((s,e)=>s+e.user_rating,0)/rated.length : 0;
      const pct = episodes.length ? Math.round(rated.length / episodes.length * 100) : 0;
      return `<article class="series-card glass" data-series="${esc(g.key)}" tabindex="0" role="button"><div class="series-poster">${g.series ? movieImage(g.series,'poster-smart') : episodes[0] ? movieImage(episodes[0],'poster-smart') : makeFallback({title:g.title,title_type:'TV Series'})}</div><div class="series-body"><h3>${esc(g.title)}</h3><p>${formatInt(seasons)} فصل • ${formatInt(episodes.length || g.series?.total_episodes || 0)} قسمت</p><div class="series-meta"><span>⭐ ${avg ? formatDecimal(avg,1) : '—'}</span><span>${formatInt(rated.length)} Rated</span></div><div class="progress"><i style="width:${pct}%"></i></div></div></article>`;
    }).join('') : '<div class="muted">اطلاعات سریالی کافی نیست.</div>';
    bindPosterFallback(host);
  }

  function openModal(id) {
    const movie = state.movies.find(m => String(m.imdb_id) === String(id));
    if (!movie) return;
    state.modalId = movie.imdb_id;
    set('modalType', movie.title_type);
    set('modalTitle', movie.title);
    set('modalOriginal', movie.original_title || movie.title);
    set('modalUser', movie.user_rating ? formatDecimal(movie.user_rating,1) : '—');
    set('modalIMDb', movie.imdb_rating || '—');
    set('modalMeta', movie.metascore || '—');
    set('modalPlot', movie.plot || 'برای این عنوان خلاصه‌ای ثبت نشده است.');
    const tags = $('modalTags'); if (tags) tags.innerHTML = split(movie.genres).map(g=>`<span>${esc(g)}</span>`).join('');
    const modalPoster = $('modalPoster'); const fallback = $('modalFallback');
    if (modalPoster && fallback) {
      const sources = posterSources(movie);
      let i = 0;
      modalPoster.hidden = !sources.length; fallback.hidden = !!sources.length;
      if (sources.length) {
        modalPoster.src = sources[0];
        modalPoster.onerror = () => { i += 1; if (sources[i]) modalPoster.src = sources[i]; else { modalPoster.hidden = true; fallback.hidden = false; } };
      }
    }
    const details = [
      ['سال',movie.year],['مدت',formatRuntime(movie.runtime)],['رده سنی',movie.rated],['انتشار',movie.release_date],['ژانر',movie.genres],['کارگردان',movie.directors],['نویسنده',movie.writer],['بازیگران',movie.actors],['کشور',movie.country],['زبان',movie.language],['رأی‌ها',movie.num_votes],['تاریخ امتیاز',movie.date_rated],['جوایز',movie.awards],['Box Office',movie.box_office],['تولید',movie.production],['وضعیت داده',movie.data_status],['Cache',movie.cache_updated_at ? formatDate(movie.cache_updated_at) : '—']
    ];
    const detailsHost = $('modalDetails'); if (detailsHost) detailsHost.innerHTML = details.map(([k,v])=>`<div class="detail-cell"><span>${esc(k)}</span><b>${esc(text(v,'—'))}</b></div>`).join('');
    const seriesHost = $('modalSeries'); if (seriesHost) seriesHost.innerHTML = buildSeriesContext(movie);
    const raw = $('modalRaw'); if (raw) raw.textContent = JSON.stringify({csv:movie.raw_csv,omdb:movie.raw_omdb},null,2);
    const link = $('modalLink'); if (link) link.href = movie.url || `https://www.imdb.com/title/${encodeURIComponent(movie.imdb_id)}/`;
    $('detailModal').hidden = false;
    document.body.classList.add('modal-open');
  }

  function buildSeriesContext(movie) {
    const isSeries = movie.title_type === 'TV Series' || movie.is_episode || movie.series_id || movie.series_title;
    if (!isSeries) return '';
    const eps = state.movies.filter(m => m.is_episode && ((movie.series_id && m.series_id===movie.series_id) || (movie.series_title && m.series_title===movie.series_title))).sort((a,b)=>num(a.season_number)-num(b.season_number)||num(a.episode_number)-num(b.episode_number));
    if (!eps.length) return `<div><h3>📺 ${esc(movie.series_title||movie.title)}</h3><p class="muted">اطلاعات فصل/قسمت در Dataset فعلی نیست.</p></div>`;
    const seasons = new Map();
    eps.forEach(e => { const s = num(e.season_number)||0; if(!seasons.has(s)) seasons.set(s,[]); seasons.get(s).push(e); });
    return `<div><h3>📺 ${esc(movie.series_title||movie.title)}</h3><p class="muted">${formatInt(seasons.size)} فصل • ${formatInt(eps.length)} قسمت</p>${[...seasons.entries()].map(([s,list])=>`<details class="season"><summary>فصل ${s||'?'} <span>${formatInt(list.length)} قسمت</span></summary><div class="episode-grid">${list.slice(0,120).map(e=>`<button type="button" class="episode-chip" data-open-episode="${esc(e.imdb_id)}">S${String(num(e.season_number)).padStart(2,'0')} E${String(num(e.episode_number)).padStart(2,'0')} • ${esc(e.episode_title||e.title)} • ⭐ ${e.user_rating ? formatDecimal(e.user_rating,1) : '—'}</button>`).join('')}</div></details>`).join('')}</div>`;
  }

  function renderTopLists() {
    const rated = [...state.movies].filter(m => m.user_rating > 0);
    const top = rated.sort((a,b)=>b.user_rating-a.user_rating||dateValue(b.date_rated)-dateValue(a.date_rated)).slice(0,8);
    const low = [...rated].sort((a,b)=>a.user_rating-b.user_rating||dateValue(b.date_rated)-dateValue(a.date_rated)).slice(0,8);
    const render = list => list.map((m,i)=>`<button type="button" class="rank-line" data-id="${esc(m.imdb_id)}"><span>#${i+1}</span><div><b>${esc(m.title)}</b><small>${esc(m.year)} • ⭐ ${formatDecimal(m.user_rating,1)}</small></div></button>`).join('') || '<span class="muted">—</span>';
    if ($('topRated')) $('topRated').innerHTML = render(top);
    if ($('lowRated')) $('lowRated').innerHTML = render(low);
  }

  let chartPromise = null;
  function ensureChart() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (chartPromise) return chartPromise;
    chartPromise = new Promise((resolve,reject)=>{
      const existing = document.querySelector('script[data-chart-loader]');
      if (existing) { existing.addEventListener('load',()=>resolve(window.Chart),{once:true}); existing.addEventListener('error',()=>reject(new Error('Chart.js load failed')),{once:true}); return; }
      const script = document.createElement('script'); script.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js'; script.async=true; script.dataset.chartLoader='1';
      script.onload=()=>window.Chart?resolve(window.Chart):reject(new Error('Chart.js unavailable')); script.onerror=()=>reject(new Error('Chart.js unavailable')); document.head.appendChild(script);
    });
    return chartPromise;
  }

  async function renderCharts() {
    try {
      await ensureChart();
      Object.values(state.charts).forEach(c=>{try{c.destroy();}catch{}});
      const a = aggregate();
      const options = {responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#c6cce0',font:{family:'Manrope',size:10}}}},scales:{x:{ticks:{color:'#8992ab',font:{size:9}},grid:{color:'rgba(255,255,255,.04)'}},y:{beginAtZero:true,ticks:{color:'#8992ab',font:{size:9}},grid:{color:'rgba(255,255,255,.04)'}}}};
      const ge = Object.entries(a.genres).sort((x,y)=>y[1]-x[1]).slice(0,12);
      const re = Array.from({length:10},(_,i)=>({label:i+1,count:state.movies.filter(m=>Math.round(m.user_rating)===i+1).length}));
      const ye = Object.entries(a.years).sort((x,y)=>Number(x[0])-Number(y[0])).slice(-18);
      state.charts.genre = new Chart($('genreChart'),{type:'bar',data:{labels:ge.map(x=>x[0]),datasets:[{label:'Titles',data:ge.map(x=>x[1]),backgroundColor:'#7C5CFF',borderRadius:8}]},options});
      state.charts.rating = new Chart($('ratingChart'),{type:'bar',data:{labels:re.map(x=>x.label),datasets:[{label:'Ratings',data:re.map(x=>x.count),backgroundColor:'#38E6C3',borderRadius:8}]},options});
      state.charts.year = new Chart($('yearChart'),{type:'line',data:{labels:ye.map(x=>x[0]),datasets:[{label:'Titles',data:ye.map(x=>x[1]),borderColor:'#FF5B93',backgroundColor:'rgba(255,91,147,.08)',fill:true,tension:.35,pointRadius:2}]},options});
      renderTopLists();
    } catch(err) { warn('Charts unavailable',err); notify('نمودارها فعلاً در دسترس نیستند؛ بقیه Advanced فعال است.','warn'); }
  }

  async function loadDiagnostics() {
    const urls = ['../system-status.json','../omdb-key-state.json','../update-log.json'];
    const result = await Promise.allSettled(urls.map(u => fetchJson(u,8000)));
    state.diagnostics.system = result[0].status === 'fulfilled' ? result[0].value : null;
    state.diagnostics.keys = result[1].status === 'fulfilled' ? result[1].value : null;
    state.diagnostics.run = result[2].status === 'fulfilled' ? result[2].value : null;
    renderDiagnostics();
  }

  function renderDiagnostics() {
    const system = state.diagnostics.system || {};
    const run = system.run || {};
    const counts = run.counts || {};
    const keys = Array.isArray(system.keys) ? system.keys : Array.isArray(state.diagnostics.keys?.keys) ? state.diagnostics.keys.keys : [];
    const rows = [
      ['Status',system.status||'—'],['Keys',keys.length],['API attempts',counts.api_attempts||0],['OMDb success',counts.omdb_success||0],['Cache reused',counts.cache_reused||0],['Posters saved',counts.posters_downloaded||0],['Poster misses',counts.posters_missing||0]
    ];
    if ($('diagSummary')) $('diagSummary').innerHTML = rows.map(([k,v])=>`<div class="diag-pill"><span>${esc(k)}</span><b>${typeof v==='number'?formatInt(v):esc(v)}</b></div>`).join('');
    if ($('keyTable')) $('keyTable').innerHTML = keys.length ? keys.map(k=>`<div class="key-row"><span>${esc(k.label||'key')}</span><span>${esc(k.fingerprint||'')}</span><b>${esc(k.status||'—')}</b><small>${formatInt(k.requests_today_total||0)} today • ${formatInt(k.requests_this_run||0)} run</small></div>`).join('') : '<span class="muted">فایل Diagnostics موجود نیست.</span>';
    const local = state.movies.filter(m=>normalizeLocalPoster(m.poster_local)).length;
    const enriched = state.movies.filter(m=>m.raw_omdb?.imdbID || m.omdb_found).length;
    if ($('cacheTable')) $('cacheTable').innerHTML = [['Records',state.movies.length],['OMDb enriched',enriched],['Local posters',local],['API attempts',counts.api_attempts||0],['Cache reused',counts.cache_reused||0],['Monthly due',counts.records_due_monthly_refresh||0]].map(([k,v])=>`<div class="kv-row"><span>${esc(k)}</span><b>${formatInt(v)}</b></div>`).join('');
    set('logStatus',system.status||'—');
    if ($('errorLog')) $('errorLog').textContent = JSON.stringify({exported_at:new Date().toISOString(),status:system.status||'—',run,keys,errors:Array.isArray(system.errors)?system.errors:[]},null,2);
  }

  function diagnosticsExport() {
    const a = aggregate();
    return JSON.stringify({exported_at:new Date().toISOString(),page:location.href,dataset:{records:state.movies.length,rated:a.rated.length,local_posters:state.movies.filter(m=>normalizeLocalPoster(m.poster_local)).length,omdb_enriched:state.movies.filter(m=>m.raw_omdb?.imdbID||m.omdb_found).length},diagnostics:state.diagnostics},null,2);
  }

  function bindEvents() {
    let timer = 0;
    $('search')?.addEventListener('input', e => { state.query = e.target.value; clearTimeout(timer); timer = setTimeout(()=>{state.page=1;applyFilters();},120); });
    $('searchField')?.addEventListener('change', e => { state.field=e.target.value; state.page=1; applyFilters(); });
    $('typeFilter')?.addEventListener('change', e => { state.type=e.target.value; state.page=1; applyFilters(); });
    $('genreFilter')?.addEventListener('change', e => { state.genre=e.target.value; state.page=1; applyFilters(); });
    $('yearFilter')?.addEventListener('change', e => { state.year=e.target.value; state.page=1; applyFilters(); });
    $('sortFilter')?.addEventListener('change', e => { state.sort=e.target.value; state.page=1; applyFilters(); });
    $('resetFilters')?.addEventListener('click',()=>{state.query='';state.field='all';state.type='all';state.genre='all';state.year='all';state.sort='date_desc';state.page=1;['search','searchField','typeFilter','genreFilter','yearFilter','sortFilter'].forEach(id=>{const el=$(id);if(!el)return;if(id==='search')el.value='';else if(id==='sortFilter')el.value='date_desc';else el.value='all';});applyFilters();});
    $('pageSize')?.addEventListener('change',e=>{const n=Number(e.target.value);if([12,24,36,48].includes(n)){state.pageSize=n;state.page=1;savePageSize();renderLibrary();}});
    $('firstPage')?.addEventListener('click',()=>goPage(1)); $('prevPage')?.addEventListener('click',()=>goPage(state.page-1)); $('nextPage')?.addEventListener('click',()=>goPage(state.page+1)); $('lastPage')?.addEventListener('click',()=>goPage(Math.ceil(state.filtered.length/state.pageSize)));
    $('pageNumbers')?.addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)goPage(Number(b.dataset.page));});
    $('movieGrid')?.addEventListener('click',e=>{const card=e.target.closest('.movie-card');if(card)openModal(card.dataset.id);});
    $('movieGrid')?.addEventListener('keydown',e=>{const card=e.target.closest('.movie-card');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openModal(card.dataset.id);}});
    $('seriesGrid')?.addEventListener('click',e=>{const card=e.target.closest('[data-series]');if(card){const g=seriesGroups().find(x=>String(x.key)===String(card.dataset.series));const target=g?.series||g?.episodes?.[0];if(target)openModal(target.imdb_id);}});
    $('seriesGrid')?.addEventListener('keydown',e=>{const card=e.target.closest('[data-series]');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const g=seriesGroups().find(x=>String(x.key)===String(card.dataset.series));const target=g?.series||g?.episodes?.[0];if(target)openModal(target.imdb_id);}});
    $('ratingTimeline')?.addEventListener('click',e=>{});
    $('detailModal')?.addEventListener('click',e=>{const ep=e.target.closest('[data-open-episode]');if(ep)openModal(ep.dataset.openEpisode);if(e.target===$('detailModal'))closeModal();});
    $('closeModal')?.addEventListener('click',closeModal);
    $('copyId')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.modalId);notify('IMDb ID کپی شد.');}catch{notify('کپی در این مرورگر در دسترس نیست.','warn');}});
    $('jumpLibrary')?.addEventListener('click',()=>document.getElementById('library')?.scrollIntoView({behavior:'smooth'}));
    $('toggleInsights')?.addEventListener('click',()=>{const panel=$('analyticsPanel');if(!panel)return;panel.hidden=!panel.hidden;if(!panel.hidden)renderCharts();});
    $('jumpDiagnostics')?.addEventListener('click',()=>$('diagnostics')?.scrollIntoView({behavior:'smooth'}));
    $('refreshDiagnostics')?.addEventListener('click',loadDiagnostics);
    $('copyDiagnostics')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(diagnosticsExport());notify('گزارش Diagnostics کپی شد.');}catch{notify('کپی گزارش ناموفق بود.','warn');}});
    $('advInsightsRefresh')?.addEventListener('click',()=>window.IMDBPageInsights?.refresh?.());
    $('themeButton')?.addEventListener('click',()=>{const menu=$('themeMenu');if(!menu)return;menu.hidden=!menu.hidden;$('themeButton').setAttribute('aria-expanded',String(!menu.hidden));});
    $('themeMenu')?.addEventListener('click',e=>{const btn=e.target.closest('[data-theme]');if(!btn)return;applyTheme(btn.dataset.theme);$('themeMenu').hidden=true;$('themeButton').setAttribute('aria-expanded','false');});
    $('motionButton')?.addEventListener('click',()=>{state.motion=!state.motion;document.body.classList.toggle('reduce-effects',!state.motion);notify(state.motion?'افکت‌های حرکتی فعال شد.':'افکت‌های حرکتی خاموش شد.');});
    document.addEventListener('click',e=>{if(!e.target.closest('#themeMenu')&&!e.target.closest('#themeButton')){$('themeMenu')?.setAttribute('hidden','');$('themeButton')?.setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();$('search')?.focus();}});
    window.addEventListener('error',e=>error('runtime error',e.error||e.message));
    window.addEventListener('unhandledrejection',e=>error('promise rejection',e.reason));
    if (state.pageSize && $('pageSize')) $('pageSize').value=String(state.pageSize);
  }

  function closeModal(){const modal=$('detailModal');if(modal)modal.hidden=true;document.body.classList.remove('modal-open');state.modalId='';}

  restoreTheme();
  bindEvents();
  load();
})();
