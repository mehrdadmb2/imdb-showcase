/*
 * IMDb Showcase -> Universal Event Insights v11 adapter
 *
 * Current contract (github-page-insights v11):
 *   POST /v1/events
 *   GET  /v1/platforms/<platformId>?days=N
 *   GET  /v1/platforms/<platformId>/events?days=N&limit=N
 *
 * This file intentionally owns only analytics/visitor telemetry.
 * It must never interfere with the movie-library application.
 */
(() => {
  'use strict';

  if (window.__IMDB_SHOWCASE_PAGE_INSIGHTS_V11__) return;
  window.__IMDB_SHOWCASE_PAGE_INSIGHTS_V11__ = true;

  const CONFIG = Object.freeze({
    workerUrl: 'https://github-page-insights-worker.game-developer-mb.workers.dev',
    platformId: 'imdb-showcase',
    platformName: 'IMDb Showcase',
    platformType: 'github-pages',
    environment: 'production',
    appVersion: '15.1.0',
    sdkName: 'imdb-showcase-page-insights',
    sdkVersion: '11.0.0',
    requestTimeoutMs: 12000,
    statsRefreshMs: 60000,
    heartbeatMs: 30000,
    queueFlushMs: 60000,
    eventQueueLimit: 30,
    analyticsDays: 'all',
    trendDays: 30,
    recentEventsDays: 7,
    recentEventsLimit: 20
  });

  const root = CONFIG.workerUrl.replace(/\/+$/, '');
  const KEYS = Object.freeze({
    visitor: 'imdb-showcase-uei-v11-visitor',
    session: 'imdb-showcase-uei-v11-session',
    queue: 'imdb-showcase-uei-v11-queue',
    stats: 'imdb-showcase-uei-v11-stats'
  });

  let pageStartedAt = Date.now();
  let maxScroll = 0;
  let lastScrollSent = 0;
  let clickCount = 0;
  let outboundClicks = 0;
  let pageLeft = false;
  let heartbeatTimer = 0;
  let statsTimer = 0;
  let scrollRaf = 0;
  let lastStatsPayload = null;

  const $ = id => document.getElementById(id);

  function makeId(prefix) {
    try {
      if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    } catch (_) {}
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function readStorage(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }

  function writeStorage(storage, key, value) {
    try { storage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function persistentId(storage, key, prefix) {
    const existing = readStorage(storage, key);
    if (existing) return existing;
    const created = makeId(prefix);
    writeStorage(storage, key, created);
    return created;
  }

  const visitorId = persistentId(localStorage, KEYS.visitor, 'visitor');
  const sessionId = persistentId(sessionStorage, KEYS.session, 'session');

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function formatInt(value) {
    return Math.max(0, Math.round(number(value))).toLocaleString('en-US');
  }

  function formatDecimal(value, digits = 1) {
    const n = number(value);
    return n.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = String(value ?? '—');
  }

  function updateStatus(text, connected) {
    document.querySelectorAll('#insightsStatus, #advInsightsStatus').forEach(node => {
      node.textContent = text;
      node.dataset.connected = connected ? 'true' : 'false';
      node.classList.toggle('is-connected', connected);
    });
  }

  function basePage() {
    return {
      url: location.href,
      path: location.pathname,
      queryString: location.search.slice(1),
      title: document.title,
      referrer: document.referrer || null
    };
  }

  function connectionInfo() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      effectiveType: c?.effectiveType || null,
      type: c?.type || null,
      downlink: c?.downlink ?? null,
      rtt: c?.rtt ?? null,
      saveData: Boolean(c?.saveData)
    };
  }

  function buildEvent(eventType, data = {}, metadata = {}) {
    return {
      platformId: CONFIG.platformId,
      platformName: CONFIG.platformName,
      platformType: CONFIG.platformType,
      platformUrl: `${location.origin}${location.pathname}`,
      platformDomain: location.hostname,
      environment: CONFIG.environment,
      appVersion: CONFIG.appVersion,
      sdkName: CONFIG.sdkName,
      sdkVersion: CONFIG.sdkVersion,
      source: 'browser',
      eventType,
      eventId: makeId('evt'),
      timestamp: new Date().toISOString(),
      identity: {
        visitorId,
        sessionId,
        userId: null,
        anonymousId: null
      },
      page: basePage(),
      screen: {
        width: globalThis.screen?.width || 0,
        height: globalThis.screen?.height || 0,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
        colorDepth: globalThis.screen?.colorDepth || 24
      },
      viewport: {
        width: globalThis.innerWidth || 0,
        height: globalThis.innerHeight || 0
      },
      connection: connectionInfo(),
      language: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      durationMs: Math.max(0, Date.now() - pageStartedAt),
      maxScroll,
      clicks: clickCount,
      outboundClicks,
      data: data || {},
      metadata: metadata || {}
    };
  }

  function readQueue() {
    try {
      const value = JSON.parse(readStorage(localStorage, KEYS.queue) || '[]');
      return Array.isArray(value) ? value.slice(-CONFIG.eventQueueLimit) : [];
    } catch (_) {
      return [];
    }
  }

  function saveQueue(queue) {
    writeStorage(
      localStorage,
      KEYS.queue,
      JSON.stringify(queue.slice(-CONFIG.eventQueueLimit))
    );
  }

  function enqueue(body) {
    const queue = readQueue();
    queue.push(body);
    saveQueue(queue);
  }

  async function postEvent(body, keepalive = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      const response = await fetch(`${root}/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive,
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal
      });

      return response.ok;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(eventType, data = {}, metadata = {}, useBeacon = false) {
    const body = buildEvent(eventType, data, metadata);
    const serialized = JSON.stringify(body);

    if (useBeacon && navigator.sendBeacon) {
      try {
        const blob = new Blob([serialized], {
          type: 'text/plain;charset=UTF-8'
        });
        if (navigator.sendBeacon(`${root}/v1/events`, blob)) return true;
      } catch (_) {}
    }

    const ok = await postEvent(body, useBeacon);
    if (!ok) enqueue(body);
    return ok;
  }

  async function flushQueue() {
    const queue = readQueue();
    if (!queue.length) return;

    const remaining = [];
    for (const item of queue) {
      const ok = await postEvent(item, false);
      if (!ok) remaining.push(item);
    }
    saveQueue(remaining);
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (_) {}

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      if (!payload || payload.ok === false) {
        throw new Error(payload?.error || 'Invalid analytics response');
      }

      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeDaily(rows) {
    if (!Array.isArray(rows)) return [];

    return rows.map(row => ({
      day: String(row.day ?? row.date ?? '').slice(0, 32),
      views: number(row.views ?? row.pageviews),
      uniqueVisitors: number(row.uniqueVisitors ?? row.unique_visitors),
      sessions: number(row.sessions),
      events: number(row.events)
    })).filter(row => row.day);
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function pickToday(daily) {
    if (!daily.length) return { day: '', views: 0, uniqueVisitors: 0, sessions: 0 };

    const key = todayKey();
    const exact = daily.find(row => row.day === key);
    if (exact) return exact;

    return daily[daily.length - 1];
  }

  function cacheStats(payload) {
    writeStorage(localStorage, KEYS.stats, JSON.stringify({
      savedAt: new Date().toISOString(),
      payload
    }));
  }

  function loadCachedStats() {
    try {
      const raw = readStorage(localStorage, KEYS.stats);
      if (!raw) return null;
      return JSON.parse(raw)?.payload || null;
    } catch (_) {
      return null;
    }
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round(number(ms) / 1000));
    if (!seconds) return '—';
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (!minutes) return `${rest}s`;
    return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  }

  function render(payload, mode = 'live') {
    const totals = payload?.totals || {};
    const daily = normalizeDaily(payload?.daily);
    const today = pickToday(daily);
    const lastDay = daily[daily.length - 1]?.day || today.day || '—';

    setText('insightTotalViews', formatInt(totals.views));
    setText('insightUniqueVisitors', formatInt(totals.uniqueVisitors));
    setText('insightTodayViews', formatInt(today.views));
    setText('insightSessions', formatInt(totals.sessions));
    setText('insightAvgDuration', formatDuration(totals.avgDurationMs));
    setText('insightAvgScroll', totals.avgScroll ? `${Math.round(number(totals.avgScroll))}%` : '—');
    setText('insightAvgClicks', totals.avgClicks ? formatDecimal(totals.avgClicks, 1) : '—');
    setText('insightLastSeen', lastDay);
    setText('insightFreshness', mode === 'cached' ? 'Cached' : 'Live');
    setText('insightLastEvent', `Last recorded day: ${lastDay}`);

    setText('advTotalViews', formatInt(totals.views));
    setText('advUniqueVisitors', formatInt(totals.uniqueVisitors));
    setText('advTodayViews', formatInt(today.views));
    setText('advSessions', formatInt(totals.sessions));
    setText('advLastEvent', `Last recorded day: ${lastDay}`);

    const recent = Array.isArray(payload?.recentEvents) ? payload.recentEvents : [];
    const recentPageviews = recent.filter(event => event.event_type === 'pageview');
    const recentLatest = recentPageviews[0] || recent[0] || null;
    if (recentLatest?.received_at) {
      const time = new Date(recentLatest.received_at);
      if (!Number.isNaN(time.getTime())) {
        setText('insightLastEvent', `Last visit: ${time.toLocaleString('en-US')}`);
        setText('advLastEvent', `Last visit: ${time.toLocaleString('en-US')}`);
      }
    }

    const trend = $('insightLine');
    const area = $('insightArea');
    if (trend && area) {
      const rows = daily.slice(-CONFIG.trendDays);
      const max = Math.max(1, ...rows.map(row => row.views));
      const points = rows.map((row, index) => {
        const x = rows.length <= 1 ? 50 : (index / (rows.length - 1)) * 100;
        const y = 100 - (row.views / max) * 82;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      trend.setAttribute('points', points.join(' '));
      area.setAttribute(
        'points',
        points.length ? `0,100 ${points.join(' ')} 100,100` : '0,100 100,100'
      );
    }

    const bars = $('advTrendBars');
    if (bars) {
      const rows = daily.slice(-14);
      if (!rows.length) {
        bars.innerHTML = '<span class="trend-empty">No recent traffic data.</span>';
      } else {
        const max = Math.max(1, ...rows.map(row => row.views));
        bars.innerHTML = rows.map(row =>
          `<i title="${escapeAttribute(row.day)}: ${formatInt(row.views)}" style="height:${Math.max(7, Math.round(row.views / max * 100))}%"></i>`
        ).join('');
      }
    }

    const topPages = $('insightTopPages');
    if (topPages) {
      const rows = Array.isArray(payload?.topPages) ? payload.topPages.slice(0, 5) : [];
      topPages.innerHTML = rows.length
        ? rows.map(row => `<div><span>${escapeHtml(row.path || row.page || row.url || '—')}</span><b>${formatInt(row.views ?? row.count)}</b></div>`).join('')
        : '<div class="muted">No page breakdown available.</div>';
    }

    updateStatus(
      mode === 'cached' ? 'Using cached analytics' : '● Connected to Page Insights',
      mode === 'live'
    );
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  async function fetchPlatformStats(days) {
    return fetchJson(
      `${root}/v1/platforms/${encodeURIComponent(CONFIG.platformId)}?days=${encodeURIComponent(days)}`
    );
  }

  async function refreshStats() {
    try {
      // Lifetime totals + a small trend response. Keeping the trend request
      // bounded avoids huge payloads while the lifetime response supplies
      // all-time totals.
      const [allTime, recent] = await Promise.all([
        fetchPlatformStats(CONFIG.analyticsDays),
        fetchPlatformStats(CONFIG.trendDays)
      ]);

      const merged = {
        ...allTime,
        daily: recent.daily || allTime.daily || [],
        recentEvents: recent.recentEvents || allTime.recentEvents || [],
        topPages: recent.topPages || allTime.topPages || [],
        totals: allTime.totals || {}
      };

      lastStatsPayload = merged;
      cacheStats(merged);
      render(merged, 'live');
      return merged;
    } catch (error) {
      console.debug('[IMDb Showcase / Page Insights] stats failed:', error?.message || error);
      if (lastStatsPayload) {
        render(lastStatsPayload, 'cached');
        return lastStatsPayload;
      }

      const cached = loadCachedStats();
      if (cached) {
        lastStatsPayload = cached;
        render(cached, 'cached');
        return cached;
      }

      updateStatus('Analytics temporarily unavailable', false);
      return null;
    }
  }

  function updateScroll() {
    const doc = document.documentElement;
    const body = document.body;
    const top = window.scrollY || doc.scrollTop || 0;
    const total = Math.max(doc.scrollHeight, body?.scrollHeight || 0, doc.offsetHeight || 0) - window.innerHeight;
    maxScroll = total > 0 ? Math.min(100, Math.round((top / total) * 100)) : 100;

    if (maxScroll - lastScrollSent >= 5) {
      lastScrollSent = maxScroll;
      void send('scroll', { depth: maxScroll });
    }
  }

  function scheduleScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateScroll();
    });
  }

  function handleClick(event) {
    const target = event.target;
    const interactive = target?.closest?.('button, a, select, input, [role="button"]');
    if (!interactive) return;

    clickCount += 1;

    const info = {
      tag: target?.tagName || null,
      id: target?.id || null,
      className: typeof target?.className === 'string' ? target.className.slice(0, 256) : null
    };

    void send('click', { target: info });

    const anchor = target?.closest?.('a');
    if (anchor?.href && anchor.origin !== location.origin) {
      outboundClicks += 1;
      void send('outbound_click', {
        href: anchor.href,
        text: (anchor.textContent || '').trim().slice(0, 256)
      });
    }
  }

  function sendPageLeave() {
    if (pageLeft) return;
    pageLeft = true;
    void send('pageleave', {
      durationMs: Math.max(0, Date.now() - pageStartedAt),
      maxScroll,
      clicks: clickCount,
      outboundClicks
    }, { reason: 'pagehide' }, true);
  }

  function bindControls() {
    ['insightsRefresh', 'advInsightsRefresh'].forEach(id => {
      const button = $(id);
      if (!button || button.dataset.ueiBound === '1') return;
      button.dataset.ueiBound = '1';
      button.addEventListener('click', () => { void refreshStats(); });
    });
  }

  function start() {
    document.addEventListener('scroll', scheduleScroll, { passive: true });
    document.addEventListener('click', handleClick, { passive: true });

    window.addEventListener('online', () => { void flushQueue(); });
    window.addEventListener('pagehide', sendPageLeave, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendPageLeave();
    });

    void send('pageview', {});
    void flushQueue();

    heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || pageLeft) return;
      void send('heartbeat', {
        durationMs: Math.max(0, Date.now() - pageStartedAt),
        maxScroll,
        clicks: clickCount,
        outboundClicks
      });
    }, CONFIG.heartbeatMs);

    window.setInterval(() => { void flushQueue(); }, CONFIG.queueFlushMs);

    void refreshStats();
    statsTimer = window.setInterval(() => { void refreshStats(); }, CONFIG.statsRefreshMs);

    bindControls();
  }

  window.IMDBPageInsights = Object.freeze({
    refresh: refreshStats,
    send,
    config: CONFIG
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.addEventListener('pagehide', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (statsTimer) clearInterval(statsTimer);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
  }, { once: true });
})();
