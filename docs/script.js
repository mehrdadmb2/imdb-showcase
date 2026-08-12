// ===== متغیرهای سراسری =====
let allMovies = [];
let filteredMovies = [];
let currentSort = 'date_rated-desc'; // پیش‌فرض: جدیدترین به قدیمی‌ترین
let currentFilters = {
    minRating: 0,
    genre: 'all',
    year: 'all',
    type: 'all'
};
let viewMode = 'all'; // 'all', 'movie', 'series'

// ===== بارگذاری داده‌ها =====
async function loadMovies() {
    try {
        const response = await fetch('movies.json');
        if (!response.ok) throw new Error('خطا در دریافت داده‌ها');
        allMovies = await response.json();

        populateFilters();
        applyFiltersAndSort();
        updateStats();
        updateFirstLast();
        updateOmdbStatus();

        document.getElementById('lastUpdate').textContent =
            `آخرین به‌روزرسانی: ${new Date().toLocaleDateString('fa-IR')} - ${new Date().toLocaleTimeString('fa-IR')}`;
        document.getElementById('loading').classList.remove('active');
    } catch (error) {
        console.error('خطا:', error);
        document.getElementById('loading').textContent = '❌ خطا در بارگذاری داده‌ها. لطفاً دوباره تلاش کنید.';
    }
}

// ===== پاپوله کردن فیلترها =====
function populateFilters() {
    const genreSet = new Set();
    const yearSet = new Set();

    allMovies.forEach(movie => {
        if (movie.genres && movie.genres !== 'N/A') {
            movie.genres.split(',').forEach(g => genreSet.add(g.trim()));
        }
        if (movie.year && movie.year !== 'N/A') {
            const year = movie.year.replace(/\D/g, '');
            if (year) yearSet.add(year);
        }
    });

    const genreSelect = document.getElementById('genreFilter');
    genreSelect.innerHTML = '<option value="all">همه</option>';
    [...genreSet].sort().forEach(g => {
        genreSelect.innerHTML += `<option value="${g}">${g}</option>`;
    });

    const yearSelect = document.getElementById('yearFilter');
    yearSelect.innerHTML = '<option value="all">همه</option>';
    [...yearSet].sort((a, b) => b - a).forEach(y => {
        yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
    });
}

// ===== اعمال فیلتر و مرتب‌سازی =====
function applyFiltersAndSort() {
    filteredMovies = allMovies.filter(movie => {
        const userRating = movie.user_rating || 0;
        if (userRating < currentFilters.minRating) return false;

        if (currentFilters.genre !== 'all') {
            if (!movie.genres || movie.genres === 'N/A') return false;
            const genres = movie.genres.split(',').map(g => g.trim());
            if (!genres.includes(currentFilters.genre)) return false;
        }

        if (currentFilters.year !== 'all') {
            const year = movie.year.replace(/\D/g, '');
            if (year !== currentFilters.year) return false;
        }

        if (currentFilters.type !== 'all') {
            if (movie.title_type !== currentFilters.type) return false;
        }

        if (viewMode === 'movie' && movie.title_type !== 'Movie') return false;
        if (viewMode === 'series' && movie.title_type !== 'TV Episode' && movie.title_type !== 'TV Series') return false;

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
        let valA = a[field] || 0;
        let valB = b[field] || 0;

        if (field === 'title') {
            valA = valA.toString().toLowerCase();
            valB = valB.toString().toLowerCase();
            return isDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
        }

        if (field === 'date_rated') {
            // تاریخ‌ها را به Date تبدیل می‌کنیم
            const dateA = new Date(valA);
            const dateB = new Date(valB);
            // اگر تاریخ نامعتبر بود، از سال استفاده کن
            if (isNaN(dateA) || isNaN(dateB)) {
                const yearA = parseInt(a.year) || 0;
                const yearB = parseInt(b.year) || 0;
                return isDesc ? yearB - yearA : yearA - yearB;
            }
            return isDesc ? dateB - dateA : dateA - dateB;
        }

        valA = parseFloat(valA) || 0;
        valB = parseFloat(valB) || 0;
        return isDesc ? valB - valA : valA - valB;
    });
}

