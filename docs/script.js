// IMDb Showcase Classic — original UX preserved, data layer hardened, pagination added.
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

function $(id) { return document.getElementById(id); }

function safeAddEventListener(id, event, handler) {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
}

function text(value, fallback = '') {
    if (value === null || value === undefined || value === '' || value === 'N/A') return fallback;
    return String(value);
}

function num(value, fallback = 0) {
    const n = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

function yearValue(value) {
    const match = String(value ?? '').match(/(18|19|20)\d{2}/);
    return match ? match[0] : '';
}

function splitList(value) {
    return text(value).split(',').map(v => v.trim()).filter(Boolean);
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
}

function posterSource(movie) {
    if (movie?.poster_local) return movie.poster_local;
    if (movie?.poster) return movie.poster;
    return '';
}

async function loadMovies() {
    const loading = $('loading');
    loading?.classList.add('active');
    try {
        const response = await fetch(`movies.json?v=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        allMovies = Array.isArray(data) ? data : (Array.isArray(data.movies) ? data.movies : []);
        lastManualUpdate = text(data.last_manual_update);
        if ($('lastUpdate')) $('lastUpdate').textContent = `آخرین به‌روزرسانی دستی: ${lastManualUpdate || '—'}`;
        populateFilters();
        applyFiltersAndSort();
        updateStats();
        updateFirstLast();
        updateOmdbStatus();
        generateStats();
    } catch (error) {
        console.error('IMDb Showcase data load failed:', error);
        if (loading) loading.textContent = '❌ خطا در بارگذاری داده‌ها؛ اطلاعات محلی را بررسی کنید.';
    } finally {
        loading?.classList.remove('active');
    }
}

function populateFilters() {
    const genreSet = new Set();
    const yearSet = new Set();
    for (const movie of allMovies) {
        splitList(movie.genres).forEach(g => genreSet.add(g));
        const y = yearValue(movie.year);
        if (y) yearSet.add(y);
    }
    const genre = $('genreFilter');
    if (genre) genre.innerHTML = '<option value="all">همه</option>' + [...genreSet].sort((a,b) => a.localeCompare(b)).map(g => `<option value="${escapeHTML(g)}">${escapeHTML(g)}</option>`).join('');
    const year = $('yearFilter');
    if (year) year.innerHTML = '<option value="all">همه</option>' + [...yearSet].sort((a,b)=>Number(b)-Number(a)).map(y => `<option value="${y}">${y}</option>`).join('');
}

function applyFiltersAndSort(resetPage = true) {
    if (resetPage) currentPage = 1;
    filteredMovies = allMovies.filter(movie => {
        if (num(movie.user_rating) < num(currentFilters.minRating)) return false;
        if (currentFilters.genre !== 'all' && !splitList(movie.genres).includes(currentFilters.genre)) return false;
        if (currentFilters.year !== 'all' && yearValue(movie.year) !== currentFilters.year) return false;
        if (currentFilters.type !== 'all' && text(movie.title_type) !== currentFilters.type) return false;
        if (viewMode === 'movie' && text(movie.title_type) !== 'Movie') return false;
        if (viewMode === 'series' && text(movie.title_type) !== 'TV Episode' && text(movie.title_type) !== 'TV Series') return false;
        return true;
    });
    sortMovies();
    const totalPages = Math.max(1, Math.ceil(filteredMovies.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    renderMovies();
    renderPagination();
}

function sortMovies() {
    const [field, order] = currentSort.split('-');
    const desc = order === 'desc';
    filteredMovies.sort((a,b) => {
        if (field === 'title') {
            const va = text(a.title).toLowerCase(), vb = text(b.title).toLowerCase();
            return desc ? vb.localeCompare(va) : va.localeCompare(vb);
        }
        if (field === 'date_rated') {
            const da = Date.parse(text(a.date_rated)), db = Date.parse(text(b.date_rated));
            const va = Number.isFinite(da) ? da : Number(yearValue(a.year) || 0);
            const vb = Number.isFinite(db) ? db : Number(yearValue(b.year) || 0);
            return desc ? vb - va : va - vb;
        }
        const va = num(a[field]), vb = num(b[field]);
        return desc ? vb - va : va - vb;
    });
}

function renderMovies() {
    const grid = $('moviesGrid');
    if (!grid) return;
    if (!filteredMovies.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted)"><span style="font-size:48px">🎭</span><p style="margin-top:12px">هیچ فیلمی پیدا نشد.</p></div>`;
        return;
    }
    const start = (currentPage - 1) * pageSize;
    const visible = filteredMovies.slice(start, start + pageSize);
    grid.innerHTML = visible.map(movieCardHTML).join('');
}

function fallbackPosterHTML() {
    return '<div class="movie-poster-placeholder">🎬</div>';
}

function movieCardHTML(m) {
    const genres = splitList(m.genres).slice(0,3).map(g => `<span class="movie-genre-tag">${escapeHTML(g)}</span>`).join('');
    const poster = posterSource(m);
    const posterHtml = poster
        ? `<img class="movie-poster" src="${escapeHTML(poster)}" alt="${escapeHTML(text(m.title,'Poster'))}" loading="lazy" decoding="async">`
        : fallbackPosterHTML();
    const typeBadge = text(m.title_type) === 'TV Episode' ? '<div class="movie-type-badge">📺 قسمت</div>' : text(m.title_type) === 'TV Series' ? '<div class="movie-type-badge">📺 سریال</div>' : '';
    const ratingBadge = num(m.user_rating) >= 8 ? '🔥 عالی' : num(m.user_rating) >= 6 ? '👍 خوب' : num(m.user_rating) > 0 ? '😐' : '';
    const ratedDate = text(m.date_rated) ? new Date(text(m.date_rated)).toLocaleDateString('fa-IR') : '';
    return `<div class="movie-card" data-movie-id="${escapeHTML(text(m.imdb_id))}" tabindex="0" role="button" aria-label="جزئیات ${escapeHTML(text(m.title,'عنوان'))}">
        ${posterHtml}
        <div class="movie-info">
            <div class="movie-title">${escapeHTML(text(m.title,'بدون عنوان'))}</div>
            <div class="movie-year">${escapeHTML(text(m.year,'N/A'))}</div>
            ${ratedDate ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">📅 ${escapeHTML(ratedDate)}</div>` : ''}
            <div class="movie-genres">${genres}</div>
            <div class="movie-rating"><span class="user-rating">⭐ ${escapeHTML(num(m.user_rating) || '?')}</span><span class="imdb-rating">IMDb: ${escapeHTML(text(m.imdb_rating,'N/A'))}</span></div>
        </div>
        ${ratingBadge ? `<div class="movie-badge">${ratingBadge}</div>` : ''}
        ${typeBadge}
    </div>`;
}

function renderPagination() {
    const total = filteredMovies.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = total ? (currentPage - 1) * pageSize + 1 : 0;
    const end = Math.min(currentPage * pageSize, total);
    if ($('pageSummary')) $('pageSummary').textContent = `${start}–${end} از ${total}`;
    if ($('firstPage')) $('firstPage').disabled = currentPage <= 1;
    if ($('prevPage')) $('prevPage').disabled = currentPage <= 1;
    if ($('nextPage')) $('nextPage').disabled = currentPage >= totalPages;
    if ($('lastPage')) $('lastPage').disabled = currentPage >= totalPages;
    const box = $('pageNumbers');
    if (!box) return;
    const pages = paginationPages(currentPage, totalPages);
    box.innerHTML = pages.map(p => p === '…' ? '<span class="page-dots">…</span>' : `<button class="page-number ${p===currentPage?'active':''}" data-page="${p}" type="button">${p}</button>`).join('');
}

function paginationPages(current,total) {
    if (total <= 7) return Array.from({length:total},(_,i)=>i+1);
    const result = [1];
    const left = Math.max(2, current - 1);
    const right = Math.min(total - 1, current + 1);
    if (left > 2) result.push('…');
    for (let p=left;p<=right;p++) result.push(p);
    if (right < total - 1) result.push('…');
    result.push(total);
    return result;
}

function goToPage(page) {
    const totalPages = Math.max(1, Math.ceil(filteredMovies.length / pageSize));
    currentPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    renderMovies();
    renderPagination();
    $('moviesGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateStats() {
    const total = allMovies.length;
    const series = allMovies.filter(m => m.title_type === 'TV Episode' || m.title_type === 'TV Series').length;
    if ($('totalMovies')) $('totalMovies').textContent = total;
    if ($('totalSeries')) $('totalSeries').textContent = series;
    let totalMinutes = 0, sumRating = 0, countRating = 0;
    const genres = new Set();
    for (const m of allMovies) {
        const runtime = parseInt(String(m.runtime ?? '').replace(/\D/g,''),10);
        if (Number.isFinite(runtime)) totalMinutes += runtime;
        const rating = num(m.user_rating);
        if (rating > 0) { sumRating += rating; countRating++; }
        splitList(m.genres).forEach(g => genres.add(g));
    }
    if ($('totalHours')) $('totalHours').textContent = `${Math.floor(totalMinutes/60)}س ${totalMinutes%60}د`;
    if ($('avgRating')) $('avgRating').textContent = countRating ? (sumRating/countRating).toFixed(1) : '0';
    if ($('totalGenres')) $('totalGenres').textContent = genres.size;
}

function updateFirstLast() {
    const sorted = [...allMovies].filter(m => text(m.date_rated)).sort((a,b) => Date.parse(a.date_rated) - Date.parse(b.date_rated));
    if (!sorted.length) return;
    if ($('firstTitle')) $('firstTitle').textContent = text(sorted[0].title,'-');
    if ($('firstDate')) $('firstDate').textContent = text(sorted[0].date_rated,'-');
    if ($('lastTitle')) $('lastTitle').textContent = text(sorted.at(-1).title,'-');
    if ($('lastDate')) $('lastDate').textContent = text(sorted.at(-1).date_rated,'-');
}

function updateOmdbStatus() {
    const local = allMovies.filter(m => m.poster_local).length;
    const remote = allMovies.filter(m => !m.poster_local && m.poster).length;
    if ($('omdbStatus')) $('omdbStatus').textContent = `وضعیت پوستر: ${local} محلی • ${remote} خارجی • ${allMovies.length} عنوان`;
}

function generateStats() {
    if (!allMovies.length || typeof Chart === 'undefined') return;
    const directors = new Set(), years = new Set(), genreCount = {}, yearCount = {}, monthCount = {};
    let maxRating = 0;
    for (const m of allMovies) {
        splitList(m.directors).forEach(d => directors.add(d));
        const y = yearValue(m.year); if (y) { years.add(y); yearCount[y] = (yearCount[y]||0)+1; }
        const r = num(m.user_rating); if (r > maxRating) maxRating = r;
        splitList(m.genres).forEach(g => genreCount[g]=(genreCount[g]||0)+1);
        if (text(m.date_rated)) { const dt = new Date(m.date_rated); if (!Number.isNaN(dt.getTime())) monthCount[dt.getMonth()+1]=(monthCount[dt.getMonth()+1]||0)+1; }
    }
    const topGenre = Object.entries(genreCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || '-';
    if ($('statDirectors')) $('statDirectors').textContent = directors.size;
    if ($('statYears')) $('statYears').textContent = years.size;
    if ($('statTopRating')) $('statTopRating').textContent = maxRating || 0;
    if ($('statTotalEpisodes')) $('statTotalEpisodes').textContent = allMovies.filter(m=>m.title_type==='TV Episode').length;
    if ($('statTopGenre')) $('statTopGenre').textContent = topGenre;
    if ($('statAvgPerYear')) $('statAvgPerYear').textContent = Object.keys(yearCount).length ? Math.round(allMovies.length/Object.keys(yearCount).length) : 0;
    const sortedGenres = Object.entries(genreCount).sort((a,b)=>b[1]-a[1]).slice(0,12);
    createChart('genreChart','bar',sortedGenres.map(x=>x[0]),sortedGenres.map(x=>x[1]),['#e94560','#6c5ce7','#00d2d3','#fdcb6e']);
    const ratingDist = {}; allMovies.forEach(m => { const r=Math.round(num(m.user_rating)); if(r) ratingDist[r]=(ratingDist[r]||0)+1; });
    const ratingLabels=Object.keys(ratingDist).sort((a,b)=>a-b); createChart('ratingChart','bar',ratingLabels.map(r=>`${r}⭐`),ratingLabels.map(r=>ratingDist[r]),['#ffd700','#fdcb6e','#f0932b','#e94560']);
    const yearsSorted=Object.entries(yearCount).sort((a,b)=>Number(a[0])-Number(b[0])).slice(-15); createChart('yearChart','line',yearsSorted.map(x=>x[0]),yearsSorted.map(x=>x[1]),['#00d2d3']);
    const monthNames=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند']; createChart('monthChart','bar',monthNames,Array.from({length:12},(_,i)=>monthCount[i+1]||0),['#6c5ce7','#00d2d3','#e94560']);
    const compare=allMovies.filter(m=>num(m.user_rating)>0&&num(m.imdb_rating)>0).slice(-30); createCompareChart(compare);
    const top=allMovies.filter(m=>num(m.user_rating)===10).sort((a,b)=>Date.parse(b.date_rated||0)-Date.parse(a.date_rated||0)).slice(0,20);
    const list=$('topMoviesList'); if(list) list.innerHTML=top.length?top.map((m,i)=>`<div class="top-movie-item" data-movie-id="${escapeHTML(m.imdb_id)}"><div class="top-movie-rank">#${i+1}</div><div class="top-movie-info"><div class="title">${escapeHTML(text(m.title))}</div><div class="year">${escapeHTML(text(m.year,'N/A'))} • ${escapeHTML(splitList(m.genres).slice(0,2).join(', '))}</div></div><div class="top-movie-rating">⭐ ${num(m.user_rating)}</div></div>`).join(''):'<p style="color:var(--text-muted);text-align:center">هیچ عنوانی با امتیاز ۱۰ وجود ندارد.</p>';
}

function createChart(id,type,labels,data,colors) {
    const canvas=$(id); if(!canvas) return;
    charts[id]?.destroy?.();
    charts[id]=new Chart(canvas,{type,data:{labels,datasets:[{label:'تعداد',data,backgroundColor:colors,borderColor:colors,borderWidth:1,borderRadius:4,tension:.3,fill:type==='line'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#a0a0b0',font:{family:'Vazirmatn'}}}},scales:{y:{beginAtZero:true,ticks:{color:'#a0a0b0'},grid:{color:'rgba(255,255,255,.05)'}},x:{ticks:{color:'#a0a0b0',maxRotation:45},grid:{color:'rgba(255,255,255,.05)'}}}}});
}
function createCompareChart(items){
    const canvas=$('compareChart'); if(!canvas) return;
    charts.compareChart?.destroy?.();
    charts.compareChart=new Chart(canvas,{type:'bar',data:{labels:items.map(m=>text(m.title).slice(0,18)),datasets:[{label:'امتیاز من',data:items.map(m=>num(m.user_rating)),backgroundColor:'#ffd700'},{label:'IMDb',data:items.map(m=>num(m.imdb_rating)),backgroundColor:'#e94560'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,max:10,ticks:{color:'#a0a0b0'},grid:{color:'rgba(255,255,255,.05)'}},x:{ticks:{color:'#a0a0b0',maxRotation:60}}}}});
}

function openModal(id) {
    const movie = allMovies.find(m => text(m.imdb_id) === text(id));
    const overlay=$('modalOverlay');
    if(!movie || !overlay) return;
    const poster=$('modalPoster');
    const src=posterSource(movie);
    if(src){ poster.src=src; poster.style.display='block'; }
    else { poster.removeAttribute('src'); poster.style.display='none'; }
    if(poster){ poster.onerror=()=>{poster.onerror=null; const fallback=document.createElement('div'); fallback.className='movie-poster-placeholder'; fallback.textContent='🎬'; poster.replaceWith(fallback);}; }
    const set=(id,value,fallback='N/A')=>{if($(id)) $(id).textContent=text(value,fallback);};
    set('modalTitle',movie.title,'بدون عنوان');
    set('modalYear',movie.year); set('modalUserRating',num(movie.user_rating)||'—'); set('modalImdbRating',movie.imdb_rating); set('modalRuntime',movie.runtime); set('modalRated',movie.rated); set('modalType',movie.title_type); set('modalPlot',movie.plot,'📝 اطلاعاتی در دسترس نیست.'); set('modalGenre',movie.genres); set('modalDirector',movie.directors); set('modalActors',movie.actors); set('modalWriter',movie.writer); set('modalReleased',movie.release_date); set('modalVotes',movie.num_votes); set('modalDateRated',movie.date_rated); set('modalOriginalTitle',movie.original_title || movie.title);
    const link=$('modalImdbLink'); if(link){link.href=movie.url || `https://www.imdb.com/title/${encodeURIComponent(movie.imdb_id)}/`; link.textContent='مشاهده در IMDb';}
    overlay.classList.add('active'); document.body.style.overflow='hidden';
}
function closeModal(){const overlay=$('modalOverlay'); if(overlay) overlay.classList.remove('active'); document.body.style.overflow='';}

safeAddEventListener('statsBtn','click',()=>{const section=$('statsSection'); if(!section)return; statsVisible=!statsVisible; section.style.display=statsVisible?'block':'none'; $('statsBtn').textContent=statsVisible?'❌ بستن آمار':'📈 آمار'; if(statsVisible&&Object.keys(charts).length===0)setTimeout(generateStats,50);});
safeAddEventListener('filterBtn','click',()=>$('filtersBar')?.classList.toggle('active'));
safeAddEventListener('minRating','input',e=>{currentFilters.minRating=num(e.target.value); $('minRatingValue').textContent=currentFilters.minRating; applyFiltersAndSort();});
safeAddEventListener('genreFilter','change',e=>{currentFilters.genre=e.target.value;applyFiltersAndSort();});
safeAddEventListener('yearFilter','change',e=>{currentFilters.year=e.target.value;applyFiltersAndSort();});
safeAddEventListener('typeFilter','change',e=>{currentFilters.type=e.target.value;applyFiltersAndSort();});
safeAddEventListener('resetFilters','click',()=>{currentFilters={minRating:0,genre:'all',year:'all',type:'all'}; if($('minRating'))$('minRating').value=0;if($('minRatingValue'))$('minRatingValue').textContent='0';if($('genreFilter'))$('genreFilter').value='all';if($('yearFilter'))$('yearFilter').value='all';if($('typeFilter'))$('typeFilter').value='all';applyFiltersAndSort();});
safeAddEventListener('sortBtn','click',()=>{const opts=['date_rated-desc','date_rated-asc','user_rating-desc','user_rating-asc','imdb_rating-desc','title-asc','year-desc'];const labels=['📅 تاریخ (جدید به قدیم)','📅 تاریخ (قدیم به جدید)','⭐ امتیاز من (بالا به پایین)','⭐ امتیاز من (پایین به بالا)','⭐ IMDb (بالا به پایین)','🔤 عنوان (الفبا)','📅 سال (جدید به قدیم)'];const choice=prompt('مرتب‌سازی:\n'+labels.map((x,i)=>`${i+1}. ${x}`).join('\n'));if(choice){const idx=Number.parseInt(choice,10)-1;if(idx>=0&&idx<opts.length){currentSort=opts[idx];applyFiltersAndSort();}}});
safeAddEventListener('toggleView','click',()=>{const modes=['all','movie','series'];const labels=['📽️ همه','🎬 فیلم','📺 سریال'];viewMode=modes[(modes.indexOf(viewMode)+1)%modes.length];$('toggleView').textContent=labels[modes.indexOf(viewMode)];applyFiltersAndSort();});
safeAddEventListener('pageSize','change',e=>{pageSize=Math.max(1,num(e.target.value)||24);currentPage=1;renderMovies();renderPagination();});
safeAddEventListener('firstPage','click',()=>goToPage(1)); safeAddEventListener('prevPage','click',()=>goToPage(currentPage-1)); safeAddEventListener('nextPage','click',()=>goToPage(currentPage+1)); safeAddEventListener('lastPage','click',()=>goToPage(Math.ceil(filteredMovies.length/pageSize)||1));
safeAddEventListener('pageNumbers','click',e=>{const btn=e.target.closest('[data-page]');if(btn)goToPage(btn.dataset.page);});
$('moviesGrid')?.addEventListener('click',e=>{const card=e.target.closest('.movie-card');if(card)openModal(card.dataset.movieId);});
$('moviesGrid')?.addEventListener('keydown',e=>{const card=e.target.closest('.movie-card');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openModal(card.dataset.movieId);}});
$('topMoviesList')?.addEventListener('click',e=>{const item=e.target.closest('[data-movie-id]');if(item)openModal(item.dataset.movieId);});
$('modalOverlay')?.addEventListener('click',e=>{if(e.target===$('modalOverlay'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

document.addEventListener('DOMContentLoaded',()=>loadMovies());
