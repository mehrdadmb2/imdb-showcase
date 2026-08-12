// ===== متغیرهای سراسری =====
let allMovies = [];
let filteredMovies = [];
let currentSort = 'date_rated-desc';
let currentFilters = { minRating: 0, genre: 'all', year: 'all', type: 'all' };
let viewMode = 'all';
let lastManualUpdate = '';

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
            const y = m.year.replace(/\D/g, '');
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
            const y = m.year.replace(/\D/g, '');
            if (y !== currentFilters.year) return false;
        }
        if (currentFilters.type !== 'all' && m.title_type !== currentFilters.type) return false;
        if (viewMode === 'movie' && m.title_type !== 'Movie') return false;
        if (viewMode === 'series' && m.title_type !== 'TV Episode' && m.title_type !== 'TV Series') return false;
        return true;
    });
    sortMovies();
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
function renderMovies() {
    const grid = document.getElementById('moviesGrid');
    if (!grid) return;
    if (!filteredMovies.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted);">
            <span style="font-size:48px;">🎭</span><p style="margin-top:12px;">هیچ فیلمی پیدا نشد.</p></div>`;
        return;
    }
    grid.innerHTML = filteredMovies.map(m => {
        const genres = m.genres && m.genres !== 'N/A' ?
            m.genres.split(',').slice(0,3).map(g => `<span class="movie-genre-tag">${g.trim()}</span>`).join('') : '';
        const posterHtml = m.poster ?
            `<img class="movie-poster" src="${m.poster}" alt="${m.title}" loading="lazy" onerror="this.className='movie-poster-placeholder'; this.textContent='🎬';" />` :
            `<div class="movie-poster-placeholder">🎬</div>`;
        const typeBadge = m.title_type === 'TV Episode' ? '<div class="movie-type-badge">📺 قسمت</div>' :
                          m.title_type === 'TV Series' ? '<div class="movie-type-badge">📺 سریال</div>' : '';
        let ratingBadge = m.user_rating >= 8 ? '🔥 عالی' : m.user_rating >= 6 ? '👍 خوب' : m.user_rating > 0 ? '😐' : '';
        const ratedDate = m.date_rated ? new Date(m.date_rated).toLocaleDateString('fa-IR') : '';
        return `
        <div class="movie-card" onclick="openModal('${m.imdb_id}')">
            ${posterHtml}
            <div class="movie-info">
                <div class="movie-title">${m.title}</div>
                <div class="movie-year">${m.year || 'N/A'}</div>
                ${ratedDate ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">📅 ${ratedDate}</div>` : ''}
                <div class="movie-genres">${genres}</div>
                <div class="movie-rating">
                    <span class="user-rating">⭐ ${m.user_rating || '?'}</span>
                    <span class="imdb-rating">IMDb: ${m.imdb_rating || 'N/A'}</span>
                </div>
            </div>
            ${ratingBadge ? `<div class="movie-badge">${ratingBadge}</div>` : ''}
            ${typeBadge}
        </div>`;
    }).join('');
}

// ===== آمار =====
function updateStats() {
    const total = allMovies.length;
    const series = allMovies.filter(m => m.title_type === 'TV Episode' || m.title_type === 'TV Series').length;
    document.getElementById('totalMovies').textContent = total;
    document.getElementById('totalSeries').textContent = series;

    let totalMinutes = 0, sumRating = 0, countRating = 0;
    const genreSet = new Set();

    allMovies.forEach(m => {
        if (m.runtime && m.runtime !== 'N/A') {
            const mins = parseInt(m.runtime.toString().replace(/\D/g, ''));
            if (!isNaN(mins)) totalMinutes += mins;
        }
        if (m.user_rating > 0) {
            sumRating += m.user_rating;
            countRating++;
        }
        if (m.genres && m.genres !== 'N/A') {
            m.genres.split(',').forEach(g => genreSet.add(g.trim()));
        }
    });

    document.getElementById('totalHours').textContent = Math.round(totalMinutes / 60);
    document.getElementById('avgRating').textContent = countRating ? (sumRating / countRating).toFixed(1) : '0';
    document.getElementById('totalGenres').textContent = genreSet.size;
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

// ===== باز کردن مودال با تمام اطلاعات =====
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

// ===== بستن مودال =====
function closeModal() {
    const ov = document.getElementById('modalOverlay');
    if (ov) ov.classList.remove('active');
    document.body.style.overflow = '';
}

// ===== رویدادها =====
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
