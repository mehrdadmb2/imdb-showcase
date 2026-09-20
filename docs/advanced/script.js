(() => {
  'use strict';

  const DATA_URL = '../movies.json';
  const CACHE_KEY = 'imdb-advanced-data-v12';
  const PAGE_SIZE_KEY = 'imdb-advanced-page-size-v12';

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
    diagnostics: { system: null, keyState: null, runLog: null },
    mouseX: 0,
    mouseY: 0,
    mouseRaf: 0
  };

  const $ = (id) => document.getElementById(id);

  const log = (...args) => console.info('[IMDb Advanced]', ...args);
  const warn = (...args) => console.warn('[IMDb Advanced]', ...args);
  const error = (...args) => console.error('[IMDb Advanced]', ...args);

  function text(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const s = String(value).replace(/\u0000/g, '').trim();
    if (!s || s.toUpperCase() === 'N/A') return fallback;
    return s;
  }

  function number(value, fallback = 0) {
    const n = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[c]);
  }

  function split(value) {
    if (Array.isArray(value)) return value.map((v) => text(v)).filter(Boolean);
    return String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
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
    return Math.max(0, Math.round(number(value))).toLocaleString('en-US');
  }

  function formatDecimal(value, digits = 1) {
    const n = number(value);
    return n ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  }

  function formatDate(value) {
    const d = new Date(value || '');
    if (!Number.isFinite(d.getTime())) return text(value, '—');
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
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

  function loadPageSize() {
    try {
      const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
      return [12, 24, 36, 48].includes(n) ? n : 24;
    } catch {
      return 24;
    }
  }

  function savePageSize() {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(state.pageSize)); } catch {}
  }

  function normalizeLocalPoster(value) {
    let p = text(value, '').replace(/\\/g, '/').trim();
    if (!p) return '';
    if (/^https?:\/\//i.test(p)) return p;
    p = p.replace(/^\.\//, '').replace(/^\//, '');
    if (p.startsWith('docs/')) p = p.slice(5);
    if (p.startsWith('advanced/')) p = p.slice(9);
    if (p.startsWith('posters/')) return `../${p}`;
    if (p.includes('/posters/')) return `../${p.slice(p.indexOf('posters/'))}`;
    return `../posters/${p}`;
  }

  function remotePoster(movie) {
    const candidates = [
      text(movie?.poster, ''),
      text(movie?.poster_remote, ''),
      text(movie?.raw_omdb?.Poster, '')
    ].filter((v) => /^https?:\/\//i.test(v));
    return candidates[0] || '';
  }

  function posterSources(movie) {
    return [normalizeLocalPoster(movie?.poster_local), remotePoster(movie)]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  function setPoster(img, fallback, movie) {
    if (!img) return;
    const sources = posterSources(movie);
    let index = 0;
    const useNext = () => {
      if (index >= sources.length) {
        img.hidden = true;
        if (fallback) fallback.hidden = false;
        return;
      }
      img.hidden = false;
      if (fallback) fallback.hidden = true;
      img.src = sources[index++];
    };
    img.onerror = useNext;
    useNext();
  }

  function normalizeMovie(movie) {
    const m = movie && typeof movie === 'object' ? movie : {};
    return {
      ...m,
      imdb_id: text(m.imdb_id, ''),
      title: text(m.title, 'بدون عنوان'),
      original_title: text(m.original_title, text(m.title, 'بدون عنوان')),
      year: text(m.year, ''),
      user_rating: number(m.user_rating),
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
      poster_last_attempt_at: text(m.poster_last_attempt_at, ''),
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
      season_number: number(m.season_number),
      episode_number: number(m.episode_number),
      episode_title: text(m.episode_title, ''),
      total_seasons: number(m.total_seasons),
      total_episodes: number(m.total_episodes),
      is_episode: m.is_episode === true || m.title_type === 'TV Episode',
      data_status: text(m.data_status, m.omdb_found ? 'fresh' : 'partial'),
      data_stale_reason: text(m.data_stale_reason, ''),
      data_fetched_at: text(m.data_fetched_at, ''),
      cache_updated_at: text(m.cache_updated_at, ''),
      raw_csv: m.raw_csv && typeof m.raw_csv === 'object' ? m.raw_csv : {},
      raw_omdb: m.raw_omdb && typeof m.raw_omdb === 'object' ? m.raw_omdb : {}
    };
  }

  async function fetchJson(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || (!Array.isArray(data.movies) && !Array.isArray(data))) {
        throw new Error('ساختار Dataset معتبر نیست.');
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function loadCachedDataset() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return Array.isArray(data?.movies) ? data : null;
    } catch (err) {
      warn('Advanced localStorage cache unusable', err);
      return null;
    }
  }

  function saveCachedDataset(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), movies: data.movies, meta: data.data_meta || {} }));
    } catch (err) {
      warn('Advanced cache save failed', err);
    }
  }

  async function loadData() {
    setHeroHealth('LOADING');
    try {
      const data = await fetchJson(DATA_URL);
      state.movies = (Array.isArray(data.movies) ? data.movies : data).map(normalizeMovie).filter((m) => m.imdb_id);
      saveCachedDataset({ movies: state.movies, data_meta: data.data_meta });
      renderGlobal(data);
      log(`Loaded ${state.movies.length} records from shared Repository dataset.`);
    } catch (err) {
      error('Shared dataset load failed', err);
      const cached = loadCachedDataset();
      if (cached?.movies?.length) {
        state.movies = cached.movies.map(normalizeMovie).filter((m) => m.imdb_id);
        renderGlobal({ data_meta: { cache_fallback: true } });
        notify('Dataset زنده در دسترس نبود؛ آخرین نسخه سالم محلی نمایش داده شد.', 'warn');
      } else {
        state.movies = [];
        renderEmptyAll('Dataset در دسترس نیست. ابتدا اجرای GitHub Action را بررسی کن.');
      }
    }

    populateFilterOptions();
    applyFilters();
    renderLatest();
    renderSeriesUniverse();
    loadDiagnostics();
    setHeroHealth(state.movies.length ? 'READY' : 'EMPTY');
  }

  function setHeroHealth(value) {
    const badge = $('heroHealth');
    if (badge) badge.textContent = value;
  }

  function renderGlobal(data) {
    const movies = state.movies;
    const movieCount = movies.filter((m) => m.title_type === 'Movie' || m.title_type === 'Short').length;
    const seriesCount = movies.filter((m) => m.title_type === 'TV Series').length;
    const episodeCount = movies.filter((m) => m.is_episode).length;
    const minutes = movies.reduce((sum, m) => sum + runtimeMinutes(m.runtime), 0);
    const rated = movies.filter((m) => m.user_rating > 0);
    const avg = rated.length ? rated.reduce((sum, m) => sum + m.user_rating, 0) / rated.length : 0;
    const localPosters = movies.filter((m) => Boolean(normalizeLocalPoster(m.poster_local))).length;
    const remotePosters = movies.filter((m) => Boolean(remotePoster(m))).length;
    const enriched = movies.filter((m) => Boolean(m.raw_omdb?.imdbID || m.omdb_found)).length;
    const meta = data?.data_meta || {};

    set('mTitles', formatInt(movies.length));
    set('mMovies', formatInt(movieCount));
    set('mSeries', formatInt(seriesCount));
    set('mEpisodes', formatInt(episodeCount));
    set('mRuntime', formatRuntime(`${minutes} min`));
    set('mAvg', avg ? formatDecimal(avg, 1) : '—');
    set('mPoster', `${formatInt(localPosters)} / ${formatInt(remotePosters)}`);
    set('mOmdb', `${formatInt(enriched)} / ${formatInt(movies.length)}`);

    const recent = [...movies].sort((a, b) => dateValue(b.date_rated) - dateValue(a.date_rated))[0];
    set('heroRecords', formatInt(movies.length));
    set('heroOmdb', enriched ? `${Math.round(enriched / Math.max(1, movies.length) * 100)}%` : '0%');
    set('heroPosters', localPosters ? `${Math.round(localPosters / Math.max(1, movies.length) * 100)}%` : '0%');
    set('heroUpdated', recent?.date_rated ? formatDate(recent.date_rated) : text(meta.generated_at, '—'));
  }

  function populateFilterOptions() {
    const genres = new Set();
    const years = new Set();
    state.movies.forEach((m) => {
      split(m.genres).forEach((g) => genres.add(g));
      const y = year(m.year);
      if (y) years.add(y);
    });
    const genre = $('genre');
    const yearEl = $('year');
    if (genre) genre.innerHTML = '<option value="all">همه ژانرها</option>' + [...genres].sort((a, b) => a.localeCompare(b)).map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    if (yearEl) yearEl.innerHTML = '<option value="all">همه سال‌ها</option>' + [...years].sort((a, b) => b - a).map((y) => `<option value="${y}">${y}</option>`).join('');
  }

  function searchScore(movie, query) {
    if (!query) return 0;
    const q = query.toLowerCase().trim();
    const fields = {
      title: movie.title,
      original_title: movie.original_title,
      actors: movie.actors,
      directors: movie.directors,
      writer: movie.writer,
      genres: movie.genres,
      plot: movie.plot,
      imdb_id: movie.imdb_id,
      all: [movie.title, movie.original_title, movie.actors, movie.directors, movie.writer, movie.genres, movie.plot, movie.imdb_id].join(' ')
    };
    const value = String(fields[state.field] || '').toLowerCase();
    if (!value) return -1;
    const tokens = q.split(/\s+/).filter(Boolean);
    let score = 0;
    if (value === q) score += 1000;
    if (value.startsWith(q)) score += 600;
    if (value.includes(` ${q}`)) score += 450;
    if (value.includes(q)) score += 300;
    for (const token of tokens) {
      if (value === token) score += 180;
      else if (value.startsWith(token)) score += 90;
      else if (value.includes(token)) score += 45;
      else score -= 80;
    }
    if (state.field === 'title' && value.includes(q)) score += 120;
    return score;
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    const scored = [];
    for (const m of state.movies) {
      if (state.type !== 'all' && m.title_type !== state.type) continue;
      if (state.genre !== 'all' && !split(m.genres).includes(state.genre)) continue;
      if (state.year !== 'all' && year(m.year) !== Number(state.year)) continue;
      const score = searchScore(m, q);
      if (q && score < 0) continue;
      scored.push({ movie: m, score });
    }

    scored.sort((a, b) => {
      if (q && b.score !== a.score) return b.score - a.score;
      return compareMovies(a.movie, b.movie, state.sort);
    });

    state.filtered = scored.map((x) => x.movie);
    state.page = 1;
    renderGrid();
    updateQueryStatus(q);
  }

  function compareMovies(a, b, sort) {
    switch (sort) {
      case 'rating_desc': return number(b.user_rating) - number(a.user_rating) || dateValue(b.date_rated) - dateValue(a.date_rated);
      case 'imdb_desc': return number(b.imdb_rating) - number(a.imdb_rating) || dateValue(b.date_rated) - dateValue(a.date_rated);
      case 'year_desc': return year(b.year) - year(a.year) || dateValue(b.date_rated) - dateValue(a.date_rated);
      case 'title_asc': return String(a.title).localeCompare(String(b.title), 'fa');
      case 'date_desc':
      default: return dateValue(b.date_rated) - dateValue(a.date_rated) || number(b.user_rating) - number(a.user_rating);
    }
  }

  function updateQueryStatus(q) {
    set('searchStatus', q ? `${formatInt(state.filtered.length)} نتیجه مرتبط` : `${formatInt(state.filtered.length)} عنوان آماده نمایش`);
    const hint = $('queryHint');
    if (hint) hint.textContent = q ? `مرتب‌شده بر اساس میزان ارتباط • فیلد: ${fieldLabel(state.field)}` : '';
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(state.page, pages);
  }

  function fieldLabel(field) {
    return ({ all: 'همه', title: 'عنوان', original_title: 'عنوان اصلی', actors: 'بازیگران', directors: 'کارگردان', writer: 'نویسنده', genres: 'ژانر', plot: 'خلاصه', imdb_id: 'IMDb ID' })[field] || field;
  }

  function renderLatest() {
    const host = $('latestGrid');
    if (!host) return;
    const latest = [...state.movies].filter((m) => m.date_rated).sort((a, b) => dateValue(b.date_rated) - dateValue(a.date_rated)).slice(0, 6);
    host.innerHTML = latest.map((m) => latestCard(m)).join('') || '<div class="muted">عنوانی با تاریخ امتیاز ثبت‌شده پیدا نشد.</div>';
    wirePosterEvents(host);
  }

  function latestCard(movie) {
    const local = normalizeLocalPoster(movie.poster_local);
    const remote = remotePoster(movie);
    const source = local || remote;
    const title = escapeHtml(movie.title);
    const poster = source
      ? `<img class="spotlight-poster poster-smart" src="${escapeHtml(source)}" alt="${title}" loading="lazy" data-local="${escapeHtml(local)}" data-remote="${escapeHtml(remote)}">`
      : `<div class="spotlight-poster movie-fallback">🎬<small>Poster unavailable</small></div>`;
    return `<article class="spotlight-card" data-id="${escapeHtml(movie.imdb_id)}" tabindex="0" role="button" aria-label="نمایش ${title}">${poster}<div class="spotlight-overlay"><div class="spotlight-title">${title}</div><div class="spotlight-meta">${escapeHtml(movie.year || '—')} • ${escapeHtml(movie.title_type)}</div><div class="spotlight-rating">⭐ ${movie.user_rating || '—'} • ${formatDate(movie.date_rated)}</div></div></article>`;
  }

  function renderSeriesUniverse() {
    const host = $('seriesGrid');
    if (!host) return;
    const map = new Map();
    state.movies.forEach((m) => {
      if (!(m.title_type === 'TV Series' || m.is_episode || m.series_id || m.series_title)) return;
      const key = m.series_id || m.series_title || m.imdb_id;
      if (!map.has(key)) map.set(key, { key, title: m.series_title || m.title, poster: m.poster_local || m.poster, episodes: [], series: null });
      const item = map.get(key);
      if (m.is_episode) item.episodes.push(m);
      if (!item.poster) item.poster = m.poster_local || m.poster;
      if (m.title_type === 'TV Series') item.series = m;
    });
    const series = [...map.values()].sort((a, b) => String(a.title).localeCompare(String(b.title), 'fa')).slice(0, 18);
    set('seriesCount', `${formatInt(series.length)} مجموعه`);
    host.innerHTML = series.map((item) => {
      const episodes = item.episodes.sort((a, b) => number(a.season_number) - number(b.season_number) || number(a.episode_number) - number(b.episode_number));
      const rated = episodes.filter((x) => x.user_rating > 0).length;
      const pct = episodes.length ? Math.round(rated / episodes.length * 100) : 0;
      const local = item.series?.poster_local || episodes[0]?.poster_local || '';
      const remote = item.series ? remotePoster(item.series) : remotePoster(episodes[0] || {});
      const src = normalizeLocalPoster(local) || remote;
      const image = src ? `<img class="series-poster poster-smart" src="${escapeHtml(src)}" alt="" data-local="${escapeHtml(normalizeLocalPoster(local))}" data-remote="${escapeHtml(remote)}">` : `<div class="series-poster movie-fallback">📺</div>`;
      return `<article class="series-card" data-series="${escapeHtml(item.key)}" tabindex="0" role="button">${image}<div><div class="series-title">${escapeHtml(item.title)}</div><div class="series-meta">${formatInt(new Set(episodes.map((e) => number(e.season_number)).filter(Boolean)).size)} فصل • ${formatInt(episodes.length || item.series?.total_episodes || 0)} قسمت</div><div class="series-tags"><span>⭐ ${formatDecimal(episodes.filter((e) => e.user_rating > 0).reduce((a, e) => a + e.user_rating, 0) / Math.max(1, rated), 1)}</span><span>${formatInt(rated)}/${formatInt(episodes.length || 0)} Rated</span></div><div class="progress"><i style="width:${pct}%"></i></div></div></article>`;
    }).join('') || '<div class="muted">اطلاعات سریالی کافی نیست.</div>';
    wirePosterEvents(host);
  }

  function renderGrid() {
    const grid = $('grid');
    if (!grid) return;
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * state.pageSize;
    const visible = state.filtered.slice(start, start + state.pageSize);
    grid.innerHTML = visible.length ? visible.map(movieCard).join('') : '<div class="empty-grid">🎭<p>چیزی با این فیلتر پیدا نشد.</p></div>';
    wirePosterEvents(grid);
    renderPager(total, pages, start, visible.length);
  }

  function movieCard(movie) {
    const local = normalizeLocalPoster(movie.poster_local);
    const remote = remotePoster(movie);
    const src = local || remote;
    const title = escapeHtml(movie.title);
    const poster = src
      ? `<img class="movie-poster poster-smart" src="${escapeHtml(src)}" alt="${title}" loading="lazy" decoding="async" data-local="${escapeHtml(local)}" data-remote="${escapeHtml(remote)}"><div class="movie-fallback" hidden>🎬<small>Poster unavailable</small></div>`
      : `<div class="movie-fallback">🎬<small>Poster unavailable</small></div>`;
    const tags = split(movie.genres).slice(0, 2).map((g) => `<span>${escapeHtml(g)}</span>`).join('');
    const type = movie.title_type === 'TV Episode' ? '📺 قسمت' : movie.title_type === 'TV Series' ? '📺 سریال' : movie.title_type === 'Short' ? '🎞️ کوتاه' : '🎬 فیلم';
    return `<article class="movie-card" data-id="${escapeHtml(movie.imdb_id)}" tabindex="0" role="button" aria-label="نمایش ${title}"><div class="movie-poster-wrap">${poster}<div class="movie-sheen"></div><span class="movie-badge">${type}</span></div><div class="movie-info"><div class="movie-title">${title}</div><div class="movie-sub">${escapeHtml(movie.year || '—')} • ${escapeHtml(formatRuntime(movie.runtime))}</div><div class="movie-tags">${tags}</div><div class="movie-score"><span class="user">⭐ ${movie.user_rating || '—'}</span><span class="imdb">IMDb ${escapeHtml(movie.imdb_rating || '—')}</span></div></div></article>`;
  }

  function wirePosterEvents(host) {
    if (!host) return;
    host.querySelectorAll('.poster-smart').forEach((img) => {
      if (img.dataset.posterBound === '1') return;
      img.dataset.posterBound = '1';
      let triedLocal = Boolean(img.dataset.local && img.src.includes('posters/'));
      img.addEventListener('error', () => {
        const remote = img.dataset.remote || '';
        if (remote && !img.dataset.triedRemote) {
          img.dataset.triedRemote = '1';
          img.hidden = false;
          img.src = remote;
          return;
        }
        img.hidden = true;
        const fallback = img.parentElement?.querySelector('.movie-fallback') || img.parentElement?.querySelector('#modalFallback');
        if (fallback) fallback.hidden = false;
      }, { once: false });
      if (!triedLocal && img.dataset.remote) img.dataset.triedRemote = '1';
    });
  }

  function renderPager(total, pages, start, visibleCount) {
    set('resultInfo', `${formatInt(start + (visibleCount ? 1 : 0))}–${formatInt(start + visibleCount)} از ${formatInt(total)}`);
    set('pageCount', `${formatInt(state.page)} / ${formatInt(pages)}`);
    setDisabled('first', state.page <= 1 || !total);
    setDisabled('prev', state.page <= 1 || !total);
    setDisabled('next', state.page >= pages || !total);
    setDisabled('last', state.page >= pages || !total);

    const host = $('pages');
    if (!host) return;
    if (pages <= 1) {
      host.innerHTML = '<button class="active" type="button">1</button>';
      return;
    }
    const list = new Set([1, pages, state.page, state.page - 1, state.page + 1]);
    const nums = [...list].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    let html = '';
    let last = 0;
    for (const n of nums) {
      if (last && n - last > 1) html += '<span>…</span>';
      html += `<button type="button" data-page="${n}" class="${n === state.page ? 'active' : ''}">${n}</button>`;
      last = n;
    }
    host.innerHTML = html;
  }

  function setDisabled(id, value) {
    const el = $(id);
    if (el) el.disabled = value;
  }

  function goPage(page) {
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    const next = Math.max(1, Math.min(Number(page) || 1, pages));
    if (next === state.page) return;
    state.page = next;
    renderGrid();
    $('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openModal(id) {
    const movie = state.movies.find((m) => String(m.imdb_id) === String(id));
    if (!movie) {
      warn('Modal record not found', id);
      return;
    }
    state.modalId = movie.imdb_id;

    set('modalType', movie.title_type);
    set('modalTitle', movie.title || 'بدون عنوان');
    set('modalOriginal', movie.original_title || movie.title);
    set('modalUser', movie.user_rating || '—');
    set('modalIMDb', movie.imdb_rating || '—');
    set('modalMeta', movie.metascore || '—');
    set('modalPlot', movie.plot || 'برای این عنوان خلاصه‌ای ثبت نشده است.');

    const tags = $('modalTags');
    if (tags) tags.innerHTML = split(movie.genres).map((g) => `<span>${escapeHtml(g)}</span>`).join('');

    const poster = $('modalPoster');
    const fallback = $('modalFallback');
    setPoster(poster, fallback, movie);

    const details = [
      ['سال', movie.year], ['مدت', formatRuntime(movie.runtime)], ['رده سنی', movie.rated], ['انتشار', movie.release_date],
      ['ژانر', movie.genres], ['کارگردان', movie.directors], ['نویسنده', movie.writer], ['بازیگران', movie.actors],
      ['کشور', movie.country], ['زبان', movie.language], ['رأی‌ها', movie.num_votes], ['تاریخ امتیاز', movie.date_rated],
      ['جوایز', movie.awards], ['Box Office', movie.box_office], ['تولید', movie.production], ['وضعیت داده', movie.data_status],
      ['Poster', movie.poster_status || (posterSources(movie).length ? 'available' : 'unavailable')], ['Cache', movie.cache_updated_at ? formatDate(movie.cache_updated_at) : '—']
    ];
    const grid = $('modalDetails');
    if (grid) grid.innerHTML = details.map(([k, v]) => `<div class="detail-cell"><span>${escapeHtml(k)}</span><b>${escapeHtml(text(v, '—'))}</b></div>`).join('');

    const series = $('seriesDetails');
    if (series) series.innerHTML = buildSeriesContext(movie);

    const raw = $('rawData');
    if (raw) raw.textContent = JSON.stringify({ csv: movie.raw_csv, omdb: movie.raw_omdb }, null, 2);

    const link = $('modalLink');
    if (link) link.href = movie.url || `https://www.imdb.com/title/${encodeURIComponent(movie.imdb_id)}/`;

    $('modal').hidden = false;
    document.body.classList.add('modal-open');
  }

  function buildSeriesContext(movie) {
    const isSeries = movie.title_type === 'TV Series' || movie.is_episode || movie.series_id || movie.series_title;
    if (!isSeries) return '';
    const eps = state.movies.filter((m) => m.is_episode && (
      (movie.series_id && m.series_id === movie.series_id) ||
      (movie.series_title && m.series_title === movie.series_title)
    )).sort((a, b) => number(a.season_number) - number(b.season_number) || number(a.episode_number) - number(b.episode_number));
    if (!eps.length) return `<div><h4>📺 ساختار سریالی</h4><p class="muted">${escapeHtml(movie.series_title || movie.title)}</p></div>`;

    const seasons = new Map();
    eps.forEach((e) => {
      const s = number(e.season_number) || 0;
      if (!seasons.has(s)) seasons.set(s, []);
      seasons.get(s).push(e);
    });
    const seasonHtml = [...seasons.entries()].map(([s, list]) => `<div class="series-context"><strong>Season ${s || '?'}</strong><div class="episode-pills">${list.slice(0, 80).map((e) => `<span class="episode-pill">S${String(number(e.season_number)).padStart(2, '0')} E${String(number(e.episode_number)).padStart(2, '0')} • ${escapeHtml(e.episode_title || e.title)}</span>`).join('')}</div></div>`).join('');
    return `<div><h4>📺 ${escapeHtml(movie.series_title || movie.title)}</h4><p class="muted">${formatInt(seasons.size)} فصل • ${formatInt(eps.length)} قسمت</p>${seasonHtml}</div>`;
  }

  function closeModal() {
    $('modal').hidden = true;
    document.body.classList.remove('modal-open');
    state.modalId = '';
  }

  async function loadDiagnostics() {
    const results = await Promise.allSettled([
      fetchJson('../system-status.json', 10000),
      fetchJson('../omdb-key-state.json', 10000),
      fetchJson('../update-log.json', 10000)
    ]);
    state.diagnostics.system = results[0].status === 'fulfilled' ? results[0].value : null;
    state.diagnostics.keyState = results[1].status === 'fulfilled' ? results[1].value : null;
    state.diagnostics.runLog = results[2].status === 'fulfilled' ? results[2].value : null;
    renderDiagnostics();
  }

  function renderDiagnostics() {
    const system = state.diagnostics.system || {};
    const run = system.run || {};
    const counts = run.counts || {};
    const keys = Array.isArray(system.keys) ? system.keys : [];
    const summary = [
      ['Run status', system.status || '—'], ['Keys', keys.length], ['API attempts', counts.api_attempts || 0], ['OMDb success', counts.omdb_success || 0],
      ['Cache reused', counts.cache_reused || 0], ['Posters saved', counts.posters_downloaded || 0], ['Poster misses', counts.posters_missing || 0], ['Monthly due', counts.records_due_monthly_refresh || 0]
    ];
    const host = $('diagSummary');
    if (host) host.innerHTML = summary.map(([k, v]) => `<div class="diag-pill"><span>${escapeHtml(k)}</span><b>${escapeHtml(typeof v === 'number' ? formatInt(v) : String(v))}</b></div>`).join('');

    const keyHost = $('keyTable');
    if (keyHost) keyHost.innerHTML = keys.length ? keys.map((r) => {
      const cls = ['invalid', 'rate_limited', 'daily_budget_exhausted'].includes(r.status) ? 'status-error' : ['network_error', 'active_with_errors'].includes(r.status) ? 'status-warn' : 'status-ok';
      return `<div class="key-row"><span>${escapeHtml(r.label || 'key')}</span><span>${escapeHtml(r.fingerprint || '')}</span><span class="${cls}">${escapeHtml(r.status || '—')}</span><span>${formatInt(r.requests_today_total)} today • ${formatInt(r.requests_this_run)} run</span></div>`;
    }).join('') : '<div class="muted">هنوز فایل Diagnostics تولید نشده است.</div>';

    const enriched = state.movies.filter((m) => Boolean(m.raw_omdb?.imdbID || m.omdb_found)).length;
    const local = state.movies.filter((m) => Boolean(normalizeLocalPoster(m.poster_local))).length;
    const cacheRows = [
      ['Records', state.movies.length], ['OMDb enriched', enriched], ['Local posters', local], ['API attempts', counts.api_attempts || 0],
      ['Cache reused', counts.cache_reused || 0], ['Monthly refresh due', counts.records_due_monthly_refresh || 0], ['Poster attempts', counts.poster_attempts || 0], ['Poster misses', counts.posters_missing || 0]
    ];
    const cacheHost = $('cacheTable');
    if (cacheHost) cacheHost.innerHTML = cacheRows.map(([k, v]) => `<div class="kv-row"><span>${escapeHtml(k)}</span><b>${formatInt(v)}</b></div>`).join('');

    const errs = Array.isArray(system.errors) ? system.errors : [];
    set('logStatus', system.status || '—');
    const logText = { exported_at: new Date().toISOString(), status: system.status, run, keys, errors: errs };
    const logEl = $('errorLog');
    if (logEl) logEl.textContent = JSON.stringify(logText, null, 2);
  }

  function diagnosticsExport() {
    return JSON.stringify({ exported_at: new Date().toISOString(), page: location.href, dataset: { records: state.movies.length, local_posters: state.movies.filter((m) => normalizeLocalPoster(m.poster_local)).length, omdb_enriched: state.movies.filter((m) => m.raw_omdb?.imdbID || m.omdb_found).length }, diagnostics: state.diagnostics }, null, 2);
  }

  function generateCharts() {
    if (typeof Chart === 'undefined') {
      notify('Chart.js در دسترس نیست؛ بخش نمودارها فعلاً نمایش داده نمی‌شود.', 'warn');
      return;
    }
    Object.values(state.charts).forEach((c) => { try { c.destroy(); } catch {} });
    state.charts = {};
    const genres = {};
    const ratings = {};
    const years = {};
    state.movies.forEach((m) => {
      split(m.genres).forEach((g) => genres[g] = (genres[g] || 0) + 1);
      if (m.user_rating > 0) ratings[Math.round(m.user_rating)] = (ratings[Math.round(m.user_rating)] || 0) + 1;
      const y = year(m.year); if (y) years[y] = (years[y] || 0) + 1;
    });
    const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#c7cde0', font: { family: 'Manrope', size: 10 } } } }, scales: { x: { ticks: { color: '#8e96ad', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.035)' } }, y: { beginAtZero: true, ticks: { color: '#8e96ad', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.035)' } } } };
    const genreEntries = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 12);
    state.charts.genre = new Chart($('genreChart'), { type: 'bar', data: { labels: genreEntries.map((x) => x[0]), datasets: [{ label: 'Titles', data: genreEntries.map((x) => x[1]), backgroundColor: '#785CFF', borderRadius: 8 }] }, options });
    const ratingEntries = Object.entries(ratings).sort((a, b) => Number(a[0]) - Number(b[0]));
    state.charts.rating = new Chart($('ratingChart'), { type: 'bar', data: { labels: ratingEntries.map((x) => `${x[0]}⭐`), datasets: [{ label: 'Ratings', data: ratingEntries.map((x) => x[1]), backgroundColor: '#28D7FF', borderRadius: 8 }] }, options });
    const yearEntries = Object.entries(years).sort((a, b) => Number(a[0]) - Number(b[0])).slice(-18);
    state.charts.year = new Chart($('yearChart'), { type: 'line', data: { labels: yearEntries.map((x) => x[0]), datasets: [{ label: 'Titles', data: yearEntries.map((x) => x[1]), borderColor: '#FF4DA6', backgroundColor: 'rgba(255,77,166,.08)', fill: true, tension: .32, pointRadius: 2 }] }, options });
  }

  function notify(message, kind = 'ok') {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
    node.classList.add('show');
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.classList.remove('show'), 3600);
  }

  function renderEmptyAll(message) {
    const grid = $('grid'); if (grid) grid.innerHTML = `<div class="empty-grid">🎬<p>${escapeHtml(message)}</p></div>`;
    const latest = $('latestGrid'); if (latest) latest.innerHTML = '';
    const series = $('seriesGrid'); if (series) series.innerHTML = '';
  }

  function bindEvents() {
    let searchTimer = 0;
    $('search')?.addEventListener('input', (e) => {
      state.query = e.target.value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => applyFilters(), 100);
    });
    $('searchField')?.addEventListener('change', (e) => { state.field = e.target.value; applyFilters(); });
    $('type')?.addEventListener('change', (e) => { state.type = e.target.value; applyFilters(); });
    $('genre')?.addEventListener('change', (e) => { state.genre = e.target.value; applyFilters(); });
    $('year')?.addEventListener('change', (e) => { state.year = e.target.value; applyFilters(); });
    $('sort')?.addEventListener('change', (e) => { state.sort = e.target.value; applyFilters(); });
    $('reset')?.addEventListener('click', () => {
      state.query = ''; state.field = 'all'; state.type = 'all'; state.genre = 'all'; state.year = 'all'; state.sort = 'date_desc'; state.page = 1;
      ['search','searchField','type','genre','year','sort'].forEach((id) => { const el = $(id); if (!el) return; if (id === 'search') el.value = ''; else if (id === 'searchField' || id === 'type' || id === 'genre' || id === 'year') el.value = 'all'; else if (id === 'sort') el.value = 'date_desc'; });
      applyFilters();
    });

    $('pageSize')?.addEventListener('change', (e) => {
      const n = Number(e.target.value);
      if (![12, 24, 36, 48].includes(n)) return;
      state.pageSize = n; state.page = 1; savePageSize(); renderGrid();
    });
    $('first')?.addEventListener('click', () => goPage(1));
    $('prev')?.addEventListener('click', () => goPage(state.page - 1));
    $('next')?.addEventListener('click', () => goPage(state.page + 1));
    $('last')?.addEventListener('click', () => goPage(Math.ceil(state.filtered.length / state.pageSize)));
    $('pages')?.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) goPage(Number(b.dataset.page)); });

    $('grid')?.addEventListener('click', (e) => { const card = e.target.closest('.movie-card'); if (card) openModal(card.dataset.id); });
    $('grid')?.addEventListener('keydown', (e) => { const card = e.target.closest('.movie-card'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openModal(card.dataset.id); } });
    $('latestGrid')?.addEventListener('click', (e) => { const card = e.target.closest('[data-id]'); if (card) openModal(card.dataset.id); });
    $('latestGrid')?.addEventListener('keydown', (e) => { const card = e.target.closest('[data-id]'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openModal(card.dataset.id); } });
    $('seriesGrid')?.addEventListener('click', (e) => { const card = e.target.closest('[data-series]'); if (!card) return; const key = card.dataset.series; const target = state.movies.find((m) => (m.series_id || m.series_title || m.imdb_id) === key) || state.movies.find((m) => m.series_id === key || m.series_title === key); if (target) openModal(target.imdb_id); });
    $('seriesGrid')?.addEventListener('keydown', (e) => { const card = e.target.closest('[data-series]'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const key = card.dataset.series; const target = state.movies.find((m) => (m.series_id || m.series_title || m.imdb_id) === key) || state.movies.find((m) => m.series_id === key || m.series_title === key); if (target) openModal(target.imdb_id); } });

    $('closeModal')?.addEventListener('click', closeModal);
    $('modal')?.addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
    $('copyId')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.modalId); notify('IMDb ID کپی شد.'); }
      catch { notify('کپی در این مرورگر در دسترس نیست.', 'warn'); }
    });
    $('goLibrary')?.addEventListener('click', () => $('library')?.scrollIntoView({ behavior: 'smooth' }));
    $('recentToLibrary')?.addEventListener('click', () => $('library')?.scrollIntoView({ behavior: 'smooth' }));
    $('goDiagnostics')?.addEventListener('click', () => $('diagnostics')?.scrollIntoView({ behavior: 'smooth' }));
    $('openAnalytics')?.addEventListener('click', () => { const section = $('analytics'); if (!section) return; section.hidden = !section.hidden; if (!section.hidden) generateCharts(); });
    $('refreshDiagnostics')?.addEventListener('click', loadDiagnostics);
    $('copyDiagnostics')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(diagnosticsExport()); notify('گزارش Diagnostics کپی شد.'); } catch { notify('کپی گزارش ناموفق بود.', 'warn'); } });
    $('advInsightsRefresh')?.addEventListener('click', () => window.IMDBPageInsights?.refresh?.());
    $('effectToggle')?.addEventListener('click', () => document.body.classList.toggle('focus-glow'));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); $('search')?.focus(); }
    });

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.addEventListener('pointermove', (e) => {
        state.mouseX = (e.clientX / innerWidth - .5) * 2;
        state.mouseY = (e.clientY / innerHeight - .5) * 2;
        if (state.mouseRaf) return;
        state.mouseRaf = requestAnimationFrame(() => {
          document.documentElement.style.setProperty('--mx', `${state.mouseX * 14}px`);
          document.documentElement.style.setProperty('--my', `${state.mouseY * 10}px`);
          document.documentElement.style.setProperty('--mx2', `${state.mouseX * -8}px`);
          document.documentElement.style.setProperty('--my2', `${state.mouseY * -6}px`);
          state.mouseRaf = 0;
        });
      }, { passive: true });
    }

    window.addEventListener('error', (e) => error('Advanced runtime error', e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => error('Advanced promise rejection', e.reason));
  }

  if ($('pageSize')) $('pageSize').value = String(state.pageSize);
  bindEvents();
  loadData();
})();
