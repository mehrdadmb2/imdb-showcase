"use strict";

let allMovies = [];
let filteredMovies = [];
let currentSort = "date_rated-desc";
let currentFilters = { minRating: 0, genre: "all", year: "all", type: "all" };
let viewMode = "all";
let currentPage = 1;
let pageSize = 24;
let statsVisible = false;
let charts = {};
let searchText = "";

const PROFILE_URL = "https://www.imdb.com/user/p.if6bmsibrbg5dapfqbjrld4lhy?ref_=ext_shr_lnk";

const $ = (id) => document.getElementById(id);

function safeText(value, fallback = "N/A") {
    if (value === undefined || value === null) return fallback;
    const s = String(value).trim();
    return !s || s.toUpperCase() === "N/A" ? fallback : s;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

function normalizeDigits(value) {
    return String(value ?? "")
        .replace(/[۰-۹]/g, c => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
        .replace(/[٠-٩]/g, c => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
}

function parseNumber(value) {
    const n = Number.parseFloat(normalizeDigits(String(value ?? "")).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
}

function yearOf(movie) {
    const match = normalizeDigits(movie?.year ?? "").match(/\b(?:18|19|20)\d{2}\b/);
    return match ? match[0] : "";
}

function dateValue(value) {
    const parsed = Date.parse(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
    if (!value) return "N/A";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-GB");
}

function runtimeMinutes(value) {
    if (typeof value === "number") return value;
    const m = String(value ?? "").match(/\d+/);
    return m ? Number(m[0]) : 0;
}

function formatRuntime(value) {
    const minutes = runtimeMinutes(value);
    if (!minutes) return "N/A";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (!h) return `${m} min`;
    return m ? `${h}h ${m}m` : `${h}h`;
}

function localPoster(movie) {
    if (movie?.poster_local) return movie.poster_local;
    if (movie?.poster && /^https?:\/\//i.test(movie.poster)) return movie.poster;
    return "";
}

function posterFallback(movie) {
    const title = safeText(movie?.title, "Unknown Title").slice(0, 34);
    const type = movie?.title_type === "TV Series" ? "SERIES" : movie?.title_type === "TV Episode" ? "EPISODE" : "MOVIE";
    const year = yearOf(movie) || "—";
    const seed = [...String(movie?.imdb_id || movie?.title || "x")].reduce((a, c) => a + c.charCodeAt(0), 0);
    const palette = ["#e94560", "#6c5ce7", "#00d2d3", "#ffb347", "#7f5af0", "#2cb67d"];
    const c1 = palette[seed % palette.length];
    const c2 = palette[(seed * 3) % palette.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="35"/></filter></defs><rect width="600" height="900" fill="#080812"/><circle cx="90" cy="130" r="180" fill="${c1}" opacity=".5" filter="url(#b)"/><circle cx="530" cy="730" r="210" fill="${c2}" opacity=".4" filter="url(#b)"/><rect x="34" y="34" width="532" height="832" rx="42" fill="url(#g)" opacity=".16" stroke="white" stroke-opacity=".16"/><text x="300" y="118" fill="white" font-size="26" font-family="Arial" text-anchor="middle" letter-spacing="5">IMDB SHOWCASE</text><text x="300" y="185" fill="white" opacity=".7" font-size="18" font-family="Arial" text-anchor="middle" letter-spacing="3">${type}</text><text x="300" y="430" fill="white" font-size="40" font-family="Arial" font-weight="700" text-anchor="middle">${escapeHtml(title)}</text><text x="300" y="490" fill="white" opacity=".75" font-size="24" font-family="Arial" text-anchor="middle">${escapeHtml(year)}</text><text x="300" y="798" fill="white" opacity=".6" font-size="18" font-family="Arial" text-anchor="middle">POSTER UNAVAILABLE</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function imageHtml(movie, className = "movie-poster") {
    const local = String(movie?.poster_local || "").trim();
    const remote = String(movie?.poster || "").trim();
    const initial = local || (/^https?:\/\//i.test(remote) ? remote : "");
    const fallback = posterFallback(movie);
    const remoteAttr = /^https?:\/\//i.test(remote) ? escapeHtml(remote) : "";
    return `<img class="${className}" src="${escapeHtml(initial || fallback)}" data-remote="${remoteAttr}" data-fallback="${escapeHtml(fallback)}" alt="${escapeHtml(movie.title || "Poster")}" loading="lazy" decoding="async" onerror="this.onerror=null;const r=this.dataset.remote;const f=this.dataset.fallback;if(r&&this.src!==r){this.src=r;}else{this.src=f;}`;
}

function showLoading(message = "⏳ در حال بارگذاری...") {
    const el = $("loading");
    if (el) {
        el.textContent = message;
        el.classList.add("active");
    }
}

function hideLoading() {
    $("loading")?.classList.remove("active");
}

function loadCache() {
    try {
        const raw = localStorage.getItem("imdb-showcase-browser-cache-v4");
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveCache(data) {
    try {
        localStorage.setItem("imdb-showcase-browser-cache-v4", JSON.stringify({ savedAt: new Date().toISOString(), ...data }));
    } catch { /* storage is optional */ }
}

async function fetchData() {
    const response = await fetch(`movies.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const movies = Array.isArray(payload) ? payload : payload.movies;
    if (!Array.isArray(movies)) throw new Error("Invalid movies.json format");
    return { movies, meta: payload };
}

async function loadMovies() {
    showLoading();
    try {
        const fresh = await fetchData();
        allMovies = normalizeMovies(fresh.movies);
        saveCache({ movies: allMovies, meta: fresh.meta });
        setDataHealth("LIVE", "Repository dataset loaded", "ok");
        updateLastUpdate(fresh.meta);
    } catch (error) {
        console.warn(error);
        const cache = loadCache();
        if (cache?.movies?.length) {
            allMovies = normalizeMovies(cache.movies);
            setDataHealth("CACHED", "Network failed — last good dataset", "warning");
            updateLastUpdate(cache.meta || {});
        } else {
            allMovies = [];
            setDataHealth("ERROR", "No dataset available", "error");
        }
    }

    buildIndex();
    populateFilters();
    applyFiltersAndSort();
    updateStats();
    updateFirstLast();
    renderRecentTitles();
    hideLoading();
}

function normalizeMovies(items) {
    return items.map((m, index) => ({
        ...m,
        imdb_id: safeText(m.imdb_id, `unknown-${index}`),
        title: safeText(m.title, "Untitled"),
        original_title: safeText(m.original_title, m.title || "Untitled"),
        user_rating: parseNumber(m.user_rating),
        imdb_rating: safeText(m.imdb_rating),
        runtime: safeText(m.runtime),
        year: safeText(m.year),
        genres: safeText(m.genres),
        title_type: safeText(m.title_type, "Other"),
        date_rated: safeText(m.date_rated, ""),
        poster_local: safeText(m.poster_local, ""),
        poster: safeText(m.poster, ""),
        plot: safeText(m.plot),
        actors: safeText(m.actors),
        writer: safeText(m.writer),
        directors: safeText(m.directors),
        raw_csv: m.raw_csv && typeof m.raw_csv === "object" ? m.raw_csv : {},
        raw_omdb: m.raw_omdb && typeof m.raw_omdb === "object" ? m.raw_omdb : {},
    }));
}

let searchIndex = new Map();
function buildIndex() {
    searchIndex.clear();
    for (const m of allMovies) {
        const text = [m.title,m.original_title,m.imdb_id,m.year,m.genres,m.directors,m.actors,m.writer,m.series_title,m.series_id].filter(Boolean).join(" ").toLocaleLowerCase();
        searchIndex.set(m.imdb_id, text);
    }
}

function populateFilters() {
    const genres = new Set();
    const years = new Set();
    for (const m of allMovies) {
        String(m.genres || "").split(",").map(x => x.trim()).filter(Boolean).forEach(x => genres.add(x));
        const y = yearOf(m); if (y) years.add(y);
    }
    const gs = $("genreFilter");
    if (gs) gs.innerHTML = `<option value="all">همه</option>` + [...genres].sort((a,b)=>a.localeCompare(b)).map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
    const ys = $("yearFilter");
    if (ys) ys.innerHTML = `<option value="all">همه</option>` + [...years].sort((a,b)=>Number(b)-Number(a)).map(y=>`<option value="${y}">${y}</option>`).join("");
}

function applyFiltersAndSort() {
    const q = searchText.trim().toLocaleLowerCase();
    filteredMovies = allMovies.filter(m => {
        if (q && !(searchIndex.get(m.imdb_id) || "").includes(q)) return false;
        if (currentFilters.minRating > 0 && m.user_rating < currentFilters.minRating) return false;
        if (currentFilters.genre !== "all" && !String(m.genres || "").split(",").map(x=>x.trim()).includes(currentFilters.genre)) return false;
        if (currentFilters.year !== "all" && yearOf(m) !== currentFilters.year) return false;
        if (currentFilters.type !== "all" && m.title_type !== currentFilters.type) return false;
        if (viewMode === "movie" && m.title_type !== "Movie") return false;
        if (viewMode === "series" && !["TV Episode","TV Series"].includes(m.title_type)) return false;
        return true;
    });
    sortMovies();
    currentPage = Math.min(currentPage, Math.max(1, Math.ceil(filteredMovies.length / pageSize)));
    renderMovies();
    renderPagination();
}

function sortMovies() {
    const [field, order] = currentSort.split("-");
    const desc = order === "desc";
    filteredMovies.sort((a,b) => {
        if (field === "title") {
            const aa = a.title.toLocaleLowerCase();
            const bb = b.title.toLocaleLowerCase();
            return desc ? bb.localeCompare(aa) : aa.localeCompare(bb);
        }
        if (field === "date_rated") {
            return desc ? dateValue(b.date_rated) - dateValue(a.date_rated) : dateValue(a.date_rated) - dateValue(b.date_rated);
        }
        if (field === "year") {
            return desc ? Number(yearOf(b) || 0) - Number(yearOf(a) || 0) : Number(yearOf(a) || 0) - Number(yearOf(b) || 0);
        }
        const aa = parseNumber(a[field]);
        const bb = parseNumber(b[field]);
        return desc ? bb - aa : aa - bb;
    });
}

function renderMovies() {
    const grid = $("moviesGrid");
    if (!grid) return;
    const start = (currentPage - 1) * pageSize;
    const visible = filteredMovies.slice(start, start + pageSize);
    if (!visible.length) {
        grid.innerHTML = `<div class="classic-empty">🎭<p>هیچ عنوانی پیدا نشد.</p></div>`;
        return;
    }

    grid.innerHTML = visible.map(m => {
        const genres = String(m.genres || "").split(",").map(g => g.trim()).filter(Boolean).slice(0,3).map(g=>`<span class="movie-genre-tag">${escapeHtml(g)}</span>`).join("");
        const date = m.date_rated ? formatDate(m.date_rated) : "";
        const badge = m.title_type === "TV Episode" ? "📺 قسمت" : m.title_type === "TV Series" ? "📺 سریال" : m.title_type === "Short" ? "🎞️ کوتاه" : "";
        const ratingBadge = m.user_rating >= 8 ? "🔥 عالی" : m.user_rating >= 6 ? "👍 خوب" : m.user_rating > 0 ? "😐" : "";
        return `<article class="movie-card" data-id="${escapeHtml(m.imdb_id)}" tabindex="0" role="button" aria-label="${escapeHtml(m.title)}">\
            <div class="classic-poster-wrap">${imageHtml(m)}${badge ? `<div class="movie-type-badge">${badge}</div>` : ""}${ratingBadge ? `<div class="movie-badge">${ratingBadge}</div>` : ""}</div>\
            <div class="movie-info">\
                <div class="movie-title">${escapeHtml(m.title)}</div>\
                <div class="movie-year">${escapeHtml(m.year || "N/A")}${date ? ` • ${escapeHtml(date)}` : ""}</div>\
                <div class="movie-genres">${genres}</div>\
                <div class="movie-rating"><span class="user-rating">⭐ ${m.user_rating || "?"}</span><span class="imdb-rating">IMDb: ${escapeHtml(m.imdb_rating)}</span></div>\
            </div>\
        </article>`;
    }).join("");
}

function renderPagination() {
    const total = filteredMovies.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    $("paginationSummary") && ($("paginationSummary").textContent = total ? `${(Math.min((currentPage-1)*pageSize+1,total)).toLocaleString("en-US")}–${Math.min(currentPage*pageSize,total).toLocaleString("en-US")} / ${total.toLocaleString("en-US")}` : "0 / 0");
    const buttons = [];
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    if (start > 1) buttons.push(`<button class="page-number" data-page="1">1</button>`);
    if (start > 2) buttons.push(`<span class="page-ellipsis">…</span>`);
    for (let p=start; p<=end; p++) buttons.push(`<button class="page-number ${p===currentPage?"active":""}" data-page="${p}">${p}</button>`);
    if (end < totalPages - 1) buttons.push(`<span class="page-ellipsis">…</span>`);
    if (end < totalPages) buttons.push(`<button class="page-number" data-page="${totalPages}">${totalPages}</button>`);
    $("pageNumbers").innerHTML = buttons.join("");
    $("firstPage").disabled = currentPage <= 1;
    $("prevPage").disabled = currentPage <= 1;
    $("nextPage").disabled = currentPage >= totalPages;
    $("lastPage").disabled = currentPage >= totalPages;
}

function updateStats() {
    const total = allMovies.length;
    const series = allMovies.filter(m => ["TV Episode","TV Series"].includes(m.title_type)).length;
    $("totalMovies").textContent = total.toLocaleString("en-US");
    $("totalSeries").textContent = series.toLocaleString("en-US");
    let mins = 0, sum = 0, rated = 0;
    const genres = new Set();
    for (const m of allMovies) {
        mins += runtimeMinutes(m.runtime);
        if (m.user_rating > 0) { sum += m.user_rating; rated++; }
        String(m.genres || "").split(",").map(g=>g.trim()).filter(Boolean).forEach(g=>genres.add(g));
    }
    const h = Math.floor(mins/60), mm = mins % 60;
    $("totalHours").textContent = h.toLocaleString("en-US");
    $("avgRating").textContent = rated ? (sum/rated).toFixed(1) : "0.0";
    $("totalGenres").textContent = genres.size.toLocaleString("en-US");
    const hoursLabel = document.querySelector("#totalHours")?.parentElement;
    if (hoursLabel) {
        const statLabel = hoursLabel.querySelector(".stat-label");
        if (statLabel) statLabel.textContent = `${h.toLocaleString("en-US")}h ${String(mm).padStart(2,"0")}m`;
    }
}

function updateFirstLast() {
    const dates = allMovies.filter(m=>m.date_rated).slice().sort((a,b)=>dateValue(a.date_rated)-dateValue(b.date_rated));
    if (!dates.length) return;
    $("firstTitle").textContent = dates[0].title;
    $("firstDate").textContent = formatDate(dates[0].date_rated);
    $("lastTitle").textContent = dates[dates.length-1].title;
    $("lastDate").textContent = formatDate(dates[dates.length-1].date_rated);
}

function renderRecentTitles() {
    const host = $("firstLast");
    if (!host || !allMovies.length) return;
    let recent = document.getElementById("classicRecent");
    if (!recent) {
        recent = document.createElement("section");
        recent.id = "classicRecent";
        recent.className = "classic-recent glass";
        host.insertAdjacentElement("afterend", recent);
    }
    const latest = allMovies.filter(m=>m.date_rated).slice().sort((a,b)=>dateValue(b.date_rated)-dateValue(a.date_rated)).slice(0,6);
    recent.innerHTML = `<div class="classic-recent-head"><div><span class="classic-kicker">RECENTLY WATCHED</span><h3>جدیدترین عنوان‌هایی که دیدم</h3></div><a href="${PROFILE_URL}" target="_blank" rel="noopener noreferrer" class="btn-glass">IMDb من ↗</a></div><div class="classic-recent-grid">${latest.map(m=>`<button class="classic-recent-card" data-id="${escapeHtml(m.imdb_id)}" type="button">${imageHtml(m,"recent-poster")}<span><b>${escapeHtml(m.title)}</b><small>${escapeHtml(formatDate(m.date_rated))} • ⭐ ${m.user_rating || "—"}</small></span></button>`).join("")}</div>`;
}

function setDataHealth(status, text, state) {
    const el = $("lastUpdate");
    if (el) el.textContent = `Dataset: ${status} • ${text}`;
    const card = $("firstLast");
    if (card) card.dataset.health = state;
}

function updateLastUpdate(meta) {
    const value = meta?.last_manual_update || meta?.data_meta?.generated_at || "—";
    const footer = document.querySelector("footer p:last-child");
    if (footer) footer.textContent = `آخرین بروزرسانی: ${value}`;
    const omdb = $("omdbStatus");
    if (omdb) omdb.textContent = `Cache: ${meta?.cache_policy?.ttl_days ?? 30} روز • Local posters first`;
}

function openModal(id) {
    const movie = allMovies.find(m => m.imdb_id === id);
    if (!movie) return;
    const ov = $("modalOverlay");
    if (!ov) return;
    const poster = $("modalPoster");
    const fallback = posterFallback(movie);
    poster.src = localPoster(movie) || fallback;
    poster.onerror = () => { poster.onerror = null; poster.src = fallback; };
    poster.style.display = "block";
    const mapping = {
        modalTitle: movie.title,
        modalYear: movie.year || "N/A",
        modalUserRating: movie.user_rating || "—",
        modalImdbRating: movie.imdb_rating,
        modalRuntime: formatRuntime(movie.runtime),
        modalRated: movie.rated,
        modalType: movie.title_type,
        modalPlot: movie.plot || "📝 اطلاعاتی در دسترس نیست.",
        modalGenre: movie.genres,
        modalDirector: movie.directors,
        modalActors: movie.actors,
        modalWriter: movie.writer,
        modalReleased: movie.release_date,
        modalVotes: movie.num_votes,
        modalDateRated: movie.date_rated || "N/A",
        modalOriginalTitle: movie.original_title || movie.title,
    };
    Object.entries(mapping).forEach(([idKey, value]) => { if ($(idKey)) $(idKey).textContent = value; });
    const link = $("modalImdbLink");
    if (link) { link.href = movie.url || `https://www.imdb.com/title/${movie.imdb_id}/`; link.textContent = "مشاهده در IMDb"; }

    // Optional extended modal fields supported by newer HTML.
    const ext = {
        modalMetascore: movie.metascore,
        modalCountry: movie.country,
        modalLanguage: movie.language,
        modalAwards: movie.awards,
        modalBoxOffice: movie.box_office,
        modalProduction: movie.production,
        modalWebsite: movie.website,
    };
    Object.entries(ext).forEach(([idKey, value]) => { if ($(idKey)) $(idKey).textContent = safeText(value); });

    let raw = $("modalRawData");
    if (raw) {
        const combined = {...(movie.raw_csv || {}), ...Object.fromEntries(Object.entries(movie.raw_omdb || {}).map(([k,v])=>[`OMDb.${k}`,v]))};
        raw.innerHTML = Object.entries(combined).map(([k,v])=>`<div class="raw-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v))}</b></div>`).join("") || "<div class=raw-empty>N/A</div>";
    }

    ov.classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeModal() {
    $("modalOverlay")?.classList.remove("active");
    document.body.style.overflow = "";
}

function showStats() {
    const section = $("statsSection");
    if (!section) return;
    statsVisible = !statsVisible;
    section.style.display = statsVisible ? "block" : "none";
    if (statsVisible) setTimeout(generateStats, 0);
}

function generateStats() {
    if (!statsVisible && !$("statsSection")) return;
    const directors = new Set();
    const years = new Set();
    const genres = {};
    const ratings = {};
    let max = 0;
    allMovies.forEach(m=>{
        String(m.directors||"").split(",").map(x=>x.trim()).filter(Boolean).forEach(x=>directors.add(x));
        const y = yearOf(m); if (y) years.add(y);
        String(m.genres||"").split(",").map(x=>x.trim()).filter(Boolean).forEach(x=>genres[x]=(genres[x]||0)+1);
        const r = Math.round(m.user_rating||0); if (r) ratings[r]=(ratings[r]||0)+1;
        if ((m.user_rating||0)>max) max=m.user_rating;
    });
    const topGenre = Object.entries(genres).sort((a,b)=>b[1]-a[1])[0]?.[0] || "—";
    if ($("statDirectors")) $("statDirectors").textContent = directors.size.toLocaleString("en-US");
    if ($("statYears")) $("statYears").textContent = years.size.toLocaleString("en-US");
    if ($("statTopRating")) $("statTopRating").textContent = max.toLocaleString("en-US");
    if ($("statTopGenre")) $("statTopGenre").textContent = topGenre;
    const minutes = allMovies.reduce((s,m)=>s+runtimeMinutes(m.runtime),0);
    if ($("statTotalEpisodes")) $("statTotalEpisodes").textContent = allMovies.filter(m=>m.title_type==="TV Episode").length.toLocaleString("en-US");
    if ($("statAvgPerYear")) $("statAvgPerYear").textContent = years.size ? Math.round(allMovies.length/years.size).toLocaleString("en-US") : "0";
    if ($("statRuntime")) $("statRuntime").textContent = formatRuntime(minutes);
    drawChart("genreChart","bar",Object.keys(genres).sort((a,b)=>genres[b]-genres[a]).slice(0,12),Object.keys(genres).sort((a,b)=>genres[b]-genres[a]).slice(0,12).map(k=>genres[k]));
    drawChart("ratingChart","bar",Object.keys(ratings).sort((a,b)=>a-b),Object.keys(ratings).sort((a,b)=>a-b).map(k=>ratings[k]));
    const yearsCount = {}; allMovies.forEach(m=>{ const y=yearOf(m); if(y) yearsCount[y]=(yearsCount[y]||0)+1; });
    const yy = Object.keys(yearsCount).sort((a,b)=>Number(a)-Number(b)).slice(-15); drawChart("yearChart","line",yy,yy.map(y=>yearsCount[y]));
    const cmp = allMovies.filter(m=>m.user_rating && parseNumber(m.imdb_rating)).slice(-20);
    drawCompare("compareChart",cmp);
    const top = allMovies.slice().sort((a,b)=>(b.user_rating||0)-(a.user_rating||0)||dateValue(b.date_rated)-dateValue(a.date_rated)).slice(0,12);
    const list=$("topMoviesList"); if(list) list.innerHTML=top.map((m,i)=>`<button class="top-movie-item" data-id="${escapeHtml(m.imdb_id)}"><b>#${i+1}</b><span>${escapeHtml(m.title)}</span><strong>⭐ ${m.user_rating||"—"}</strong></button>`).join("");
}

function drawChart(id,type,labels,data){
    const canvas=$(id); if(!canvas||typeof Chart==="undefined") return;
    charts[id]?.destroy?.();
    charts[id]=new Chart(canvas,{type,data:{labels,datasets:[{label:"Titles",data,backgroundColor:"rgba(233,69,96,.55)",borderColor:"#e94560",borderWidth:2,borderRadius:5,tension:.35}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"#b8b8c7",font:{family:"Vazirmatn"}}}},scales:{x:{ticks:{color:"#9696a5"},grid:{color:"rgba(255,255,255,.05)"}},y:{beginAtZero:true,ticks:{color:"#9696a5"},grid:{color:"rgba(255,255,255,.05)"}}}}});
}
function drawCompare(id,items){
    const canvas=$(id); if(!canvas||typeof Chart==="undefined") return;
    charts[id]?.destroy?.();
    charts[id]=new Chart(canvas,{type:"bar",data:{labels:items.map(m=>m.title.slice(0,16)),datasets:[{label:"My rating",data:items.map(m=>m.user_rating),backgroundColor:"rgba(255,215,0,.65)"},{label:"IMDb",data:items.map(m=>parseNumber(m.imdb_rating)),backgroundColor:"rgba(108,92,231,.65)"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"#b8b8c7",font:{family:"Vazirmatn"}}}},scales:{x:{ticks:{color:"#9696a5",maxRotation:45}},y:{beginAtZero:true,max:10,ticks:{color:"#9696a5"}}}}});
}

function bindEvents() {
    $("moviesGrid")?.addEventListener("click", e => { const card=e.target.closest(".movie-card"); if(card) openModal(card.dataset.id); });
    $("moviesGrid")?.addEventListener("keydown", e => { const card=e.target.closest(".movie-card"); if(card && (e.key==="Enter"||e.key===" ")){e.preventDefault();openModal(card.dataset.id);} });
    $("firstPage")?.addEventListener("click",()=>{currentPage=1;renderMovies();renderPagination();scrollToGrid();});
    $("prevPage")?.addEventListener("click",()=>{currentPage=Math.max(1,currentPage-1);renderMovies();renderPagination();scrollToGrid();});
    $("nextPage")?.addEventListener("click",()=>{currentPage=Math.min(Math.ceil(filteredMovies.length/pageSize),currentPage+1);renderMovies();renderPagination();scrollToGrid();});
    $("lastPage")?.addEventListener("click",()=>{currentPage=Math.max(1,Math.ceil(filteredMovies.length/pageSize));renderMovies();renderPagination();scrollToGrid();});
    $("pageNumbers")?.addEventListener("click",e=>{const btn=e.target.closest("[data-page]");if(btn){currentPage=Number(btn.dataset.page)||1;renderMovies();renderPagination();scrollToGrid();}});
    $("pageSize")?.addEventListener("change",e=>{pageSize=Number(e.target.value)||24;currentPage=1;applyFiltersAndSort();});
    $("filterBtn")?.addEventListener("click",()=>$("filtersBar")?.classList.toggle("active"));
    $("statsBtn")?.addEventListener("click",showStats);
    $("heroStats")?.addEventListener("click",showStats);
    $("minRating")?.addEventListener("input",e=>{currentFilters.minRating=parseNumber(e.target.value);$("minRatingValue").textContent=currentFilters.minRating;currentPage=1;applyFiltersAndSort();});
    ["genreFilter","yearFilter","typeFilter"].forEach(id=>$(id)?.addEventListener("change",e=>{currentFilters[id.replace("Filter","")]=e.target.value;currentPage=1;applyFiltersAndSort();}));
    $("resetFilters")?.addEventListener("click",()=>{currentFilters={minRating:0,genre:"all",year:"all",type:"all"};viewMode="all";searchText="";currentPage=1;$("searchInput")&&( $("searchInput").value="");$("minRating").value=0;$("minRatingValue").textContent="0";$("genreFilter").value="all";$("yearFilter").value="all";$("typeFilter").value="all";applyFiltersAndSort();});
    $("sortBtn")?.addEventListener("click",()=>{const order=["date_rated-desc","date_rated-asc","user_rating-desc","user_rating-asc","imdb_rating-desc","title-asc","year-desc"];const idx=order.indexOf(currentSort);currentSort=order[(idx+1)%order.length];currentPage=1;applyFiltersAndSort();});
    $("toggleView")?.addEventListener("click",()=>{const modes=["all","movie","series"];const labels=["📽️ همه","🎬 فیلم","📺 سریال"];viewMode=modes[(modes.indexOf(viewMode)+1)%modes.length];$("toggleView").textContent=labels[modes.indexOf(viewMode)];currentPage=1;applyFiltersAndSort();});
    $("searchInput")?.addEventListener("input",e=>{searchText=e.target.value;currentPage=1;applyFiltersAndSort();});
    $("modalOverlay")?.addEventListener("click",e=>{if(e.target===$("modalOverlay"))closeModal();});
    $("modalClose")?.addEventListener("click",closeModal);
    $("firstLast")?.addEventListener("click",e=>{const b=e.target.closest("#classicRecent [data-id]");if(b)openModal(b.dataset.id);});
    $("topMoviesList")?.addEventListener("click",e=>{const b=e.target.closest("[data-id]");if(b)openModal(b.dataset.id);});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal(); if(e.key==="/"&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||"")){e.preventDefault();$("searchInput")?.focus();}});
}

function scrollToGrid(){document.getElementById("moviesGrid")?.scrollIntoView({behavior:"smooth",block:"start"});}

document.addEventListener("DOMContentLoaded",()=>{bindEvents();loadMovies();});
