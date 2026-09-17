(() => {
  'use strict';

  const DATA_URL = '../movies.json';
  const CACHE_KEY = 'imdb-advanced-data-v11';
  const PAGE_SIZE_KEY = 'imdb-advanced-page-size-v11';
  const charts = {};

  const state = {
    movies: [],
    filtered: [],
    currentPage: 1,
    pageSize: loadPageSize(),
    query: '',
    type: 'all',
    genre: 'all',
    year: 'all',
    sort: 'date_desc',
    diagnostics: {
      system: null,
      keyState: null,
      runLog: null
    },
    modalId: ''
  };

  const $ = (id) => document.getElementById(id);

  const log = (...args) => console.info('[IMDb Advanced]', ...args);
  const warn = (...args) => console.warn('[IMDb Advanced]', ...args);

  function text(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const s = String(value).replace(/\u0000/g, '').trim();
    return s && s.toUpperCase() !== 'N/A' ? s : fallback;
  }

  function num(value) {
    const n = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[c]);
  }

  function split(value) {
    if (Array.isArray(value)) return value.map(v => text(v)).filter(Boolean);
    return String(value ?? '').split(',').map(v => v.trim()).filter(Boolean);
  }

  function year(value) {
    const m = String(value ?? '').match(/\b(?:18|19|20)\d{2}\b/);
    return m ? Number(m[0]) : 0;
  }

  function dateValue(value) {
    const d = new Date(value || '');
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }

  function formatInt(value) {
    return Math.max(0, Math.round(num(value))).toLocaleString('en-US');
  }

  function formatRuntime(value) {
    const m = String(value ?? '').match(/\d+/);
    const minutes = m ? Number(m[0]) : 0;
    if (!minutes) return '—';
    const h = Math.floor(minutes / 60);
    const min = minutes % 60;
    if (h && min) return `${h}h ${min}m`;
    if (h) return `${h}h`;
    return `${min}m`;
  }

  function formatDate(value) {
    const d = new Date(value || '');
    if (!Number.isFinite(d.getTime())) return text(value, '—');
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit'
    }).format(d);
  }

  function localPoster(movie) {
    const p = text(movie.poster_local, '');
    if (!p) return '';
    if (/^https?:\/\//i.test(p)) return p;
    if (p.startsWith('../') || p.startsWith('/')) return p;
    return p.startsWith('posters/') ? `../${p}` : `../posters/${p}`;
  }

  function posterSrc(movie) {
    return localPoster(movie) || text(movie.poster, '');
  }

  function normalize(movie) {
    const m = movie && typeof movie === 'object' ? movie : {};
    return {
      ...m,
      imdb_id: text(m.imdb_id),
      title: text(m.title, 'Untitled'),
      original_title: text(m.original_title, text(m.title, 'Untitled')),
      year: text(m.year),
      user_rating: num(m.user_rating),
      imdb_rating: text(m.imdb_rating),
      runtime: text(m.runtime),
      genres: text(m.genres),
      title_type: text(m.title_type, 'Other'),
      date_rated: text(m.date_rated),
      poster: text(m.poster),
      poster_local: text(m.poster_local),
      plot: text(m.plot),
      rated: text(m.rated),
      directors: text(m.directors),
      actors: text(m.actors),
      writer: text(m.writer),
      country: text(m.country),
      language: text(m.language),
      awards: text(m.awards),
      box_office: text(m.box_office),
      production: text(m.production),
      metascore: text(m.metascore),
      release_date: text(m.release_date),
      num_votes: text(m.num_votes),
      website: text(m.website),
      series_id: text(m.series_id),
      series_title: text(m.series_title),
      episode_title: text(m.episode_title),
      season_number: num(m.season_number),
      episode_number: num(m.episode_number),
      total_seasons: num(m.total_seasons),
      total_episodes: num(m.total_episodes),
      is_episode: m.is_episode === true || m.title_type === 'TV Episode',
      data_status: text(m.data_status, 'partial'),
      poster_status: text(m.poster_status),
      cache_updated_at: text(m.cache_updated_at),
      data_fetched_at: text(m.data_fetched_at),
      raw_csv: m.raw_csv && typeof m.raw_csv === 'object' ? m.raw_csv : {},
      raw_omdb: m.raw_omdb && typeof m.raw_omdb === 'object' ? m.raw_omdb : {}
    };
  }

  function loadPageSize() {
    try {
      const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
      return [12, 24, 36, 48].includes(n) ? n : 24;
    } catch {
      return 24;
    }
  }

  async function fetchJson(url, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function cacheRead() {
    try {
      const x = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return Array.isArray(x?.movies) ? x : null;
    } catch {
      return null;
    }
  }

  function cacheWrite(movies, generatedAt) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        generatedAt: generatedAt || '',
        movies
      }));
    } catch (err) {
      warn('localStorage cache unavailable', err);
    }
  }

  async function loadData() {
    try {
      const data = await fetchJson(DATA_URL);
      state.movies = (Array.isArray(data?.movies) ? data.movies : data)
        .map(normalize)
        .filter(m => m.imdb_id);
      cacheWrite(state.movies, data?.last_manual_update);
      log(`Loaded ${state.movies.length} records from shared dataset.`);
    } catch (err) {
      const cached = cacheRead();
      if (!cached) {
        notify('Dataset قابل دریافت نیست.', 'error');
        return;
      }
      state.movies = cached.movies.map(normalize).filter(m => m.imdb_id);
      notify('از آخرین نسخه Cache محلی استفاده شد.', 'warn');
    }

    populateFilters();
    applyFilters();
    renderMetrics();
    renderLatest();
    renderSeries();
    loadDiagnostics();
  }

  function searchBlob(movie) {
    return [
      movie.title, movie.original_title, movie.imdb_id,
      movie.genres, movie.directors, movie.actors,
      movie.writer, movie.country, movie.language,
      movie.plot, movie.series_title,
      movie.episode_title
    ].join(' ').toLowerCase();
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    state.filtered = state.movies.filter(movie => {
      if (q && !searchBlob(movie).includes(q)) return false;
      if (state.type !== 'all' && movie.title_type !== state.type) return false;
      if (state.genre !== 'all' && !split(movie.genres).includes(state.genre)) return false;
      if (state.year !== 'all' && year(movie.year) !== Number(state.year)) return false;
      return true;
    });

    state.filtered.sort((a, b) => {
      switch (state.sort) {
        case 'rating_desc': return num(b.user_rating) - num(a.user_rating);
        case 'imdb_desc': return num(b.imdb_rating) - num(a.imdb_rating);
        case 'year_desc': return year(b.year) - year(a.year);
        case 'title_asc': return a.title.localeCompare(b.title);
        default: return dateValue(b.date_rated) - dateValue(a.date_rated);
      }
    });

    const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.currentPage = Math.min(state.currentPage, pageCount);
    if (state.currentPage < 1) state.currentPage = 1;
    renderGrid();
  }

  function populateFilters() {
    const genres = new Set();
    const years = new Set();
    state.movies.forEach(movie => {
      split(movie.genres).forEach(g => genres.add(g));
      const y = year(movie.year);
      if (y) years.add(y);
    });

    if ($('genre')) {
      $('genre').innerHTML = '<option value="all">All genres</option>' + [...genres].sort().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    }
    if ($('year')) {
      $('year').innerHTML = '<option value="all">All years</option>' + [...years].sort((a,b) => b-a).map(y => `<option value="${y}">${y}</option>`).join('');
    }
  }

  function renderMetrics() {
    const movies = state.movies.filter(m => ['Movie', 'Short'].includes(m.title_type));
    const series = state.movies.filter(m => m.title_type === 'TV Series');
    const episodes = state.movies.filter(m => m.is_episode);
    const minutes = state.movies.reduce((sum, m) => sum + num(String(m.runtime).match(/\d+/)?.[0]), 0);
    const rated = state.movies.filter(m => m.user_rating > 0);
    const avg = rated.length ? rated.reduce((s,m) => s + m.user_rating, 0) / rated.length : 0;
    const localPosters = state.movies.filter(m => localPoster(m)).length;
    const enriched = state.movies.filter(m => Object.keys(m.raw_omdb || {}).length > 0 || m.data_status === 'fresh' || m.data_status === 'cached').length;

    setText('mTitles', formatInt(state.movies.length));
    setText('mMovies', formatInt(movies.length));
    setText('mSeries', formatInt(series.length));
    setText('mEpisodes', formatInt(episodes.length));
    setText('mRuntime', formatRuntime(minutes));
    setText('mAvg', avg ? avg.toFixed(1) : '—');
    setText('mPosterCoverage', `${state.movies.length ? Math.round(localPosters / state.movies.length * 100) : 0}%`);
    setText('mOmdbCoverage', `${state.movies.length ? Math.round(enriched / state.movies.length * 100) : 0}%`);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function ratingEmoji(rating) {
    const r = num(rating);
    if (r >= 9) return '🤩🔥🏆';
    if (r >= 8) return '😍🔥';
    if (r >= 7) return '😊👍';
    if (r >= 6) return '🙂';
    if (r >= 5) return '😐';
    if (r > 0) return '😕';
    return '🎬';
  }

  function cardHtml(movie) {
    const poster = posterSrc(movie);
    const fallback = ratingEmoji(movie.user_rating);
    const posterMarkup = poster
      ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(movie.title)}" loading="lazy" decoding="async" data-fallback="${escapeHtml(movie.imdb_id)}"><div class="poster-fallback" data-fallback-for="${escapeHtml(movie.imdb_id)}" hidden>${fallback}</div>`
      : `<div class="poster-fallback">${fallback}</div>`;

    return `<article class="card" data-id="${escapeHtml(movie.imdb_id)}" tabindex="0" role="button">
      <div class="poster">
        ${posterMarkup}
        <div class="badge-top">
          <span class="pill mint">${movie.is_episode ? '📺 EPISODE' : movie.title_type === 'TV Series' ? '📺 SERIES' : '🎬 MOVIE'}</span>
          <span class="pill">${movie.user_rating ? `⭐ ${movie.user_rating}` : '—'}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(movie.title)}</div>
        <div class="card-sub">${escapeHtml(movie.year || '—')}${movie.series_title ? ` • ${escapeHtml(movie.series_title)}` : ''}</div>
        <div class="tags">${split(movie.genres).slice(0,3).map(g => `<span>${escapeHtml(g)}</span>`).join('')}</div>
        <div class="card-score"><span class="mine">${ratingEmoji(movie.user_rating)} ${movie.user_rating || '—'}</span><span class="imdb">IMDb ${escapeHtml(movie.imdb_rating || '—')}</span></div>
      </div>
    </article>`;
  }

  function renderGrid() {
    const grid = $('grid');
    if (!grid) return;
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    const start = (state.currentPage - 1) * state.pageSize;
    const visible = state.filtered.slice(start, start + state.pageSize);
    grid.innerHTML = visible.length ? visible.map(cardHtml).join('') : '<div style="grid-column:1/-1;padding:50px;text-align:center;color:#8b9691">No matching titles.</div>';
    renderPager(pages, total, start);
  }

  function renderPager(pages, total, start) {
    const pagesBox = $('pages');
    if (!pagesBox) return;
    const end = total ? Math.min(total, start + state.pageSize) : 0;
    setText('resultInfo', `${formatInt(total)} results • ${formatInt(start + (total ? 1 : 0))}–${formatInt(end)}`);
    setText('pageCount', `${state.currentPage} / ${pages}`);
    if ($('first')) $('first').disabled = state.currentPage <= 1;
    if ($('prev')) $('prev').disabled = state.currentPage <= 1;
    if ($('next')) $('next').disabled = state.currentPage >= pages;
    if ($('last')) $('last').disabled = state.currentPage >= pages;

    const nums = new Set([1, pages, state.currentPage, state.currentPage-1, state.currentPage+1, state.currentPage-2, state.currentPage+2]);
    const ordered = [...nums].filter(n => n >= 1 && n <= pages).sort((a,b) => a-b);
    let html = '';
    let previous = 0;
    for (const n of ordered) {
      if (previous && n - previous > 1) html += '<span class="page-ellipsis">…</span>';
      html += `<button type="button" class="${n === state.currentPage ? 'active' : ''}" data-page="${n}">${n}</button>`;
      previous = n;
    }
    pagesBox.innerHTML = html || '<button type="button" class="active">1</button>';
  }

  function goPage(n) {
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    const page = Math.min(Math.max(1, Number(n) || 1), pages);
    state.currentPage = page;
    renderGrid();
    $('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderLatest() {
    const box = $('latestGrid');
    if (!box) return;
    const latest = [...state.movies].filter(m => m.date_rated).sort((a,b) => dateValue(b.date_rated)-dateValue(a.date_rated)).slice(0,6);
    box.innerHTML = latest.length ? latest.map(movie => `<article class="latest-card" data-id="${escapeHtml(movie.imdb_id)}">
      ${posterSrc(movie) ? `<img src="${escapeHtml(posterSrc(movie))}" alt="${escapeHtml(movie.title)}" loading="lazy" data-fallback="latest-${escapeHtml(movie.imdb_id)}">` : ''}
      <div class="latest-copy"><b>${escapeHtml(movie.title)}</b><small>${formatDate(movie.date_rated)} • ⭐ ${movie.user_rating || '—'}</small><div class="latest-rating">${ratingEmoji(movie.user_rating)}</div></div>
    </article>`).join('') : '<div class="muted">No rated titles yet.</div>';
  }

  function renderSeries() {
    const box = $('seriesGrid');
    if (!box) return;
    const map = new Map();
    state.movies.forEach(m => {
      if (!(m.series_id || m.series_title || m.title_type === 'TV Series' || m.is_episode)) return;
      const key = m.series_id || m.series_title || m.imdb_id;
      if (!map.has(key)) map.set(key, { key, title: m.series_title || m.title, poster: posterSrc(m), episodes: [], series: null });
      const item = map.get(key);
      if (!item.poster && posterSrc(m)) item.poster = posterSrc(m);
      if (m.is_episode) item.episodes.push(m);
      if (m.title_type === 'TV Series') item.series = m;
    });

    const series = [...map.values()].sort((a,b) => a.title.localeCompare(b.title)).slice(0,18);
    setText('seriesCount', `${formatInt(series.length)} groups`);
    box.innerHTML = series.length ? series.map(s => {
      const seasons = new Set(s.episodes.map(e => e.season_number).filter(Boolean)).size;
      const watched = s.episodes.filter(e => e.user_rating > 0).length;
      const total = s.episodes.length;
      const progress = total ? Math.round(watched / total * 100) : 0;
      return `<article class="series-card" data-series="${escapeHtml(s.key)}">
        <div class="series-head"><div class="series-poster">${s.poster ? `<img src="${escapeHtml(s.poster)}" alt="" loading="lazy">` : '📺'}</div><div><strong>${escapeHtml(s.title)}</strong><p>${seasons || s.series?.total_seasons || 0} seasons • ${total || s.series?.total_episodes || 0} episodes</p></div></div>
        <div class="series-badges"><span class="badge">⭐ ${watched}/${total || 0}</span><span class="badge">${progress}% rated</span></div>
        <div class="progress" style="--progress:${progress}%"><i></i></div>
      </article>`;
    }).join('') : '<div class="muted">No grouped series data found.</div>';
  }

  function openModal(id) {
    const movie = state.movies.find(m => m.imdb_id === id);
    if (!movie) return notify('رکورد پیدا نشد.', 'error');
    state.modalId = id;
    const modal = $('modal');
    if (!modal) return;

    const poster = posterSrc(movie);
    const image = $('modalPoster');
    const fallback = $('modalFallback');
    if (image) {
      image.onerror = () => { image.hidden = true; if (fallback) fallback.hidden = false; };
      if (poster) { image.src = poster; image.hidden = false; if (fallback) fallback.hidden = true; }
      else { image.removeAttribute('src'); image.hidden = true; if (fallback) fallback.hidden = false; }
    }

    setText('modalType', movie.title_type.toUpperCase());
    setText('modalTitle', movie.title);
    setText('modalOriginal', movie.original_title);
    setText('modalUser', movie.user_rating || '—');
    setText('modalIMDb', movie.imdb_rating || '—');
    setText('modalMeta', movie.metascore || '—');
    setText('modalPlot', movie.plot || 'No plot information available.');

    const tags = $('modalTags');
    if (tags) tags.innerHTML = split(movie.genres).map(g => `<span>${escapeHtml(g)}</span>`).join('');

    const details = [
      ['Year', movie.year], ['Runtime', formatRuntime(movie.runtime)], ['Rated', movie.rated], ['Released', movie.release_date],
      ['Genres', movie.genres], ['Director', movie.directors], ['Writer', movie.writer], ['Actors', movie.actors],
      ['Country', movie.country], ['Language', movie.language], ['Votes', movie.num_votes], ['Date Rated', formatDate(movie.date_rated)],
      ['Awards', movie.awards], ['Box Office', movie.box_office], ['Production', movie.production], ['Data Status', movie.data_status],
      ['Poster Status', movie.poster_status], ['Cache Updated', movie.cache_updated_at ? formatDate(movie.cache_updated_at) : '—']
    ];
    const detailGrid = $('modalDetails');
    if (detailGrid) detailGrid.innerHTML = details.map(([k,v]) => `<div class="detail-card"><span>${escapeHtml(k)}</span><b>${escapeHtml(text(v,'—'))}</b></div>`).join('');

    const seriesDetails = $('seriesDetails');
    if (seriesDetails) seriesDetails.innerHTML = buildSeriesDetails(movie);

    const raw = $('rawData');
    if (raw) raw.textContent = JSON.stringify({ csv: movie.raw_csv, omdb: movie.raw_omdb }, null, 2);

    const link = $('modalLink');
    if (link) link.href = movie.url || `https://www.imdb.com/title/${encodeURIComponent(movie.imdb_id)}/`;

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function buildSeriesDetails(movie) {
    if (!(movie.is_episode || movie.title_type === 'TV Series' || movie.series_id || movie.series_title)) return '';
    const key = movie.series_id || movie.series_title || movie.imdb_id;
    const eps = state.movies.filter(m => m.is_episode && ((movie.series_id && m.series_id === movie.series_id) || (movie.series_title && m.series_title === movie.series_title) || m.series_id === key))
      .sort((a,b) => num(a.season_number)-num(b.season_number) || num(a.episode_number)-num(b.episode_number));
    const seasons = new Map();
    eps.forEach(e => { const s = e.season_number || 0; if (!seasons.has(s)) seasons.set(s, []); seasons.get(s).push(e); });
    if (!seasons.size) return `<div class="series-detail"><strong>📺 Series context</strong><p>${escapeHtml(movie.series_title || movie.title)}</p></div>`;
    return `<div><strong>📺 Series context</strong><div class="episode-grid">${[...seasons.entries()].map(([season,list]) => `<div class="episode" data-season="${season}"><div class="no">Season ${season || '?'}</div><div class="name">${list.length} episodes</div><div class="score">Rated ${list.filter(e => e.user_rating > 0).length}/${list.length}</div></div>`).join('')}</div></div>`;
  }

  function closeModal() {
    if ($('modal')) $('modal').hidden = true;
    document.body.style.overflow = '';
  }

  function notify(message, kind = 'ok') {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    toast.dataset.kind = kind;
    clearTimeout(toast.__t);
    toast.__t = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  async function loadDiagnostics() {
    const [system, keyState, runLog] = await Promise.allSettled([
      fetchJson('../system-status.json'),
      fetchJson('../omdb-key-state.json'),
      fetchJson('../update-log.json')
    ]);
    state.diagnostics.system = system.status === 'fulfilled' ? system.value : null;
    state.diagnostics.keyState = keyState.status === 'fulfilled' ? keyState.value : null;
    state.diagnostics.runLog = runLog.status === 'fulfilled' ? runLog.value : null;
    renderDiagnostics();
  }

  function renderDiagnostics() {
    const system = state.diagnostics.system || {};
    const lastRun = Array.isArray(state.diagnostics.runLog?.runs) ? state.diagnostics.runLog.runs[0] : system.run;
    const errors = system.errors || lastRun?.errors || [];
    const stateRows = Object.values(state.diagnostics.keyState?.keys || {});
    const currentRows = Array.isArray(system.keys) ? system.keys : [];
    const mergedMap = new Map();
    [...stateRows, ...currentRows].forEach(row => {
      const key = row.fingerprint || row.label || Math.random().toString(36);
      const previous = mergedMap.get(key) || {};
      mergedMap.set(key, { ...previous, ...row });
    });
    const rows = [...mergedMap.values()];

    const healthy = rows.filter(r => ['active','healthy'].includes(r.status || r.last_status || r.last_health_check_status)).length;
    const rate = rows.filter(r => ['rate_limited'].includes(r.status || r.last_status || r.last_health_check_status)).length;
    const invalid = rows.filter(r => ['invalid'].includes(r.status || r.last_status || r.last_health_check_status)).length;
    const requests = rows.reduce((s,r) => s + num(r.total_requests ?? r.requests_this_run), 0);

    const summary = $('diagSummary');
    if (summary) summary.innerHTML = [
      ['Keys', rows.length || (system.keys || []).length || 0],
      ['Healthy', healthy],
      ['Rate limited', rate],
      ['Total requests', formatInt(requests)]
    ].map(([k,v]) => `<div><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`).join('');

    const keyTable = $('keyTable');
    const keyArray = rows;
    if (keyTable) keyTable.innerHTML = keyArray.length ? keyArray.map(r => {
      const status = r.status || r.last_status || r.last_health_check_status || 'not_tested';
      const cls = ['active','healthy'].includes(status) ? 'status-active' : ['invalid','rate_limited'].includes(status) ? 'status-bad' : 'status-warn';
      const daily = r.daily_requests ?? r.requests_this_run ?? 0;
      const total = r.total_requests ?? 0;
      return `<div class="key-row"><span>${escapeHtml(r.label || 'key')}</span><span>${escapeHtml(r.fingerprint || '—')}</span><span class="${cls}">${escapeHtml(status)}</span><span>${formatInt(daily)}/day • ${formatInt(total)} total</span></div>`;
    }).join('') : '<div class="muted">No key diagnostics yet.</div>';

    const cache = $('cacheTable');
    const runCounts = lastRun?.counts || system.run?.counts || {};
    if (cache) cache.innerHTML = [
      ['Records', state.movies.length],
      ['OMDb enriched', state.movies.filter(m => Object.keys(m.raw_omdb || {}).length).length],
      ['Local posters', state.movies.filter(m => localPoster(m)).length],
      ['API attempts', runCounts.api_attempts || 0],
      ['Cache reused', runCounts.cache_reused || 0],
      ['Monthly refresh due', runCounts.records_due_monthly_refresh || 0],
      ['Poster attempts', runCounts.poster_attempts || 0],
      ['Posters downloaded', runCounts.posters_downloaded || 0]
    ].map(([k,v]) => `<div class="kv-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(formatInt(v))}</b></div>`).join('');

    const errorLog = $('errorLog');
    if (errorLog) errorLog.textContent = errors.length ? JSON.stringify(errors, null, 2) : 'No recorded errors in the latest diagnostic snapshot.';
  }

  function diagnosticsText() {
    return JSON.stringify({
      exported_at: new Date().toISOString(),
      page: location.href,
      dataset_records: state.movies.length,
      dataset_status: {
        local_posters: state.movies.filter(m => localPoster(m)).length,
        omdb_enriched: state.movies.filter(m => Object.keys(m.raw_omdb || {}).length).length
      },
      system: state.diagnostics.system,
      key_state: state.diagnostics.keyState,
      last_runs: state.diagnostics.runLog
    }, null, 2);
  }

  function init() {
    $('search')?.addEventListener('input', e => { state.query = e.target.value; state.currentPage = 1; applyFilters(); });
    $('type')?.addEventListener('change', e => { state.type = e.target.value; state.currentPage = 1; applyFilters(); });
    $('genre')?.addEventListener('change', e => { state.genre = e.target.value; state.currentPage = 1; applyFilters(); });
    $('year')?.addEventListener('change', e => { state.year = e.target.value; state.currentPage = 1; applyFilters(); });
    $('sort')?.addEventListener('change', e => { state.sort = e.target.value; state.currentPage = 1; applyFilters(); });
    $('reset')?.addEventListener('click', () => {
      state.query = ''; state.type = 'all'; state.genre = 'all'; state.year = 'all'; state.sort = 'date_desc'; state.currentPage = 1;
      if ($('search')) $('search').value = '';
      if ($('type')) $('type').value = 'all';
      if ($('genre')) $('genre').value = 'all';
      if ($('year')) $('year').value = 'all';
      if ($('sort')) $('sort').value = 'date_desc';
      applyFilters();
    });
    $('pageSize')?.addEventListener('change', e => {
      const n = Number(e.target.value);
      if ([12,24,36,48].includes(n)) { state.pageSize = n; localStorage.setItem(PAGE_SIZE_KEY, String(n)); state.currentPage = 1; renderGrid(); }
    });
    $('first')?.addEventListener('click', () => goPage(1));
    $('prev')?.addEventListener('click', () => goPage(state.currentPage - 1));
    $('next')?.addEventListener('click', () => goPage(state.currentPage + 1));
    $('last')?.addEventListener('click', () => goPage(Math.ceil(state.filtered.length / state.pageSize)));
    $('pages')?.addEventListener('click', e => {
      const b = e.target.closest('[data-page]');
      if (b) goPage(Number(b.dataset.page));
    });
    $('grid')?.addEventListener('click', e => { const card = e.target.closest('[data-id]'); if (card) openModal(card.dataset.id); });
    document.addEventListener('error', e => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      const fallbackId = img.dataset.fallback;
      if (fallbackId) {
        img.hidden = true;
        const fallback = img.parentElement?.querySelector(`[data-fallback-for="${CSS.escape(fallbackId)}"]`);
        if (fallback) fallback.hidden = false;
      }
    }, true);
    $('grid')?.addEventListener('keydown', e => { const card = e.target.closest('[data-id]'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openModal(card.dataset.id); } });
    $('latestGrid')?.addEventListener('click', e => { const card = e.target.closest('[data-id]'); if (card) openModal(card.dataset.id); });
    $('seriesGrid')?.addEventListener('click', e => {
      const card = e.target.closest('[data-series]');
      if (!card) return;
      const item = state.movies.find(m => (m.series_id || m.series_title || m.imdb_id) === card.dataset.series);
      if (item) openModal(item.imdb_id);
    });
    $('closeModal')?.addEventListener('click', closeModal);
    $('modal')?.addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
    $('copyId')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.modalId || ''); notify('IMDb ID copied.'); } catch { notify('Copy failed.', 'warn'); }
    });
    $('refreshDiagnostics')?.addEventListener('click', loadDiagnostics);
    $('copyDiagnostics')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(diagnosticsText()); notify('Diagnostic report copied.'); } catch { notify('Copy failed.', 'warn'); }
    });
    $('jumpLibrary')?.addEventListener('click', () => $('library')?.scrollIntoView({behavior:'smooth'}));
    $('latestToLibrary')?.addEventListener('click', () => $('library')?.scrollIntoView({behavior:'smooth'}));
    $('openAnalytics')?.addEventListener('click', () => {
      const section = $('analytics');
      if (!section) return;
      section.hidden = !section.hidden;
      if (!section.hidden) generateCharts();
    });
    $('openDiagnostics')?.addEventListener('click', () => $('diagnostics')?.scrollIntoView({behavior:'smooth'}));
    $('advInsightsRefresh')?.addEventListener('click', () => window.IMDBPageInsights?.refresh?.());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
      if (e.key === '/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); $('search')?.focus(); }
    });
    if ($('pageSize')) $('pageSize').value = String(state.pageSize);
    window.addEventListener('error', e => console.error('[IMDb Advanced] runtime error', e.error || e.message || e), { passive: true });
    window.addEventListener('unhandledrejection', e => console.error('[IMDb Advanced] unhandled rejection', e.reason), { passive: true });
    loadData();
  }

  function generateCharts() {
    if (typeof Chart === 'undefined') return;
    Object.values(charts).forEach(c => { try { c.destroy(); } catch {} });
    const genre = {};
    const rating = {};
    const years = {};
    state.movies.forEach(m => {
      split(m.genres).forEach(g => genre[g] = (genre[g] || 0) + 1);
      if (m.user_rating > 0) rating[Math.round(m.user_rating)] = (rating[Math.round(m.user_rating)] || 0) + 1;
      const y = year(m.year); if (y) years[y] = (years[y] || 0) + 1;
    });
    const common = { responsive:true, maintainAspectRatio:false, plugins:{legend:{labels:{color:'#a7b1ac',font:{family:'Manrope'}}}}, scales:{x:{ticks:{color:'#85918b'},grid:{color:'rgba(255,255,255,.04)'}},y:{beginAtZero:true,ticks:{color:'#85918b'},grid:{color:'rgba(255,255,255,.04)'}}} };
    charts.genre = new Chart($('genreChart'), {type:'bar',data:{labels:Object.entries(genre).sort((a,b)=>b[1]-a[1]).slice(0,12).map(x=>x[0]),datasets:[{label:'Titles',data:Object.entries(genre).sort((a,b)=>b[1]-a[1]).slice(0,12).map(x=>x[1]),backgroundColor:'#21F1A8',borderRadius:7}]},options:common});
    charts.rating = new Chart($('ratingChart'), {type:'bar',data:{labels:Object.keys(rating).sort((a,b)=>a-b),datasets:[{label:'Ratings',data:Object.keys(rating).sort((a,b)=>a-b).map(x=>rating[x]),backgroundColor:'#d7fff0',borderRadius:7}]},options:common});
    const ys = Object.keys(years).sort((a,b)=>a-b).slice(-18);
    charts.year = new Chart($('yearChart'), {type:'line',data:{labels:ys,datasets:[{label:'Titles',data:ys.map(y=>years[y]),borderColor:'#21F1A8',backgroundColor:'rgba(33,241,168,.08)',fill:true,tension:.3}]},options:common});
  }

  init();
})();
