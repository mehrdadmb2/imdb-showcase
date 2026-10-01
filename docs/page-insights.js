/*
 * IMDb Showcase ↔ GitHub Page Insights v11 client
 *
 * Uses the current Page Insights API first:
 *   POST /v1/events
 *   GET  /v1/platforms/:platformId?days=N
 *
 * Legacy compatibility endpoint /collect + /api/site/:siteId is kept as a
 * fallback so an analytics deployment transition can never break the site.
 * Analytics is fail-soft by design: an outage must never stop the movie UI.
 */
(() => {
    'use strict';

    const CONFIG = Object.freeze({
        workerUrl: 'https://github-page-insights-worker.game-developer-mb.workers.dev',
        platformId: 'imdb-showcase',
        siteId: 'imdb-showcase',
        siteName: 'IMDb Showcase',
        appVersion: '15.0.0',
        sdkVersion: '11.0.0',
        refreshMs: 60000,
        heartbeatMs: 30000,
        requestTimeoutMs: 9000,
        analyticsDays: 3650
    });

    const $ = (id) => document.getElementById(id);
    const root = CONFIG.workerUrl.replace(/\/$/, '');

    const KEY_VISITOR = 'imdb-showcase-page-insights-visitor-v4';
    const KEY_SESSION = 'imdb-showcase-page-insights-session-v4';
    const KEY_CACHE = 'imdb-showcase-page-insights-cache-v2';

    let visitorId = storageId(localStorage, KEY_VISITOR, 'visitor');
    let sessionId = storageId(sessionStorage, KEY_SESSION, 'session');
    let heartbeatTimer = 0;
    let refreshTimer = 0;
    let visibleSince = Date.now();
    let maxScroll = 0;
    let sentLeave = false;
    let clickCount = 0;

    function makeId(prefix) {
        try {
            if (globalThis.crypto?.randomUUID) {
                return `${prefix}-${globalThis.crypto.randomUUID()}`;
            }
        } catch {}
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function storageId(storage, key, prefix) {
        try {
            let value = storage.getItem(key);
            if (!value) {
                value = makeId(prefix);
                storage.setItem(key, value);
            }
            return value;
        } catch {
            return makeId(prefix);
        }
    }

    function num(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function formatInt(value) {
        return num(value).toLocaleString('en-US');
    }

    function safeJson(value, fallback = null) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return fallback;
        }
    }

    function setText(id, value) {
        const node = $(id);
        if (node) node.textContent = value;
    }

    function setStatus(text, connected) {
        document
            .querySelectorAll('#insightsStatus, #advInsightsStatus')
            .forEach(node => {
                node.textContent = text;
                node.dataset.connected = connected ? 'true' : 'false';
            });
    }

    function updateStatusClass(connected) {
        document
            .querySelectorAll('#insightsStatus, #advInsightsStatus')
            .forEach(node => node.classList.toggle('is-connected', connected));
    }

    function basePage() {
        return {
            url: location.href,
            path: location.pathname,
            title: document.title,
            referrer: document.referrer || ''
        };
    }

    function buildPayload(eventType, extra = {}) {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

        return {
            platformId: CONFIG.platformId,
            platformName: CONFIG.siteName,
            platformType: 'github-pages',
            platformUrl: `${location.origin}${location.pathname}`,
            environment: location.hostname.endsWith('github.io') ? 'production' : 'preview',
            appVersion: CONFIG.appVersion,
            sdkName: 'imdb-showcase-page-insights',
            sdkVersion: CONFIG.sdkVersion,
            source: 'github-pages',
            eventType,
            eventId: makeId('evt'),
            timestamp: new Date().toISOString(),
            identity: {
                visitorId,
                sessionId
            },
            page: basePage(),
            screen: {
                width: screen.width || 0,
                height: screen.height || 0,
                pixelRatio: globalThis.devicePixelRatio || 1
            },
            viewport: {
                width: innerWidth || 0,
                height: innerHeight || 0
            },
            connection: {
                effectiveType: connection?.effectiveType || '',
                downlink: num(connection?.downlink),
                rtt: num(connection?.rtt),
                saveData: Boolean(connection?.saveData)
            },
            language: navigator.language || '',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            durationMs: Math.max(0, Date.now() - visibleSince),
            maxScroll,
            clicks: clickCount,
            outboundClicks: 0,
            metadata: safeJson(extra.metadata, {}),
            ...extra
        };
    }

    async function fetchJson(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

        try {
            const response = await fetch(url, {
                cache: 'no-store',
                credentials: 'omit',
                signal: controller.signal,
                ...options
            });

            const text = await response.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch {
                data = null;
            }

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                error.payload = data;
                throw error;
            }

            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    async function send(eventType, extra = {}, keepalive = true) {
        const payload = buildPayload(eventType, extra);
        const body = JSON.stringify(payload);

        // Current v11 API.
        const primary = `${root}/v1/events`;
        try {
            if (navigator.sendBeacon && keepalive) {
                const blob = new Blob([body], { type: 'application/json' });
                if (navigator.sendBeacon(primary, blob)) return true;
            }
        } catch {}

        try {
            const response = await fetch(primary, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                keepalive,
                mode: 'cors',
                credentials: 'omit'
            });

            if (response.ok) return true;
        } catch {}

        // Compatibility fallback for older deployed Workers.
        try {
            const legacyBody = JSON.stringify({
                eventType,
                siteId: CONFIG.siteId,
                siteName: CONFIG.siteName,
                eventId: payload.eventId,
                visitorId,
                sessionId,
                pageUrl: location.href,
                path: location.pathname,
                title: document.title,
                referrer: document.referrer || '',
                language: navigator.language || '',
                timezone: payload.timezone,
                screenWidth: screen.width || 0,
                screenHeight: screen.height || 0,
                viewportWidth: innerWidth || 0,
                viewportHeight: innerHeight || 0,
                timestamp: payload.timestamp,
                durationMs: payload.durationMs,
                maxScroll,
                clicks: clickCount
            });

            const response = await fetch(`${root}/collect`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: legacyBody,
                keepalive,
                mode: 'cors',
                credentials: 'omit'
            });

            return response.ok;
        } catch {
            return false;
        }
    }

    function pickStats(payload) {
        const data = payload?.data || payload?.result || payload || {};
        const stats = data.stats || data.platform || data.overview || data;
        const today = stats.today || data.today || {};
        const series = Array.isArray(stats.series)
            ? stats.series
            : Array.isArray(data.series)
                ? data.series
                : [];

        const views = num(
            stats.views ??
            stats.pageviews ??
            stats.totalViews ??
            stats.total_pageviews ??
            data.views
        );

        const uniqueVisitors = num(
            stats.uniqueVisitors ??
            stats.unique_visitors ??
            stats.visitors ??
            data.uniqueVisitors
        );

        const sessions = num(
            stats.sessions ??
            stats.totalSessions ??
            data.sessions
        );

        const avgDurationMs = num(
            stats.avgDurationMs ??
            stats.avg_duration_ms ??
            data.avgDurationMs
        );

        const avgScroll = num(
            stats.avgScroll ??
            stats.avg_scroll ??
            data.avgScroll
        );

        const avgClicks = num(
            stats.avgClicks ??
            stats.avg_clicks ??
            data.avgClicks
        );

        const todayViews = num(
            today.views ??
            today.pageviews ??
            data.todayViews
        );

        return {
            raw: payload,
            views,
            uniqueVisitors,
            sessions,
            avgDurationMs,
            avgScroll,
            avgClicks,
            today: {
                date: today.date || today.day || today.key || '',
                views: todayViews,
                uniqueVisitors: num(today.uniqueVisitors ?? today.unique_visitors ?? today.visitors),
                sessions: num(today.sessions)
            },
            series,
            devices: stats.devices || data.devices || [],
            topPages: stats.topPages || stats.top_pages || data.topPages || [],
            recentVisits: stats.recentVisits || stats.recent_visits || data.recentVisits || []
        };
    }

    function normalizeSeries(series) {
        if (!Array.isArray(series)) return [];

        return series
            .map(row => ({
                day: String(row.day ?? row.date ?? row.key ?? '').slice(0, 32),
                views: num(row.views ?? row.pageviews ?? row.count),
                uniqueVisitors: num(row.uniqueVisitors ?? row.unique_visitors ?? row.visitors),
                sessions: num(row.sessions)
            }))
            .filter(row => row.day);
    }

    function cacheStats(data) {
        try {
            localStorage.setItem(KEY_CACHE, JSON.stringify({
                savedAt: new Date().toISOString(),
                data
            }));
        } catch {}
    }

    function loadCachedStats() {
        try {
            const raw = localStorage.getItem(KEY_CACHE);
            if (!raw) return null;
            return JSON.parse(raw)?.data || null;
        } catch {
            return null;
        }
    }

    function formatDuration(ms) {
        if (!ms || ms < 1000) return '—';
        const totalSec = Math.round(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        if (min) return `${min}m ${String(sec).padStart(2, '0')}s`;
        return `${sec}s`;
    }

    function renderTrendBars(series) {
        const bars = $('advTrendBars');
        if (!bars) return;

        const rows = normalizeSeries(series).slice(-14);
        if (!rows.length) {
            bars.innerHTML = '<span class="trend-empty">No recent traffic data.</span>';
            return;
        }

        const max = Math.max(1, ...rows.map(x => x.views));
        bars.innerHTML = rows
            .map(row => `<i title="${escapeAttribute(row.day)}: ${formatInt(row.views)}" style="height:${Math.max(7, Math.round(row.views / max * 100))}%"></i>`)
            .join('');
    }

    function renderAdvancedExtras(stats) {
        const topPages = $('insightTopPages');
        if (topPages) {
            const rows = Array.isArray(stats.topPages) ? stats.topPages.slice(0, 5) : [];
            topPages.innerHTML = rows.length
                ? rows.map(row => `<div><span>${escapeHtml(row.path || row.page || row.url || '—')}</span><b>${formatInt(row.views ?? row.count)}</b></div>`).join('')
                : '<div class="muted">No page breakdown available.</div>';
        }

        const recent = $('insightRecentVisits');
        if (recent) {
            const rows = Array.isArray(stats.recentVisits) ? stats.recentVisits.slice(0, 5) : [];
            recent.innerHTML = rows.length
                ? rows.map(row => `<div><span>${escapeHtml(row.timestamp || row.time || row.createdAt || '—')}</span><b>${escapeHtml(row.path || row.page || '—')}</b></div>`).join('')
                : '<div class="muted">No recent visit data.</div>';
        }
    }

    function render(payload, mode = 'live') {
        if (!payload || payload.ok === false) {
            setStatus('Analytics unavailable', false);
            updateStatusClass(false);
            return;
        }

        const stats = pickStats(payload);
        setStatus(mode === 'cached' ? 'Using cached analytics' : '● Connected to Page Insights', mode !== 'cached');
        updateStatusClass(mode !== 'cached');

        setText('insightTotalViews', formatInt(stats.views));
        setText('insightUniqueVisitors', formatInt(stats.uniqueVisitors));
        setText('insightTodayViews', formatInt(stats.today.views));
        setText('insightSessions', formatInt(stats.sessions));

        setText('advTotalViews', formatInt(stats.views));
        setText('advUniqueVisitors', formatInt(stats.uniqueVisitors));
        setText('advTodayViews', formatInt(stats.today.views));
        setText('advSessions', formatInt(stats.sessions));
        setText('insightLastEvent', `Last recorded day: ${stats.today.date || normalizeSeries(stats.series).at(-1)?.day || '—'}`);
        setText('advLastEvent', `Last recorded day: ${stats.today.date || normalizeSeries(stats.series).at(-1)?.day || '—'}`);
        setText('insightAvgDuration', formatDuration(stats.avgDurationMs));
        setText('insightAvgScroll', stats.avgScroll ? `${Math.round(stats.avgScroll)}%` : '—');
        setText('insightAvgClicks', stats.avgClicks ? stats.avgClicks.toFixed(1) : '—');
        setText('insightLastSeen', stats.today.date || normalizeSeries(stats.series).at(-1)?.day || '—');
        setText('insightFreshness', mode === 'cached' ? 'Cached' : 'Live');

        const svg = $('insightLine');
        const area = $('insightArea');
        if (svg && area) {
            const rows = normalizeSeries(stats.series).slice(-30);
            const max = Math.max(1, ...rows.map(x => x.views));
            const points = rows.map((row, index) => {
                const x = rows.length === 1 ? 50 : (index / (rows.length - 1)) * 100;
                const y = 100 - (row.views / max) * 82;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            });
            svg.setAttribute('points', points.join(' '));
            area.setAttribute('points', points.length ? `0,100 ${points.join(' ')} 100,100` : '0,100 100,100');
        }

        renderTrendBars(stats.series);
        renderAdvancedExtras(stats);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    async function fetchStatsV11() {
        return fetchJson(
            `${root}/v1/platforms/${encodeURIComponent(CONFIG.platformId)}?days=${CONFIG.analyticsDays}`
        );
    }

    async function fetchStatsLegacy() {
        return fetchJson(
            `${root}/api/site/${encodeURIComponent(CONFIG.siteId)}?days=3650`
        );
    }

    async function refresh() {
        try {
            let payload;
            try {
                payload = await fetchStatsV11();
            } catch (primaryError) {
                console.debug('[Page Insights] v11 request failed:', primaryError?.message || primaryError);
                payload = await fetchStatsLegacy();
            }

            cacheStats(payload);
            render(payload, 'live');
            return payload;
        } catch (error) {
            console.debug('[Page Insights] analytics refresh failed:', error?.message || error);

            const cached = loadCachedStats();
            if (cached) {
                render(cached, 'cached');
                return cached;
            }

            setStatus('Analytics temporarily unavailable', false);
            updateStatusClass(false);
            return null;
        }
    }

    function watchScroll() {
        const doc = document.documentElement;
        const total = Math.max(1, doc.scrollHeight - innerHeight);
        maxScroll = Math.max(
            maxScroll,
            Math.min(100, Math.round((scrollY / total) * 100))
        );
    }

    function watchClicks(event) {
        if (event.target.closest('button, a, select, input, [role="button"]')) {
            clickCount += 1;
        }
    }

    function sendLeaveOnce() {
        if (sentLeave) return;
        sentLeave = true;
        send('pageleave', {
            durationMs: Math.max(0, Date.now() - visibleSince),
            maxScroll,
            clicks: clickCount
        }, true);
    }

    function start() {
        document.addEventListener('scroll', watchScroll, { passive: true });
        document.addEventListener('click', watchClicks, { passive: true });

        window.setTimeout(() => {
            send('pageview', { maxScroll: 0 });
        }, 200);

        heartbeatTimer = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            send('heartbeat', {
                durationMs: Math.max(0, Date.now() - visibleSince),
                maxScroll,
                clicks: clickCount
            });
        }, CONFIG.heartbeatMs);

        window.addEventListener('pagehide', sendLeaveOnce, { once: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') sendLeaveOnce();
        });

        refresh();
        refreshTimer = window.setInterval(refresh, CONFIG.refreshMs);

        ['insightsRefresh', 'advInsightsRefresh'].forEach(idName => {
            const button = $(idName);
            if (button) {
                button.addEventListener('click', () => { refresh(); });
            }
        });
    }

    window.IMDBPageInsights = {
        refresh,
        send,
        config: CONFIG
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

    window.addEventListener('pagehide', () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (refreshTimer) clearInterval(refreshTimer);
    }, { once: true });
})();
