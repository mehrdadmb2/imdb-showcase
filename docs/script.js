// ===== متغیرهای سراسری =====
let allMovies = [];
let filteredMovies = [];
let currentSort = 'user_rating-desc';
let currentFilters = {
    minRating: 0,
    genre: 'all',
    year: 'all'
};

// ===== دریافت داده‌ها =====
async function loadMovies() {
    try {
        const response = await fetch('movies.json');
        if (!response.ok) throw new Error('خطا در دریافت داده‌ها');
        allMovies = await response.json();
        
        populateFilters();
        applyFiltersAndSort();
        updateStats();
        
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
        if (movie.genre && movie.genre !== 'N/A') {
            movie.genre.split(',').forEach(g => genreSet.add(g.trim()));
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
            if (!movie.genre || movie.genre === 'N/A') return false;
            const genres = movie.genre.split(',').map(g => g.trim());
            if (!genres.includes(currentFilters.genre)) return false;
        }
        
        if (currentFilters.year !== 'all') {
            const year = movie.year.replace(/\D/g, '');
            if (year !== currentFilters.year) return false;
        }
        
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
        const genres = movie.genre && movie.genre !== 'N/A' ? 
            movie.genre.split(',').slice(0, 3).map(g => 
                `<span class="movie-genre-tag">${g.trim()}</span>`
            ).join('') : '';
        
        return `
        <div class="movie-card" data-id="${movie.imdb_id}" onclick="openModal('${movie.imdb_id}')">
            ${movie.poster ? 
                `<img class="movie-poster" src="${movie.poster}" alt="${movie.title}" loading="lazy" onerror="this.src=''; this.className='movie-poster-placeholder'; this.textContent='🎬';" />` :
                `<div class="movie-poster-placeholder">🎬</div>`
            }
            <div class="movie-info">
                <div class="movie-title">${movie.title}</div>
                <div class="movie-year">${movie.year || 'N/A'}</div>
                <div class="movie-genres">${genres}</div>
                <div class="movie-rating">
                    <span class="user-rating">⭐ ${movie.user_rating || '?'}</span>
                    <span class="imdb-rating">IMDb: ${movie.imdb_rating || 'N/A'}</span>
                </div>
            </div>
            ${movie.user_rating >= 8 ? `<div class="movie-badge">🔥 عالی</div>` : ''}
            ${movie.user_rating >= 6 && movie.user_rating < 8 ? `<div class="movie-badge" style="background: linear-gradient(135deg, #f39c12, #e67e22);">👍 خوب</div>` : ''}
            ${movie.user_rating <= 4 && movie.user_rating > 0 ? `<div class="movie-badge" style="background: linear-gradient(135deg, #666, #444);">😐 ضعیف</div>` : ''}
        </div>
    `}).join('');
}

// ===== آمار =====
function updateStats() {
    const total = allMovies.length;
    document.getElementById('totalMovies').textContent = total;
    
    let totalMinutes = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    const genreSet = new Set();
    
    allMovies.forEach(movie => {
        if (movie.runtime && movie.runtime !== 'N/A') {
            const mins = parseInt(movie.runtime.replace(/\D/g, ''));
            if (!isNaN(mins)) totalMinutes += mins;
        }
        if (movie.user_rating > 0) {
            ratingSum += movie.user_rating;
            ratingCount++;
        }
        if (movie.genre && movie.genre !== 'N/A') {
            movie.genre.split(',').forEach(g => genreSet.add(g.trim()));
        }
    });
    
    document.getElementById('totalHours').textContent = Math.round(totalMinutes / 60);
    document.getElementById('avgRating').textContent = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : '0';
    document.getElementById('totalGenres').textContent = genreSet.size;
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
    document.getElementById('modalPlot').textContent = movie.plot || 'اطلاعاتی در دسترس نیست.';
    document.getElementById('modalGenre').textContent = movie.genre || 'N/A';
    document.getElementById('modalDirector').textContent = movie.director || 'N/A';
    document.getElementById('modalActors').textContent = movie.actors || 'N/A';
    document.getElementById('modalWriter').textContent = movie.writer || 'N/A';
    document.getElementById('modalReleased').textContent = movie.released || 'N/A';
    document.getElementById('modalVotes').textContent = movie.imdb_votes || 'N/A';
    
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

document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('minRating').value = 0;
    document.getElementById('minRatingValue').textContent = '0';
    document.getElementById('genreFilter').value = 'all';
    document.getElementById('yearFilter').value = 'all';
    currentFilters = { minRating: 0, genre: 'all', year: 'all' };
    applyFiltersAndSort();
});

document.getElementById('sortBtn').addEventListener('click', () => {
    const options = [
        { value: 'user_rating-desc', label: '⭐ امتیاز من (بالا به پایین)' },
        { value: 'user_rating-asc', label: '⭐ امتیاز من (پایین به بالا)' },
        { value: 'imdb_rating-desc', label: '⭐ IMDb (بالا به پایین)' },
        { value: 'title-asc', label: '🔤 عنوان (الفبا)' },
        { value: 'year-desc', label: '📅 سال (جدید به قدیم)' },
    ];
    
    const choice = prompt('نوع مرتب‌سازی را انتخاب کنید:\n' + 
        options.map((o, i) => `${i+1}. ${o.label}`).join('\n'));
    
    if (choice) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < options.length) {
            currentSort = options[idx].value;
            applyFiltersAndSort();
        }
    }
});

document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) {
        closeModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loading').classList.add('active');
    loadMovies();
});
