/* Shared GitHub Page Insights client for Classic + Advanced */
(() => {
  'use strict';

  const CONFIG = {
    workerUrl: 'https://github-page-insights-worker.game-developer-mb.workers.dev',
    siteId: 'imdb-showcase',
    siteName: 'IMDb Showcase',
    autoRefreshMs: 60000
  };

  const get = (id) => document.getElementById(id);
  const nowIso = () => new Date().toISOString();
  const safeJson = (v) => { try { return JSON.stringify(v); } catch { return '{}'; } };

  function randomId(prefix) {
    try {
      if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    } catch {}
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function visitorId() {
    const key = 'imdb-showcase-visitor-id-v2';
    try {
      let id = localStorage.getItem(key);
      if (!id) {
        id = randomId('visitor');
        localStorage.setItem(key, id);
      }
      return id;
    } catch {
      return randomId('visitor');
    }
  }

  function sessionId() {
    const key = 'imdb-showcase-session-id-v2';
    try {
      let id = sessionStorage.getItem(key);
      if (!id) {
        id = randomId('session');
        sessionStorage.setItem(key, id);
      }
      return id;
    } catch {
      return randomId('session');
    }
  }

  const ids = { visitorId: visitorId(), sessionId: sessionId() };
  let lastPageview = 0;
  let heartbeatTimer = 0;
  let refreshTimer = 0;

  function payload(type, extra = {}) {
    return {
      type,
      siteId: CONFIG.siteId,
      siteName: CONFIG.siteName,
      eventId: randomId('event'),
      visitorId: ids.visitorId,
      sessionId: ids.sessionId,
      pageUrl: location.href,
      path: location.pathname,
      title: document.title,
      referrer: document.referrer || '',
      language: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      screen: {
        width: screen.width,
        height: screen.height,
        devicePixelRatio: window.devicePixelRatio || 1,
        colorDepth: screen.colorDepth || 0
      },
      viewport: {
        width: innerWidth,
        height: innerHeight
      },
      connection: navigator.connection ? {
        type: navigator.connection.effectiveType || '',
        downlink: navigator.connection.downlink || 0,
        rtt: navigator.connection.rtt || 0,
        saveData: Boolean(navigator.connection.saveData)
      } : {},
      timestamp: nowIso(),
      ...extra
    };
  }

  function send(type, extra = {}, keepalive = true) {
    const url = `${CONFIG.workerUrl.replace(/\/$/, '')}/collect`;
    const body = safeJson(payload(type, extra));
    try {
      if (navigator.sendBeacon && keepalive) {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return Promise.resolve(true);
      }
    } catch {}
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive,
      mode: 'cors'
    }).then(r => r.ok).catch(() => false);
  }

  function formatInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US');
  }

  function setText(id, value) {
    const node = get(id);
    if (node) node.textContent = value;
  }

  function setStatus(text, ok = false) {
    const node = document.querySelector('#insightsStatus, #advInsightsStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.ok = ok ? 'true' : 'false';
  }

  function render(data) {
    if (!data || data.ok === false) {
      setStatus('داده بازدید در دسترس نیست');
      return;
    }
    setStatus('● متصل به Page Insights', true);

    setText('insightTotalViews', formatInt(data.views));
    setText('insightUniqueVisitors', formatInt(data.uniqueVisitors));
    setText('insightTodayViews', formatInt(data.today?.views));
    setText('insightSessions', formatInt(data.sessions));

    setText('advTotalViews', formatInt(data.views));
    setText('advUniqueVisitors', formatInt(data.uniqueVisitors));
    setText('advTodayViews', formatInt(data.today?.views));
    setText('advSessions', formatInt(data.sessions));

    const latest = data.series?.length ? data.series[data.series.length - 1] : null;
    const latestLabel = latest?.day || data.today?.date || '—';
    setText('insightLastEvent', `آخرین روز ثبت‌شده: ${latestLabel}`);
    setText('advLastEvent', `آخرین روز ثبت‌شده: ${latestLabel}`);

    renderAdvancedMiniTrend(data.series || data.last7Days || []);
  }

  function renderAdvancedMiniTrend(rows) {
    const host = get('advTrendBars');
    if (!host) return;
    const safeRows = Array.isArray(rows) ? rows.slice(-14) : [];
    if (!safeRows.length) {
      host.innerHTML = '<span class="trend-empty">هنوز داده کافی ثبت نشده است.</span>';
      return;
    }
    const max = Math.max(1, ...safeRows.map(x => Number(x.views) || 0));
    host.innerHTML = safeRows.map(row => {
      const value = Number(row.views) || 0;
      const height = Math.max(8, Math.round(value / max * 100));
      return `<div class="trend-bar" style="--h:${height}%" title="${row.day || ''}: ${value}"><i></i></div>`;
    }).join('');
  }

  async function refresh() {
    try {
      const url = `${CONFIG.workerUrl.replace(/\/$/, '')}/api/site/${encodeURIComponent(CONFIG.siteId)}?days=30`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      setStatus('اتصال به آمار بازدید موقتاً در دسترس نیست');
      console.warn('Page Insights:', error);
    }
  }

  function start() {
    const firstDelay = lastPageview ? 0 : 200;
    setTimeout(() => {
      send('pageview');
      lastPageview = Date.now();

      heartbeatTimer = window.setInterval(() => {
        const durationMs = Date.now() - lastPageview;
        send('heartbeat', {
          durationMs,
          maxScroll: Math.round(((scrollY + innerHeight) / Math.max(1, document.documentElement.scrollHeight)) * 100)
        });
      }, 30000);
    }, firstDelay);

    const leave = () => {
      const durationMs = lastPageview ? Date.now() - lastPageview : 0;
      send('pageleave', {
        durationMs,
        maxScroll: Math.round(((scrollY + innerHeight) / Math.max(1, document.documentElement.scrollHeight)) * 100)
      });
    };

    window.addEventListener('pagehide', leave, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') leave();
    });

    refresh();
    refreshTimer = window.setInterval(refresh, CONFIG.autoRefreshMs);

    const refreshButton = get('insightsRefresh');
    if (refreshButton) refreshButton.addEventListener('click', refresh);
    const advancedRefresh = get('advInsightsRefresh');
    if (advancedRefresh) advancedRefresh.addEventListener('click', refresh);
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
})();
