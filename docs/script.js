(() => {
  "use strict";

  const DATA_URL = "movies.json";
  const CACHE_KEY = "imdb-showcase-cache-v5";
  const SETTINGS_KEY = "imdb-showcase-settings-v5";

  const state = {
    movies: [],
    filtered: [],
    latest: [],
    seriesGroups: [],
    currentId: null,
    currentSeriesKey: null,
    page: 1,
    pageSize: 24,
    view: "card",
    sort: "date_rated-desc",
    filters: {
      q: "",
      type: "all",
      genre: "all",
      year: "all",
      minRating: 0,
      freshness: "all",
      serial: "all"
    },
    charts: {},
    commandIndex: 0,
    searchTimer: null,
    resizeTimer: null
  };

  const $ = id => document.getElementById(id);

  const safe = (value, fallback = "—") => {
    if (value === undefined || value === null || value === "" || value === "N/A") return fallback;
    return String(value);
  };

  const num = value => {
    const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const arr = value => {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    return String(value || "").split(",").map(v => v.trim()).filter(Boolean);
  };

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

  const parseYear = value => {
    const match = String(value || "").match(/\b(?:18|19|20)\d{2}\b/);
    return match ? match[0] : "";
  };

  const parseDate = value => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const dateValue = value => parseDate(value)?.getTime() || 0;

  const localDate = value => {
    const date = parseDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  };

  const formatNumber = value => Number(value || 0).toLocaleString("fa-IR");

  function runtimeMinutes(value) {
    if (typeof value === "number") return Math.max(0, value);
    const text = String(value || "");
    const explicitMinutes = text.match(/(\d+(?:\.\d+)?)\s*min/i);
    if (explicitMinutes) return Math.round(Number(explicitMinutes[1]));
    const hourMinute = text.match(/(\d+)\s*h(?:\s*(\d+)\s*m)?/i);
    if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2] || 0);
    const numeric = num(text);
    return numeric > 0 ? Math.round(numeric) : 0;
  }

  function runtimeLabel(value) {
    const minutes = runtimeMinutes(value);
    if (!minutes) return safe(value);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours && mins) return `${hours} ساعت و ${mins} دقیقه`;
    if (hours) return `${hours} ساعت`;
    return `${mins} دقیقه`;
  }

  function totalRuntimeLabel(records) {
    const total = records.reduce((sum, movie) => sum + runtimeMinutes(movie.runtime), 0);
    return runtimeLabel(total);
  }

  function freshness(movie) {
    return movie.data_status || (movie.omdb_found === false ? "stale" : "fresh");
  }

  function typeLabel(movie) {
    if (movie.title_type === "Movie") return "فیلم";
    if (movie.title_type === "TV Series") return "سریال";
    if (movie.is_episode || movie.title_type === "TV Episode") return "قسمت";
    if (movie.title_type === "Short") return "کوتاه";
    return safe(movie.title_type, "عنوان");
  }

  function posterFallback(movie, compact = false) {
    const title = safe(movie.title, "Untitled");
    const initials = title
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(word => word[0] || "")
      .join("")
      .toUpperCase() || "IM";

    const palettes = [
      ["#ef4668", "#6958ff"],
      ["#00c9b7", "#3957ff"],
      ["#ff9f43", "#e83f72"],
      ["#5f7cff", "#a34cff"],
      ["#00a8ff", "#7b2cff"],
      ["#e0487e", "#2e78ff"]
    ];

    let seed = 0;
    for (const char of title) seed = (seed * 31 + char.codePointAt(0)) >>> 0;
    const palette = palettes[seed % palettes.length];
    const icon = movie.is_episode ? "EPISODE" : movie.title_type === "TV Series" ? "SERIES" : "CINEMA";
    const year = parseYear(movie.year) || "—";

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${palette[0]}"/>
            <stop offset="1" stop-color="${palette[1]}"/>
          </linearGradient>
          <radialGradient id="r" cx="20%" cy="10%" r="90%">
            <stop offset="0" stop-color="#ffffff" stop-opacity=".24"/>
            <stop offset="1" stop-color="#000000" stop-opacity=".35"/>
          </radialGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="34"/></filter>
        </defs>
        <rect width="600" height="900" fill="#0b0b15"/>
        <rect width="600" height="900" fill="url(#g)"/>
        <circle cx="80" cy="120" r="170" fill="#ffffff" opacity=".16" filter="url(#blur)"/>
        <circle cx="510" cy="690" r="200" fill="#000000" opacity=".25" filter="url(#blur)"/>
        <rect width="600" height="900" fill="url(#r)"/>
        <path d="M0 650 C160 560 260 820 600 610 L600 900 L0 900Z" fill="#05050a" opacity=".58"/>
        <text x="40" y="75" fill="#fff" opacity=".7" font-family="Arial, sans-serif" font-size="22" letter-spacing="5">${icon}</text>
        <text x="40" y="750" fill="#fff" font-family="Arial, sans-serif" font-size="90" font-weight="800">${esc(initials)}</text>
        <text x="40" y="806" fill="#fff" opacity=".88" font-family="Arial, sans-serif" font-size="25">${esc(year)}</text>
        <text x="40" y="854" fill="#fff" opacity=".65" font-family="Arial, sans-serif" font-size="18">NO POSTER AVAILABLE</text>
      </svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function posterSrc(movie) {
    return movie.poster && movie.poster !== "N/A" ? movie.poster : posterFallback(movie);
  }

  function toast(message, kind = "ok") {
    const node = document.createElement("div");
    node.className = `toast ${kind}`;
    node.textContent = message;
    $("toastStack")?.appendChild(node);
    setTimeout(() => node.remove(), 3600);
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
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (!raw) return;
      state.filters = { ...state.filters, ...(raw.filters || {}) };
      state.sort = raw.sort || state.sort;
      state.view = raw.view || state.view;
      state.pageSize = Number(raw.pageSize) || state.pageSize;
    } catch (_) {}
  }

  async function fetchJsonWithTimeout(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), timeout);

    try {
      const response = await fetch(
        `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`,
        {
          cache: "no-store",
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || !Array.isArray(data.movies)) {
        throw new Error("Invalid movies.json schema");
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeMovies(items) {
    return (Array.isArray(items) ? items : []).map((movie, index) => {
      const raw = movie.raw_csv || movie.csv_fields || {};
      return {
        ...movie,
        imdb_id: safe(movie.imdb_id, `unknown-${index}`),
        title: safe(movie.title, "بدون عنوان"),
        original_title: safe(movie.original_title, movie.title),
        year: safe(movie.year),
        user_rating: num(movie.user_rating),
        date_rated: movie.date_rated || "",
        title_type: safe(movie.title_type, "Other"),
        imdb_rating: safe(movie.imdb_rating),
        runtime: safe(movie.runtime),
        genres: safe(movie.genres, "N/A"),
        num_votes: safe(movie.num_votes),
        release_date: safe(movie.release_date),
        directors: safe(movie.directors),
        actors: safe(movie.actors),
        writer: safe(movie.writer),
        url: safe(movie.url, ""),
        poster: safe(movie.poster, ""),
        plot: safe(movie.plot),
        rated: safe(movie.rated),
        country: safe(movie.country),
        language: safe(movie.language),
        awards: safe(movie.awards),
        box_office: safe(movie.box_office),
        production: safe(movie.production),
        website: safe(movie.website, ""),
        metascore: safe(movie.metascore),
        ratings: Array.isArray(movie.ratings) ? movie.ratings : [],
        series_id: safe(movie.series_id, ""),
        series_title: safe(movie.series_title, ""),
        season_number: num(movie.season_number),
        episode_number: num(movie.episode_number),
        episode_title: safe(movie.episode_title, movie.title),
        total_seasons: num(movie.total_seasons),
        total_episodes: num(movie.total_episodes),
        is_episode: movie.is_episode === true || movie.title_type === "TV Episode",
        data_status: freshness(movie),
        data_stale_reason: safe(movie.data_stale_reason, ""),
        data_fetched_at: safe(movie.data_fetched_at, ""),
        omdb_found: movie.omdb_found !== false,
        fields_fresh: Array.isArray(movie.fields_fresh) ? movie.fields_fresh : [],
        raw_csv: raw
      };
    });
  }

  async function loadData() {
    renderSkeletons();
    const cached = loadCache();

    try {
      const data = await fetchJsonWithTimeout(DATA_URL);
      state.movies = normalizeMovies(data.movies);
      saveCache({
        last_manual_update: data.last_manual_update || "",
        data_meta: data.data_meta || {},
        movies: state.movies
      });
      updateHealth(data, "online");
      finalizeLoad(data);
      toast("داده جدید با موفقیت دریافت شد.", "ok");
    } catch (error) {
      console.warn("Live data failed:", error);

      if (cached?.payload?.movies?.length) {
        state.movies = normalizeMovies(cached.payload.movies);
        updateHealth(cached.payload, "cached");
        finalizeLoad(cached.payload);
        toast("داده زنده در دسترس نبود؛ آخرین نسخه سالم نمایش داده شد.", "warn");
      } else {
        state.movies = [];
        updateHealth(null, "error");
        showFatal("هیچ Dataset سالمی در دسترس نیست. movies.json را بررسی کن.");
        toast("بارگذاری داده‌ها شکست خورد.", "error");
      }
    }
  }

  function finalizeLoad(meta) {
    restoreSettings();
    state.page = 1;
    syncControls();
    populateFilters();
    buildSeriesCache();
    applyFilters(false);
    renderLatest();
    updateHeaderStats();
    updateFirstLast();
    generateStats();
    $("skeletonGrid").hidden = true;
    $("lastUpdate").textContent = `آخرین به‌روزرسانی: ${safe(meta?.last_manual_update, "—")}`;
    const dm = meta?.data_meta || {};
    $("omdbStatus").textContent = `OMDb: ${formatNumber(dm.omdb_success)} موفق • ${formatNumber(dm.omdb_stale)} حفظ‌شده • ${formatNumber(dm.omdb_partial)} ناقص`;
  }

  function updateHealth(meta, mode) {
    const health = $("dataHealth");
    const info = $("dataMeta");
    const card = $("dataHealthCard");
    if (!health || !info || !card) return;

    if (!meta) {
      health.textContent = "نامشخص";
      info.textContent = "فایل داده موجود نیست";
      card.style.borderColor = "rgba(255,99,99,.35)";
      return;
    }

    const dm = meta.data_meta || {};

    if (mode === "online") {
      health.textContent = "به‌روز";
      info.textContent = `${formatNumber(dm.updated_records)} رکورد پردازش شد`;
      card.style.borderColor = "rgba(77,213,139,.35)";
    } else {
      health.textContent = "نسخه ذخیره‌شده";
      info.textContent = "داده سالم قبلی حفظ شده است";
      card.style.borderColor = "rgba(255,212,90,.35)";
    }
  }

  function showFatal(text) {
    $("skeletonGrid").hidden = true;
    $("moviesGrid").innerHTML = "";
    $("emptyState").hidden = false;
    $("emptyText").textContent = text;
    $("paginationBar").hidden = true;
  }

  function populateFilters() {
    const genres = new Set();
    const years = new Set();

    for (const movie of state.movies) {
      for (const genre of arr(movie.genres)) genres.add(genre);
      const year = parseYear(movie.year);
      if (year) years.add(year);
    }

    $("genreFilter").innerHTML =
      `<option value="all">همه</option>` +
      [...genres].sort((a, b) => a.localeCompare(b)).map(
        genre => `<option value="${esc(genre)}">${esc(genre)}</option>`
      ).join("");

    $("yearFilter").innerHTML =
      `<option value="all">همه</option>` +
      [...years].sort((a, b) => Number(b) - Number(a)).map(
        year => `<option value="${year}">${year}</option>`
      ).join("");
  }

  function buildSearchBlob(movie) {
    const values = [];
    for (const [key, value] of Object.entries(movie)) {
      if (key === "ratings") continue;
      if (value && typeof value === "object") {
        if (Array.isArray(value)) values.push(value.join(" "));
        else values.push(Object.values(value).join(" "));
      } else {
        values.push(String(value ?? ""));
      }
    }
    return values.join(" ").toLowerCase();
  }

  function applyFilters(resetPage = true) {
    const f = state.filters;
    const query = f.q.trim().toLowerCase();

    if (resetPage) state.page = 1;

    state.filtered = state.movies.filter(movie => {
      if (query && !buildSearchBlob(movie).includes(query)) return false;

      if (f.type !== "all") {
        if (f.type === "Other") {
          if (["Movie", "TV Series", "TV Episode", "Short"].includes(movie.title_type)) return false;
        } else if (movie.title_type !== f.type) {
          return false;
        }
      }

      if (f.genre !== "all" && !arr(movie.genres).includes(f.genre)) return false;
      if (f.year !== "all" && parseYear(movie.year) !== f.year) return false;
      if (num(movie.user_rating) < Number(f.minRating)) return false;
      if (f.freshness !== "all" && freshness(movie) !== f.freshness) return false;
      if (f.serial === "series-only" && movie.title_type !== "TV Series") return false;
      if (f.serial === "episodes" && !movie.is_episode) return false;
      if (f.serial === "groupable" && !(movie.series_id || movie.series_title)) return false;

      return true;
    });

    sortFiltered();
    renderMovies();
    updateFilterCounter();
    updateResultsCount();
    saveSettings();
  }

  function sortFiltered() {
    const [field, direction] = state.sort.split("-");

    state.filtered.sort((a, b) => {
      if (field === "title") {
        const av = String(a.title).toLowerCase();
        const bv = String(b.title).toLowerCase();
        return direction === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }

      if (field === "date_rated") {
        const diff = dateValue(a.date_rated) - dateValue(b.date_rated);
        return direction === "asc" ? diff : -diff;
      }

      if (field === "year") {
        const diff = num(parseYear(a.year)) - num(parseYear(b.year));
        return direction === "asc" ? diff : -diff;
      }

      const av = num(a[field]);
      const bv = num(b[field]);
      return direction === "asc" ? av - bv : bv - av;
    });
  }

  function renderSkeletons() {
    $("skeletonGrid").hidden = false;
    $("skeletonGrid").innerHTML = Array.from({ length: Math.min(state.pageSize, 12) }, () => `
      <div class="skeleton">
        <div class="sk-poster"></div>
        <div class="sk-body">
          <div class="sk-line"></div>
          <div class="sk-line w70"></div>
          <div class="sk-line w45"></div>
        </div>
      </div>
    `).join("");
  }

  function cardHtml(movie) {
    const stale = freshness(movie) === "stale";
    const episode = movie.is_episode;
    const poster = posterSrc(movie);
    const isFallback = !movie.poster;

    const tags = arr(movie.genres).slice(0, 4).map(
      genre => `<span class="tag">${esc(genre)}</span>`
    ).join("");

    const episodeMeta = episode
      ? `<div class="episode-meta">
          <span class="pill">S${String(movie.season_number || 0).padStart(2, "0")}</span>
          <span class="pill">E${String(movie.episode_number || 0).padStart(2, "0")}</span>
          ${movie.series_title ? `<span class="pill series-pill">${esc(movie.series_title)}</span>` : ""}
        </div>`
      : "";

    return `
      <article
        class="movie-card ${isFallback ? "no-poster-card" : ""}"
        data-id="${esc(movie.imdb_id)}"
        tabindex="0"
        role="button"
        aria-label="جزئیات ${esc(movie.title)}"
      >
        <div class="poster-wrap">
          <img
            class="movie-poster"
            src="${esc(poster)}"
            alt="${esc(movie.title)}"
            loading="lazy"
            decoding="async"
          >

          <div class="poster-shine"></div>

          <div class="card-top">
            <span class="badge accent">${esc(typeLabel(movie))}</span>
            <span class="badge ${stale ? "stale" : "ok"}">
              ${stale ? "حفظ‌شده" : "به‌روز"}
            </span>
          </div>

          <div class="poster-bottom-glow"></div>
        </div>

        <div class="card-body">
          <div class="movie-title">${esc(movie.title)}</div>

          <div class="movie-sub">
            ${esc(movie.year)}
            ${movie.date_rated ? ` • ${esc(localDate(movie.date_rated))}` : ""}
          </div>

          ${episodeMeta}

          <div class="card-tags">${tags}</div>

          <div class="rating-line">
            <span class="rating-user">⭐ ${movie.user_rating || "—"}</span>
            <span class="rating-imdb">IMDb ${safe(movie.imdb_rating)}</span>
          </div>

          <div class="card-extra-line">
            <span>${runtimeLabel(movie.runtime)}</span>
            <span>${formatNumber(num(movie.num_votes))} votes</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderMovies() {
    const grid = $("moviesGrid");
    grid.classList.toggle("list-view", state.view === "list");

    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));

    if (state.page > pages) state.page = pages;

    const start = (state.page - 1) * state.pageSize;
    const pageItems = state.filtered.slice(start, start + state.pageSize);

    if (!pageItems.length) {
      grid.innerHTML = "";
      $("emptyState").hidden = false;
      $("paginationBar").hidden = true;
      return;
    }

    $("emptyState").hidden = true;
    $("paginationBar").hidden = false;
    grid.innerHTML = pageItems.map(cardHtml).join("");
    renderPagination();
  }

  function renderPagination() {
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    const start = total ? (state.page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(state.page * state.pageSize, total);

    $("paginationSummary").textContent = total
      ? `${formatNumber(start)} تا ${formatNumber(end)} از ${formatNumber(total)} عنوان`
      : "۰ عنوان";

    $("firstPage").disabled = state.page <= 1;
    $("prevPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= pages;
    $("lastPage").disabled = state.page >= pages;

    const container = $("pageNumbers");
    const items = [];
    const maxButtons = window.innerWidth < 600 ? 5 : 7;

    let from = Math.max(1, state.page - Math.floor(maxButtons / 2));
    let to = Math.min(pages, from + maxButtons - 1);
    from = Math.max(1, to - maxButtons + 1);

    if (from > 1) {
      items.push(`<button class="page-number" data-page="1">1</button>`);
      if (from > 2) items.push(`<span class="page-ellipsis">…</span>`);
    }

    for (let page = from; page <= to; page++) {
      items.push(`
        <button
          class="page-number ${page === state.page ? "active" : ""}"
          data-page="${page}"
        >${page.toLocaleString("fa-IR")}</button>
      `);
    }

    if (to < pages) {
      if (to < pages - 1) items.push(`<span class="page-ellipsis">…</span>`);
      items.push(`<button class="page-number" data-page="${pages}">${pages.toLocaleString("fa-IR")}</button>`);
    }

    container.innerHTML = items.join("");
  }

  function goToPage(page) {
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1, Number(page)), pages);
    renderMovies();
    window.scrollTo({ top: $("moviesGrid").getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
  }

  function renderLatest() {
    const latest = [...state.movies]
      .filter(movie => movie.date_rated)
      .sort((a, b) => dateValue(b.date_rated) - dateValue(a.date_rated))
      .slice(0, 10);

    state.latest = latest;

    $("latestRail").innerHTML = latest.length
      ? latest.map((movie, index) => `
          <article class="latest-card" data-id="${esc(movie.imdb_id)}" tabindex="0" role="button">
            <div class="latest-rank">${String(index + 1).padStart(2, "0")}</div>
            <div class="latest-poster-wrap">
              <img src="${esc(posterSrc(movie))}" alt="${esc(movie.title)}" loading="lazy">
              <div class="latest-overlay">
                <span>${esc(typeLabel(movie))}</span>
                <strong>⭐ ${movie.user_rating || "—"}</strong>
              </div>
            </div>
            <div class="latest-copy">
              <strong>${esc(movie.title)}</strong>
              <span>${esc(localDate(movie.date_rated))}</span>
              <em>${runtimeLabel(movie.runtime)}</em>
            </div>
          </article>
        `).join("")
      : `<div class="latest-empty">هنوز تاریخ تماشایی ثبت نشده است.</div>`;
  }

  function buildSeriesCache() {
    const map = new Map();

    for (const movie of state.movies) {
      const key = movie.series_id || movie.series_title || (movie.title_type === "TV Series" ? movie.imdb_id : "");
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          key,
          title: movie.series_title || movie.title,
          poster: movie.poster || "",
          series: null,
          episodes: []
        });
      }

      const group = map.get(key);
      if (!group.poster && movie.poster) group.poster = movie.poster;
      if (movie.is_episode) group.episodes.push(movie);
      else if (movie.title_type === "TV Series") group.series = movie;
    }

    state.seriesGroups = [...map.values()];
    renderSeriesHub();
  }

  function renderSeriesHub() {
    $("seriesCount").textContent = `${formatNumber(state.seriesGroups.length)} مجموعه`;
    const groups = [...state.seriesGroups]
      .sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .slice(0, 30);

    $("seriesGrid").innerHTML = groups.length
      ? groups.map(group => {
          const episodes = [...group.episodes].sort(
            (a, b) => num(a.season_number) - num(b.season_number) || num(a.episode_number) - num(b.episode_number)
          );
          const seasons = new Set(episodes.map(e => e.season_number).filter(Boolean)).size;
          const rated = episodes.filter(e => num(e.user_rating) > 0).length;
          const pct = episodes.length ? Math.round((rated / episodes.length) * 100) : 0;
          const totalRuntime = totalRuntimeLabel(episodes);
          const posterMovie = group.series || episodes[0] || { title: group.title };

          return `
            <article class="series-card" data-series="${esc(group.key)}" tabindex="0" role="button">
              <div class="series-cover">
                <img src="${esc(group.poster || posterFallback(posterMovie))}" alt="${esc(group.title)}" loading="lazy">
                <div class="series-cover-glow"></div>
              </div>
              <div class="series-card-body">
                <div class="series-card-topline">
                  <span class="badge accent">SERIES</span>
                  <span class="badge">${seasons || "—"} فصل</span>
                </div>
                <div class="series-title">${esc(group.title)}</div>
                <div class="series-meta">
                  ${formatNumber(episodes.length)} قسمت • ${esc(totalRuntime)}
                </div>
                <div class="series-badges">
                  <span class="pill">⭐ ${rated}/${episodes.length || "?"}</span>
                  <span class="pill">${pct}% امتیازدهی</span>
                </div>
                <div class="progress"><i style="width:${pct}%"></i></div>
              </div>
            </article>
          `;
        }).join("")
      : `<div style="color:var(--muted);font-size:11px;padding:12px">اطلاعات سریالی قابل گروه‌بندی پیدا نشد.</div>`;
  }

  function updateHeaderStats() {
    const movies = state.movies.filter(m => m.title_type === "Movie" || m.title_type === "Short");
    const series = state.movies.filter(m => m.title_type === "TV Series");
    const episodes = state.movies.filter(m => m.is_episode);
    const rated = state.movies.filter(m => num(m.user_rating) > 0);
    const totalMinutes = state.movies.reduce((sum, movie) => sum + runtimeMinutes(movie.runtime), 0);
    const avg = rated.length ? rated.reduce((sum, movie) => sum + movie.user_rating, 0) / rated.length : 0;
    const genres = new Set(state.movies.flatMap(movie => arr(movie.genres)));

    $("heroCount").textContent = formatNumber(state.movies.length);
    $("heroSub").textContent = `${formatNumber(state.movies.filter(m => num(m.user_rating) > 0).length)} rated titles • ${formatNumber(state.seriesGroups.length)} series`;
    const pulse = state.movies.length ? Math.round((state.movies.filter(m => freshness(m) === "fresh").length / state.movies.length) * 100) : 0;
    $("heroPulse").textContent = `${pulse}%`;
    $("heroPulseBar").style.width = `${pulse}%`;

    $("totalTitles").textContent = formatNumber(state.movies.length);
    $("totalMovies").textContent = formatNumber(movies.length);
    $("totalSeries").textContent = formatNumber(series.length);
    $("totalEpisodes").textContent = formatNumber(episodes.length);
    $("totalHours").textContent = Math.floor(totalMinutes / 60).toLocaleString("fa-IR");
    $("totalMinutes").textContent = `${totalMinutes % 60} دقیقه`;
    $("avgRating").textContent = avg.toFixed(1);
    $("genreCount").textContent = formatNumber(genres.size);
  }

  function updateFirstLast() {
    const rated = [...state.movies]
      .filter(movie => movie.date_rated)
      .sort((a, b) => dateValue(a.date_rated) - dateValue(b.date_rated));

    const first = rated[0];
    const last = rated.at(-1);

    $("firstTitle").textContent = first?.title || "—";
    $("firstDate").textContent = first ? localDate(first.date_rated) : "—";
    $("lastTitle").textContent = last?.title || "—";
    $("lastDate").textContent = last ? localDate(last.date_rated) : "—";
  }

  function updateResultsCount() {
    $("resultsCount").textContent = `${formatNumber(state.filtered.length)} نتیجه`;
    $("sortLabel").textContent = sortLabel(state.sort);
  }

  function sortLabel(value) {
    const labels = {
      "date_rated-desc": "جدیدترین",
      "date_rated-asc": "قدیمی‌ترین",
      "user_rating-desc": "بالاترین امتیاز",
      "user_rating-asc": "پایین‌ترین امتیاز",
      "imdb_rating-desc": "IMDb بالا",
      "imdb_rating-asc": "IMDb پایین",
      "title-asc": "الفبا A→Z",
      "title-desc": "الفبا Z→A",
      "year-desc": "سال جدید",
      "year-asc": "سال قدیم"
    };
    return labels[value] || value;
  }

  function updateFilterCounter() {
    const f = state.filters;
    const count = [
      f.q,
      f.type !== "all",
      f.genre !== "all",
      f.year !== "all",
      Number(f.minRating) > 0,
      f.freshness !== "all",
      f.serial !== "all"
    ].filter(Boolean).length;
    $("activeFilterCount").textContent = count;
  }

  function syncControls() {
    $("searchInput").value = state.filters.q;
    $("typeFilter").value = state.filters.type;
    $("genreFilter").value = state.filters.genre;
    $("yearFilter").value = state.filters.year;
    $("minRating").value = state.filters.minRating;
    $("minRatingValue").textContent = state.filters.minRating;
    $("freshnessFilter").value = state.filters.freshness;
    $("serialFilter").value = state.filters.serial;
    $("pageSize").value = String(state.pageSize);
    $("viewBtn").textContent = `نمایش: ${state.view === "card" ? "کارت" : "لیست"}`;
  }

  function openModal(id, forceSeries = false, seriesKey = null) {
    const movie = state.movies.find(item => item.imdb_id === id);
    if (!movie) return;

    state.currentId = id;
    state.currentSeriesKey = seriesKey;

    $("modalTitle").textContent = movie.title;
    $("modalYearLarge").textContent = safe(parseYear(movie.year), "—");
    $("modalVotesTop").textContent = formatNumber(num(movie.num_votes));
    $("modalOriginalTitle").textContent = safe(movie.original_title, "—");
    $("modalTypeBadge").textContent = typeLabel(movie).toUpperCase();
    $("detailBackdrop").style.backgroundImage = `url("${posterSrc(movie)}")`;
    $("modalUserRating").textContent = movie.user_rating || "—";
    $("modalImdbRating").textContent = safe(movie.imdb_rating);
    $("modalMetascore").textContent = safe(movie.metascore);
    $("modalPlot").textContent = safe(movie.plot, "توضیحی ثبت نشده است.");

    $("modalYear").textContent = safe(movie.year);
    $("modalRuntime").textContent = runtimeLabel(movie.runtime);
    $("modalRated").textContent = safe(movie.rated);
    $("modalReleased").textContent = safe(movie.release_date);
    $("modalGenre").textContent = safe(movie.genres);
    $("modalDirector").textContent = safe(movie.directors);
    $("modalWriter").textContent = safe(movie.writer);
    $("modalActors").textContent = safe(movie.actors);
    $("modalCountry").textContent = safe(movie.country);
    $("modalLanguage").textContent = safe(movie.language);
    $("modalVotes").textContent = safe(movie.num_votes);
    $("modalDateRated").textContent = localDate(movie.date_rated);
    $("modalAwards").textContent = safe(movie.awards);
    $("modalBoxOffice").textContent = safe(movie.box_office);
    $("modalProduction").textContent = safe(movie.production);
    $("modalDataStatus").textContent = freshness(movie) === "stale"
      ? `حفظ‌شده • ${safe(movie.data_stale_reason, "دلیل نامشخص")}`
      : freshness(movie) === "partial" ? "اطلاعات ناقص" : "به‌روز";

    const imdbHref = movie.url && movie.url.startsWith("http")
      ? movie.url
      : `https://www.imdb.com/title/${encodeURIComponent(movie.imdb_id)}/`;

    $("modalImdbLink").href = imdbHref;
    const website = movie.website && movie.website.startsWith("http") ? movie.website : "";
    $("modalWebsiteLink").hidden = !website;
    if (website) $("modalWebsiteLink").href = website;
    $("modalTags").innerHTML = [
      ...arr(movie.genres).map(g => `<span class="tag">${esc(g)}</span>`),
      `<span class="tag">${esc(typeLabel(movie))}</span>`,
      movie.year !== "—" ? `<span class="tag">${esc(movie.year)}</span>` : "",
      movie.series_title ? `<span class="tag">${esc(movie.series_title)}</span>` : ""
    ].filter(Boolean).join("");

    const img = $("modalPoster");
    const fallback = $("modalPosterFallback");
    img.src = posterSrc(movie);
    img.alt = movie.title;
    img.style.display = "block";
    fallback.style.display = "none";
    img.onerror = () => {
      img.src = posterFallback(movie);
    };

    $("modalRatingsSources").innerHTML = movie.ratings.length
      ? movie.ratings.map(rating => `
          <span class="rating-source">
            ${esc(rating.Source || "Source")}: <b>${esc(rating.Value || "—")}</b>
          </span>
        `).join("")
      : `<span class="rating-source">منبع Rating اضافی موجود نیست</span>`;

    $("modalSourceNote").textContent = freshness(movie) === "stale"
      ? `اطلاعات تکمیلی این عنوان از آخرین نسخه سالم حفظ شده است. ${safe(movie.data_stale_reason, "")}`
      : `آخرین دریافت تکمیلی: ${safe(movie.data_fetched_at, "ثبت نشده")}`;

    renderRawData(movie);
    buildSerialContext(movie, forceSeries, seriesKey);

    $("modalOverlay").hidden = false;
    document.body.classList.add("modal-open");
  }

  function renderRawData(movie) {
    const entries = [];
    const raw = movie.raw_csv && typeof movie.raw_csv === "object" ? movie.raw_csv : {};
    const merged = { ...raw };

    const friendly = {
      Const: "IMDb ID",
      "Your Rating": "امتیاز من",
      "Date Rated": "تاریخ امتیاز",
      Title: "عنوان",
      "Original Title": "عنوان اصلی",
      URL: "IMDb URL",
      "Title Type": "نوع عنوان",
      "IMDb Rating": "امتیاز IMDb",
      "Runtime (mins)": "مدت (دقیقه)",
      Year: "سال",
      Genres: "ژانرها",
      "Num Votes": "تعداد رأی",
      "Release Date": "تاریخ انتشار",
      Directors: "کارگردان"
    };

    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined || value === null || value === "") continue;
      entries.push(`
        <div class="raw-data-cell">
          <span>${esc(friendly[key] || key)}</span>
          <b>${esc(Array.isArray(value) ? value.join(", ") : value)}</b>
        </div>
      `);
    }

    $("modalRawData").innerHTML = entries.length
      ? entries.join("")
      : `<div class="source-note">فیلد خام CSV برای این رکورد ذخیره نشده است.</div>`;
  }

  function buildSerialContext(movie, forceSeries = false, seriesKey = null) {
    const episodePanel = $("episodePanel");
    const seriesPanel = $("seriesPanel");

    episodePanel.hidden = !movie.is_episode;
    seriesPanel.hidden = !(movie.title_type === "TV Series" || forceSeries || seriesKey);

    if (movie.is_episode) {
      const eps = state.movies
        .filter(item => item.is_episode && (
          movie.series_id
            ? item.series_id === movie.series_id
            : item.series_title === movie.series_title
        ))
        .sort((a, b) => num(a.season_number) - num(b.season_number) || num(a.episode_number) - num(b.episode_number));

      const index = eps.findIndex(item => item.imdb_id === movie.imdb_id);
      const previous = eps[index - 1];
      const next = eps[index + 1];

      $("episodeSeriesTitle").textContent = movie.series_title || "سریال";
      $("episodePosition").textContent = `S${movie.season_number || "?"} E${movie.episode_number || "?"}`;
      $("episodeProgressText").textContent = `${Math.max(index + 1, 0)} / ${eps.length}`;
      $("episodeProgressBar").style.width = eps.length ? `${((index + 1) / eps.length) * 100}%` : "0%";
      $("prevEpisode").disabled = !previous;
      $("nextEpisode").disabled = !next;
      $("prevEpisode").onclick = () => previous && openModal(previous.imdb_id);
      $("nextEpisode").onclick = () => next && openModal(next.imdb_id);
    }

    if (seriesPanel.hidden && $("seriesSummary")) $("seriesSummary").innerHTML = "";

    if (!seriesPanel.hidden) {
      const key = seriesKey || movie.series_id || movie.series_title || movie.imdb_id;
      const group = state.seriesGroups.find(item => item.key === key) || {
        title: movie.series_title || movie.title,
        episodes: []
      };

      const episodes = [...group.episodes].sort(
        (a, b) => num(a.season_number) - num(b.season_number) || num(a.episode_number) - num(b.episode_number)
      );

      const seasons = new Map();
      for (const episode of episodes) {
        const season = episode.season_number || 0;
        if (!seasons.has(season)) seasons.set(season, []);
        seasons.get(season).push(episode);
      }

      const rated = episodes.filter(e => num(e.user_rating) > 0).length;
      $("seriesProgressLabel").textContent = `${rated}/${episodes.length} قسمت • ${totalRuntimeLabel(episodes)}`;
      $("seriesSummary").innerHTML = `
        <div class="series-summary-card"><span>فصل‌ها</span><b>${new Set(episodes.map(e => e.season_number).filter(Boolean)).size}</b></div>
        <div class="series-summary-card"><span>قسمت‌ها</span><b>${episodes.length}</b></div>
        <div class="series-summary-card"><span>زمان کل</span><b>${esc(totalRuntimeLabel(episodes))}</b></div>
        <div class="series-summary-card"><span>میانگین امتیاز</span><b>${episodes.filter(e => e.user_rating > 0).length ? (episodes.filter(e => e.user_rating > 0).reduce((a,e)=>a+e.user_rating,0)/episodes.filter(e => e.user_rating > 0).length).toFixed(1) : "—"}</b></div>`;

      $("seasonList").innerHTML = [...seasons.entries()].map(([season, list]) => `
        <details class="season" ${season === num(movie.season_number) || !season ? "open" : ""}>
          <summary>
            <span>فصل ${season || "نامشخص"}</span>
            <span>${list.length} قسمت • ${esc(totalRuntimeLabel(list))}</span>
          </summary>
          <div class="episode-list">
            ${list.map(episode => `
              <div class="episode-item" data-episode-id="${esc(episode.imdb_id)}">
                <div class="episode-thumb">
                  <img src="${esc(posterSrc(episode))}" alt="" loading="lazy">
                </div>
                <div class="episode-item-copy">
                  <div class="episode-num">E${String(episode.episode_number || 0).padStart(2, "0")}</div>
                  <div class="episode-name">${esc(episode.episode_title || episode.title)}</div>
                  <div class="episode-score">⭐ ${episode.user_rating || "—"} • IMDb ${safe(episode.imdb_rating)} • ${runtimeLabel(episode.runtime)}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </details>
      `).join("") || `<div class="source-note">اطلاعات فصل/قسمت در Dataset موجود نیست.</div>`;
    }
  }

  function closeModal() {
    $("modalOverlay").hidden = true;
    document.body.classList.remove("modal-open");
    state.currentId = null;
    state.currentSeriesKey = null;
  }

  function generateStats() {
    if (!state.movies.length || typeof Chart === "undefined") return;

    const directors = new Set();
    const years = new Set();
    const genres = {};
    const ratings = {};
    const yearly = {};
    let top = 0;
    let stale = 0;

    for (const movie of state.movies) {
      for (const director of arr(movie.directors)) directors.add(director);
      const year = parseYear(movie.year);
      if (year) {
        years.add(year);
        yearly[year] = (yearly[year] || 0) + 1;
      }
      for (const genre of arr(movie.genres)) genres[genre] = (genres[genre] || 0) + 1;
      if (movie.user_rating > 0) {
        const rounded = Math.round(movie.user_rating);
        ratings[rounded] = (ratings[rounded] || 0) + 1;
      }
      if (movie.user_rating > top) top = movie.user_rating;
      if (freshness(movie) === "stale") stale++;
    }

    const topGenre = Object.entries(genres).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    const yearKeys = Object.keys(yearly).sort((a, b) => Number(a) - Number(b));

    $("statDirectors").textContent = formatNumber(directors.size);
    $("statYears").textContent = formatNumber(years.size);
    $("statTopRating").textContent = top || 0;
    $("statTopGenre").textContent = topGenre;
    $("statAvgPerYear").textContent = yearKeys.length ? Math.round(state.movies.length / yearKeys.length) : 0;
    $("statStale").textContent = formatNumber(stale);
    $("statRuntime").textContent = totalRuntimeLabel(state.movies);

    destroyCharts();

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 850,
        easing: "easeOutQuart"
      },
      plugins: {
        legend: {
          labels: {
            color: "#bdb9cb",
            font: { family: "Vazirmatn", size: 10 }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#8f8b9f", font: { size: 9 } },
          grid: { color: "rgba(255,255,255,.04)" }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#8f8b9f", font: { size: 9 } },
          grid: { color: "rgba(255,255,255,.04)" }
        }
      }
    };

    const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 12);
    state.charts.genre = new Chart($("genreChart"), {
      type: "bar",
      data: {
        labels: topGenres.map(item => item[0]),
        datasets: [{
          label: "تعداد",
          data: topGenres.map(item => item[1]),
          backgroundColor: "rgba(240,68,103,.72)",
          borderRadius: 8
        }]
      },
      options: chartOptions
    });

    const ratingKeys = Object.keys(ratings).sort((a, b) => Number(a) - Number(b));
    state.charts.rating = new Chart($("ratingChart"), {
      type: "bar",
      data: {
        labels: ratingKeys.map(key => `${key}⭐`),
        datasets: [{
          label: "تعداد",
          data: ratingKeys.map(key => ratings[key]),
          backgroundColor: "rgba(255,212,90,.75)",
          borderRadius: 8
        }]
      },
      options: chartOptions
    });

    const recentYears = yearKeys.slice(-15);
    state.charts.year = new Chart($("yearChart"), {
      type: "line",
      data: {
        labels: recentYears,
        datasets: [{
          label: "عنوان",
          data: recentYears.map(year => yearly[year]),
          borderColor: "#24d7d0",
          backgroundColor: "rgba(36,215,208,.08)",
          fill: true,
          tension: .35
        }]
      },
      options: chartOptions
    });

    const compare = [...state.movies]
      .filter(movie => movie.user_rating > 0 && num(movie.imdb_rating) > 0)
      .sort((a, b) => dateValue(b.date_rated) - dateValue(a.date_rated))
      .slice(0, 25);

    state.charts.compare = new Chart($("compareChart"), {
      type: "bar",
      data: {
        labels: compare.map(movie => movie.title.length > 15 ? `${movie.title.slice(0, 14)}…` : movie.title),
        datasets: [
          {
            label: "من",
            data: compare.map(movie => movie.user_rating),
            backgroundColor: "rgba(255,212,90,.75)"
          },
          {
            label: "IMDb",
            data: compare.map(movie => num(movie.imdb_rating)),
            backgroundColor: "rgba(121,103,245,.72)"
          }
        ]
      },
      options: chartOptions
    });

    const topMovies = [...state.movies]
      .sort((a, b) => b.user_rating - a.user_rating || dateValue(b.date_rated) - dateValue(a.date_rated))
      .slice(0, 12);

    $("topMoviesList").innerHTML = topMovies.map((movie, index) => `
      <div class="rank-row" data-id="${esc(movie.imdb_id)}">
        <div class="rank-number">#${index + 1}</div>
        <div>
          <div class="rank-title">${esc(movie.title)}</div>
          <div class="rank-sub">${esc(movie.year)} • ${esc(typeLabel(movie))}</div>
        </div>
        <b style="color:var(--gold)">⭐ ${movie.user_rating || "—"}</b>
      </div>
    `).join("");
  }

  function destroyCharts() {
    Object.values(state.charts).forEach(chart => {
      try { chart.destroy(); } catch (_) {}
    });
    state.charts = {};
  }

  function cycleSort() {
    const options = [
      "date_rated-desc",
      "date_rated-asc",
      "user_rating-desc",
      "user_rating-asc",
      "imdb_rating-desc",
      "title-asc",
      "year-desc"
    ];

    const index = options.indexOf(state.sort);
    state.sort = options[(index + 1) % options.length];
    applyFilters();
    toast(`مرتب‌سازی: ${sortLabel(state.sort)}`);
  }

  function resetFilters() {
    state.filters = {
      q: "",
      type: "all",
      genre: "all",
      year: "all",
      minRating: 0,
      freshness: "all",
      serial: "all"
    };
    syncControls();
    applyFilters();
    toast("فیلترها بازنشانی شدند.");
  }

  function openCommand() {
    $("commandOverlay").hidden = false;
    document.body.classList.add("command-open");
    $("commandSearch").value = "";
    renderCommands("");
    requestAnimationFrame(() => $("commandSearch").focus());
  }

  function closeCommand() {
    $("commandOverlay").hidden = true;
    document.body.classList.remove("command-open");
  }

  const commands = [
    ["جستجو", "فوکوس روی جستجو", () => $("searchInput").focus()],
    ["فیلترها", "نمایش/بستن فیلترها", () => $("filterPanel").hidden = !$("filterPanel").hidden],
    ["آمار", "نمایش/بستن آمار", () => {
      $("statsSection").hidden = !$("statsSection").hidden;
      if (!$("statsSection").hidden) generateStats();
    }],
    ["تازه‌ترین‌ها", "پرش به بخش جدیدترین عنوان‌ها", () => $("latestSection").scrollIntoView({ behavior: "smooth" })],
    ["سریال‌ها", "پرش به بخش سریال‌ها", () => $("seriesStrip").scrollIntoView({ behavior: "smooth" })],
    ["بازنشانی", "حذف همه فیلترها", resetFilters],
    ["مرتب‌سازی", "تغییر مرتب‌سازی", cycleSort]
  ];

  function renderCommands(query) {
    const q = query.trim().toLowerCase();
    const list = commands.filter(command => !q || command[0].toLowerCase().includes(q) || command[1].toLowerCase().includes(q));
    state.commandIndex = 0;

    $("commandList").innerHTML = list.map((command, index) => `
      <div class="command-item ${index === 0 ? "active" : ""}" data-index="${index}">
        <span>${esc(command[0])}</span>
        <small>${esc(command[1])}</small>
      </div>
    `).join("");

    $("commandList").onclick = event => {
      const item = event.target.closest(".command-item");
      if (!item) return;
      const command = list[Number(item.dataset.index)];
      command?.[2]();
      closeCommand();
    };
  }

  document.addEventListener("click", event => {
    const card = event.target.closest(".movie-card");
    if (card) {
      openModal(card.dataset.id);
      return;
    }

    const latest = event.target.closest(".latest-card");
    if (latest) {
      openModal(latest.dataset.id);
      return;
    }

    const series = event.target.closest(".series-card");
    if (series) {
      openSeriesModal(series.dataset.series);
      return;
    }

    const episode = event.target.closest(".episode-item");
    if (episode) {
      openModal(episode.dataset.episodeId);
      return;
    }

    const rank = event.target.closest(".rank-row");
    if (rank) {
      openModal(rank.dataset.id);
    }
  });

  function openSeriesModal(key) {
    const group = state.seriesGroups.find(item => item.key === key);
    if (!group) return;
    const target = group.series || group.episodes[0];
    if (!target) return;
    openModal(target.imdb_id, true, key);
  }

  document.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;

    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
      event.preventDefault();
      $("searchInput").focus();
    }

    if (event.key === "Escape") {
      if (!$("modalOverlay").hidden) closeModal();
      else if (!$("commandOverlay").hidden) closeCommand();
    }

    if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openCommand();
    }

    const activeCard = document.activeElement;
    if (
      activeCard?.classList?.contains("movie-card") ||
      activeCard?.classList?.contains("latest-card") ||
      activeCard?.classList?.contains("series-card")
    ) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (activeCard.classList.contains("movie-card") || activeCard.classList.contains("latest-card")) {
          openModal(activeCard.dataset.id);
        } else {
          openSeriesModal(activeCard.dataset.series);
        }
      }
    }
  });

  $("searchInput").addEventListener("input", event => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.filters.q = event.target.value;
      applyFilters();
    }, 180);
  });

  ["typeFilter", "genreFilter", "yearFilter", "freshnessFilter", "serialFilter"].forEach(id => {
    $(id).addEventListener("change", event => {
      state.filters[id.replace("Filter", "")] = event.target.value;
      applyFilters();
    });
  });

  $("minRating").addEventListener("input", event => {
    state.filters.minRating = Number(event.target.value);
    $("minRatingValue").textContent = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => applyFilters(), 80);
  });

  $("pageSize").addEventListener("change", event => {
    state.pageSize = Math.max(12, Math.min(48, Number(event.target.value) || 24));
    state.page = 1;
    renderMovies();
    saveSettings();
  });

  $("paginationBar").addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (button) goToPage(button.dataset.page);

    if (event.target.closest("#firstPage")) goToPage(1);
    if (event.target.closest("#prevPage")) goToPage(state.page - 1);
    if (event.target.closest("#nextPage")) goToPage(state.page + 1);
    if (event.target.closest("#lastPage")) goToPage(Math.ceil(state.filtered.length / state.pageSize));
  });

  $("filterBtn").onclick = () => $("filterPanel").hidden = !$("filterPanel").hidden;
  $("sortBtn").onclick = cycleSort;

  $("viewBtn").onclick = () => {
    state.view = state.view === "card" ? "list" : "card";
    $("viewBtn").textContent = `نمایش: ${state.view === "card" ? "کارت" : "لیست"}`;
    renderMovies();
    saveSettings();
  };

  $("statsBtn").onclick = () => {
    $("statsSection").hidden = !$("statsSection").hidden;
    if (!$("statsSection").hidden) generateStats();
  };

  $("themeBtn").onclick = () => {
    document.body.classList.toggle("soft-theme");
  };

  $("commandBtn").onclick = openCommand;
  $("commandOverlay").onclick = event => {
    if (event.target === $("commandOverlay")) closeCommand();
  };

  $("commandSearch").addEventListener("input", event => renderCommands(event.target.value));

  $("collapseSeries").onclick = () => {
    const grid = $("seriesGrid");
    const hidden = grid.style.display === "none";
    grid.style.display = hidden ? "grid" : "none";
  };

  $("modalClose").onclick = closeModal;
  $("modalOverlay").onclick = event => {
    if (event.target === $("modalOverlay")) closeModal();
  };

  $("emptyReset").onclick = resetFilters;

  $("modalCopyId").onclick = async () => {
    if (!state.currentId) return;
    try {
      await navigator.clipboard.writeText(state.currentId);
      toast("IMDb ID کپی شد.");
    } catch (_) {
      toast("کپی خودکار در این مرورگر در دسترس نیست.", "warn");
    }
  };

  window.addEventListener("resize", () => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => {
      renderPagination();
      Object.values(state.charts).forEach(chart => chart.resize?.());
    }, 100);
  });

  document.addEventListener("DOMContentLoaded", loadData, { once: true });
})();