// ===== رندر فیلم‌ها =====
function renderMovies() {
    const grid = document.getElementById('moviesGrid');

    if (filteredMovies.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-muted);">
                <span style="font-size: 48px;">🎭</span>
                <p style="font-size: 18px; margin-top: 12px;">هیچ فیلمی با این فیلترها پیدا نشد.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filteredMovies.map(movie => {
        const genres = movie.genres && movie.genres !== 'N/A' ?
            movie.genres.split(',').slice(0, 3).map(g =>
                `<span class="movie-genre-tag">${g.trim()}</span>`
            ).join('') : '';

        const posterHtml = movie.poster ?
            `<img class="movie-poster" src="${movie.poster}" alt="${movie.title}" loading="lazy" onerror="this.className='movie-poster-placeholder'; this.textContent='🎬';" />` :
            `<div class="movie-poster-placeholder">🎬</div>`;

        const typeBadge = movie.title_type === 'TV Episode' ?
            '<div class="movie-type-badge">📺 قسمت</div>' :
            movie.title_type === 'TV Series' ?
            '<div class="movie-type-badge">📺 سریال</div>' : '';

        let ratingBadge = '';
        if (movie.user_rating >= 8) ratingBadge = '🔥 عالی';
        else if (movie.user_rating >= 6) ratingBadge = '👍 خوب';
        else if (movie.user_rating > 0) ratingBadge = '😐';

        // نمایش تاریخ امتیاز در کارت
        const ratedDate = movie.date_rated ? new Date(movie.date_rated).toLocaleDateString('fa-IR') : '';

        return `
        <div class="movie-card" onclick="openModal('${movie.imdb_id}')">
            ${posterHtml}
            <div class="movie-info">
                <div class="movie-title">${movie.title}</div>
                <div class="movie-year">${movie.year || 'N/A'}</div>
                ${ratedDate ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">📅 ${ratedDate}</div>` : ''}
                <div class="movie-genres">${genres}</div>
                <div class="movie-rating">
                    <span class="user-rating">⭐ ${movie.user_rating || '?'}</span>
                    <span class="imdb-rating">IMDb: ${movie.imdb_rating || 'N/A'}</span>
                </div>
            </div>
            ${ratingBadge ? `<div class="movie-badge">${ratingBadge}</div>` : ''}
            ${typeBadge}
        </div>
    `}).join('');
}

// ===== آمار =====
function updateStats() {
    const total = allMovies.length;
    const series = allMovies.filter(m => m.title_type === 'TV Episode' || m.title_type === 'TV Series').length;
    document.getElementById('totalMovies').textContent = total;
    document.getElementById('totalSeries').textContent = series;

    let totalMinutes = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    const genreSet = new Set();

    allMovies.forEach(movie => {
        // محاسبه ساعت‌ها از runtime
        if (movie.runtime && movie.runtime !== 'N/A') {
            const mins = parseInt(movie.runtime.replace(/\D/g, ''));
            if (!isNaN(mins)) totalMinutes += mins;
        }
        if (movie.user_rating > 0) {
            ratingSum += movie.user_rating;
            ratingCount++;
        }
        if (movie.genres && movie.genres !== 'N/A') {
            movie.genres.split(',').forEach(g => genreSet.add(g.trim()));
        }
    });

    document.getElementById('totalHours').textContent = Math.round(totalMinutes / 60);
    document.getElementById('avgRating').textContent = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : '0';
    document.getElementById('totalGenres').textContent = genreSet.size;
}

// ===== اولین و آخرین فیلم =====
function updateFirstLast() {
    const sorted = [...allMovies]
        .filter(m => m.date_rated)
        .sort((a, b) => new Date(a.date_rated) - new Date(b.date_rated));

    if (sorted.length) {
        document.getElementById('firstTitle').textContent = sorted[0].title;
        document.getElementById('firstDate').textContent = sorted[0].date_rated;
        document.getElementById('lastTitle').textContent = sorted[sorted.length - 1].title;
        document.getElementById('lastDate').textContent = sorted[sorted.length - 1].date_rated;
    }
}

// ===== وضعیت OMDb =====
function updateOmdbStatus() {
    const withPoster = allMovies.filter(m => m.poster).length;
    const total = allMovies.length;
    document.getElementById('omdbStatus').textContent =
        `وضعیت OMDb: ${withPoster} پوستر از ${total} فیلم دریافت شد.`;
}

// ===== مودال =====
function openModal(imdbId) {
    const movie = allMovies.find(m => m.imdb_id === imdbId);
    if (!movie) return;

    const overlay = document.getElementById('modalOverlay');

    document.getElementById('modalPoster').src = movie.poster || '';
    document.getElementById('modalPoster').style.display = movie.poster ? 'block' : 'none';

    document.getElementById('modalTitle').textContent = movie.title;
    document.getElementById('modalYear').textContent = movie.year || 'N/A';
    document.getElementById('modalUserRating').textContent = movie.user_rating || '—';
    document.getElementById('modalImdbRating').textContent = movie.imdb_rating || 'N/A';
    document.getElementById('modalRuntime').textContent = movie.runtime || 'N/A';
    document.getElementById('modalRated').textContent = movie.rated || 'N/A';
    document.getElementById('modalType').textContent = movie.title_type || 'N/A';

    document.getElementById('modalPlot').textContent =
        movie.plot && movie.plot !== 'N/A' ? movie.plot : '📝 اطلاعاتی در دسترس نیست.';

    document.getElementById('modalGenre').textContent = movie.genres || 'N/A';
    document.getElementById('modalDirector').textContent = movie.directors || 'N/A';
    document.getElementById('modalActors').textContent = movie.actors || 'N/A';
    document.getElementById('modalWriter').textContent = movie.writer || 'N/A';
    document.getElementById('modalReleased').textContent = movie.release_date || 'N/A';
    document.getElementById('modalVotes').textContent = movie.num_votes || 'N/A';
    document.getElementById('modalDateRated').textContent = movie.date_rated || 'N/A';

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    document.body.style.overflow = '';
}

// ===== رویدادها =====
document.getElementById('filterBtn').addEventListener('click', () => {
    document.getElementById('filtersBar').classList.toggle('active');
});

document.getElementById('minRating').addEventListener('input', (e) => {
    currentFilters.minRating = parseFloat(e.target.value);
    document.getElementById('minRatingValue').textContent = currentFilters.minRating;
    applyFiltersAndSort();
});

document.getElementById('genreFilter').addEventListener('change', (e) => {
    currentFilters.genre = e.target.value;
    applyFiltersAndSort();
});

document.getElementById('yearFilter').addEventListener('change', (e) => {
    currentFilters.year = e.target.value;
    applyFiltersAndSort();
});

document.getElementById('typeFilter').addEventListener('change', (e) => {
    currentFilters.type = e.target.value;
    applyFiltersAndSort();
});

document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('minRating').value = 0;
    document.getElementById('minRatingValue').textContent = '0';
    document.getElementById('genreFilter').value = 'all';
    document.getElementById('yearFilter').value = 'all';
    document.getElementById('typeFilter').value = 'all';
    currentFilters = { minRating: 0, genre: 'all', year: 'all', type: 'all' };
    applyFiltersAndSort();
});

document.getElementById('sortBtn').addEventListener('click', () => {
    const options = [
        { value: 'date_rated-desc', label: '📅 تاریخ (جدید به قدیم)' },
        { value: 'date_rated-asc', label: '📅 تاریخ (قدیم به جدید)' },
        { value: 'user_rating-desc', label: '⭐ امتیاز من (بالا به پایین)' },
        { value: 'user_rating-asc', label: '⭐ امتیاز من (پایین به بالا)' },
        { value: 'imdb_rating-desc', label: '⭐ IMDb (بالا به پایین)' },
        { value: 'title-asc', label: '🔤 عنوان (الفبا)' },
        { value: 'year-desc', label: '📅 سال (جدید به قدیم)' },
    ];

    const choice = prompt('نوع مرتب‌سازی را انتخاب کنید:\n' +
        options.map((o, i) => `${i + 1}. ${o.label}`).join('\n'));

    if (choice) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < options.length) {
            currentSort = options[idx].value;
            applyFiltersAndSort();
        }
    }
});

// دکمه تغییر نمایش فیلم/سریال
document.getElementById('toggleView').addEventListener('click', () => {
    const modes = ['all', 'movie', 'series'];
    const labels = ['📽️ همه', '🎬 فیلم', '📺 سریال'];
    let idx = modes.indexOf(viewMode);
    idx = (idx + 1) % modes.length;
    viewMode = modes[idx];
    document.getElementById('toggleView').textContent = labels[idx];
    applyFiltersAndSort();
});

// بستن مودال با کلیک روی پس‌زمینه
document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) {
        closeModal();
    }
});

// بستن مودال با کلید ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ===== بارگذاری اولیه =====
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loading').classList.add('active');
    loadMovies();
});
