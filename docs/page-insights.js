/*
 * Shared Page Insights client.
 * Compatible with the current github-page-insights Worker API:
 *   POST /collect
 *   GET  /api/site/:siteId?days=30
 *
 * This file intentionally fails soft: analytics outage must never stop
 * the IMDb Showcase application.
 */
(() => {
    'use strict';

    const CONFIG = Object.freeze({
        workerUrl: 'https://github-page-insights-worker.game-developer-mb.workers.dev',
        siteId: 'imdb-showcase',
        siteName: 'IMDb Showcase',
        refreshMs: 60000
    });

    const $ = (id) => document.getElementById(id);
    const KEY_VISITOR = 'imdb-showcase-page-insights-visitor-v3';
    const KEY_SESSION = 'imdb-showcase-page-insights-session-v3';
    const endpoint = `${CONFIG.workerUrl.replace(/\/$/, '')}`;

    let sentPageleave = false;
    let heartbeatTimer = 0;
    let refreshTimer = 0;
    let visibleSince = Date.now();
    let maxScroll = 0;

    function id(prefix) {
        try { if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`; } catch {}
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function storageId(storage, key, prefix) {
        try {
            let value = storage.getItem(key);
            if (!value) { value = id(prefix); storage.setItem(key, value); }
            return value;
        } catch { return id(prefix); }
    }

    const visitorId = storageId(localStorage, KEY_VISITOR, 'visitor');
    const sessionId = storageId(sessionStorage, KEY_SESSION, 'session');

    function number(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function formatInt(value) {
        return number(value).toLocaleString('en-US');
    }

    function set(idName, value) {
        const node = $(idName);
        if (node) node.textContent = value;
    }

    function updateStatus(text, connected) {
        document.querySelectorAll('#insightsStatus, #advInsightsStatus').forEach(node => {
            node.textContent = text;
            node.dataset.connected = connected ? 'true' : 'false';
        });
    }

    function basePayload(eventType, extra = {}) {
        return {
            eventType,
            siteId: CONFIG.siteId,
            siteName: CONFIG.siteName,
            eventId: id('event'),
            visitorId,
            sessionId,
            pageUrl: location.href,
            path: location.pathname,
            title: document.title,
            referrer: document.referrer || '',
            language: navigator.language || '',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            screenWidth: screen.width || 0,
            screenHeight: screen.height || 0,
            viewportWidth: innerWidth || 0,
            viewportHeight: innerHeight || 0,
            timestamp: new Date().toISOString(),
            ...extra
        };
    }

    async function send(eventType, extra = {}, keepalive = true) {
        const url = `${endpoint}/collect`;
        const body = JSON.stringify(basePayload(eventType, extra));
        try {
            if (navigator.sendBeacon && keepalive) {
                const blob = new Blob([body], { type: 'application/json' });
                if (navigator.sendBeacon(url, blob)) return true;
            }
        } catch {}

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                keepalive,
                mode: 'cors'
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    function render(data) {
        if (!data || data.ok === false) {
            updateStatus('آمار فعلاً در دسترس نیست', false);
            return;
        }

        updateStatus('● متصل به Page Insights', true);
        set('insightTotalViews', formatInt(data.views));
        set('insightUniqueVisitors', formatInt(data.uniqueVisitors));
        set('insightTodayViews', formatInt(data.today?.views));
        set('insightSessions', formatInt(data.sessions));
        set('advTotalViews', formatInt(data.views));
        set('advUniqueVisitors', formatInt(data.uniqueVisitors));
        set('advTodayViews', formatInt(data.today?.views));
        set('advSessions', formatInt(data.sessions));

        const last = Array.isArray(data.series) && data.series.length ? data.series[data.series.length - 1] : null;
        const lastText = last?.day ? `آخرین روز ثبت‌شده: ${last.day}` : `امروز: ${data.today?.date || '—'}`;
        set('insightLastEvent', lastText);
        set('advLastEvent', lastText);

        const bars = $('advTrendBars');
        if (bars) {
            const rows = Array.isArray(data.series) ? data.series.slice(-14) : [];
            const max = Math.max(1, ...rows.map(x => number(x.views)));
            bars.innerHTML = rows.length
                ? rows.map(x => `<i title="${String(x.day || '')}: ${formatInt(x.views)}" style="height:${Math.max(7, Math.round(number(x.views) / max * 100))}%"></i>`).join('')
                : '<span class="trend-empty">هنوز داده‌ای ثبت نشده است.</span>';
        }
    }

    async function refresh() {
        try {
            const response = await fetch(
                `${endpoint}/api/site/${encodeURIComponent(CONFIG.siteId)}?days=30`,
                { cache: 'no-store' }
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            render(await response.json());
        } catch (error) {
            updateStatus('اتصال به آمار موقتاً در دسترس نیست', false);
            console.debug('[Page Insights]', error?.message || error);
        }
    }

    function scrollWatcher() {
        const doc = document.documentElement;
        const total = Math.max(1, doc.scrollHeight - innerHeight);
        maxScroll = Math.max(maxScroll, Math.min(100, Math.round((scrollY / total) * 100)));
    }

    function sendLeaveOnce() {
        if (sentPageleave) return;
        sentPageleave = true;
        const durationMs = Math.max(0, Date.now() - visibleSince);
        send('pageleave', { durationMs, maxScroll }, true);
    }

    function start() {
        document.addEventListener('scroll', scrollWatcher, { passive: true });

        setTimeout(() => {
            send('pageview', { maxScroll: 0 });
        }, 250);

        heartbeatTimer = window.setInterval(() => {
            send('heartbeat', {
                durationMs: Math.max(0, Date.now() - visibleSince),
                maxScroll
            });
        }, 30000);

        window.addEventListener('pagehide', sendLeaveOnce, { once: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') sendLeaveOnce();
        });

        refresh();
        refreshTimer = window.setInterval(refresh, CONFIG.refreshMs);

        ['insightsRefresh', 'advInsightsRefresh'].forEach(idName => {
            const button = $(idName);
            if (button) button.addEventListener('click', refresh);
        });
    }

    window.IMDBPageInsights = { refresh, send, config: CONFIG };

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
