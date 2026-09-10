(function () {
  "use strict";

  const CONFIG = Object.assign({
    workerUrl: "https://github-page-insights-worker.game-developer-mb.workers.dev",
    siteId: "imdb-showcase",
    siteName: "IMDb Showcase",
    heartbeatMs: 15000,
    refreshMs: 60000
  }, window.PAGE_INSIGHTS_CONFIG || {});

  const WORKER = String(CONFIG.workerUrl || "").replace(/\/+$/, "");
  if (!WORKER) return;

  const SITE_ID = String(CONFIG.siteId || "imdb-showcase");
  const SITE_NAME = String(CONFIG.siteName || "IMDb Showcase");
  const VISITOR_KEY = `gpi:v4:visitor:${SITE_ID}`;
  const SESSION_KEY = `gpi:v4:session:${SITE_ID}`;

  const uuid = () => {
    try {
      if (crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  };

  const storageGet = (storage, key) => {
    try { return storage.getItem(key); } catch (_) { return null; }
  };

  const storageSet = (storage, key, value) => {
    try { storage.setItem(key, value); } catch (_) {}
  };

  let visitorId = storageGet(localStorage, VISITOR_KEY);
  if (!visitorId) {
    visitorId = uuid();
    storageSet(localStorage, VISITOR_KEY, visitorId);
  }

  let session;
  try {
    session = JSON.parse(storageGet(sessionStorage, SESSION_KEY) || "null");
  } catch (_) {
    session = null;
  }

  const now = Date.now();
  if (!session || !session.id || now - Number(session.lastSeen || 0) > 30 * 60 * 1000) {
    session = { id: uuid(), lastSeen: now };
  }
  storageSet(sessionStorage, SESSION_KEY, JSON.stringify(session));

  const state = {
    startedAt: now,
    maxScroll: 0,
    clicks: 0,
    outboundClicks: 0,
    ended: false
  };

  function connectionHints() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return null;
    return {
      type: connection.effectiveType || connection.type || "",
      downlink: connection.downlink ?? null,
      rtt: connection.rtt ?? null,
      saveData: !!connection.saveData
    };
  }

  function payload(type) {
    return {
      siteId: SITE_ID,
      siteName: SITE_NAME,
      type,
      sessionId: session.id,
      visitorId,
      pageUrl: location.href,
      path: location.pathname + location.search,
      title: document.title || "",
      referrer: document.referrer || "",
      language: navigator.language || "",
      timezone: (() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) { return ""; }
      })(),
      screen: {
        width: screen.width || 0,
        height: screen.height || 0
      },
      viewport: {
        width: innerWidth || 0,
        height: innerHeight || 0
      },
      connection: connectionHints(),
      durationMs: Math.max(0, Date.now() - state.startedAt),
      maxScroll: state.maxScroll,
      clicks: state.clicks,
      outboundClicks: state.outboundClicks
    };
  }

  function send(type, beacon) {
    if (state.ended && type !== "pageleave") return;

    const body = JSON.stringify(payload(type));
    const url = `${WORKER}/collect`;

    if (beacon && navigator.sendBeacon) {
      try {
        const ok = navigator.sendBeacon(
          url,
          new Blob([body], { type: "application/json" })
        );
        if (ok) {
          session.lastSeen = Date.now();
          storageSet(sessionStorage, SESSION_KEY, JSON.stringify(session));
          return;
        }
      } catch (_) {}
    }

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      mode: "cors",
      credentials: "omit",
      keepalive: !!beacon
    }).catch(() => {});

    session.lastSeen = Date.now();
    storageSet(sessionStorage, SESSION_KEY, JSON.stringify(session));
  }

  function onScroll() {
    const documentElement = document.documentElement;
    const total = Math.max(1, documentElement.scrollHeight - innerHeight);
    const percent = Math.round((scrollY / total) * 100);
    state.maxScroll = Math.max(0, Math.min(100, percent));
  }

  function onClick(event) {
    state.clicks += 1;
    const anchor = event.target && event.target.closest
      ? event.target.closest("a[href]")
      : null;

    if (!anchor) return;

    try {
      if (new URL(anchor.href, location.href).origin !== location.origin) {
        state.outboundClicks += 1;
      }
    } catch (_) {}
  }

  function finish() {
    if (state.ended) return;
    state.ended = true;
    send("pageleave", true);
  }

  send("pageview", false);

  const heartbeatMs = Math.max(
    15000,
    Number(CONFIG.heartbeatMs || 15000)
  );

  const heartbeatTimer = setInterval(() => {
    if (!document.hidden && !state.ended) {
      send("heartbeat", false);
    }
  }, heartbeatMs);

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("click", onClick, { passive: true, capture: true });
  window.addEventListener("pagehide", finish, { capture: true });
  window.addEventListener("beforeunload", finish, { capture: true });
  window.addEventListener("pagehide", () => clearInterval(heartbeatTimer), { once: true });

  window.PAGE_INSIGHTS = {
    workerUrl: WORKER,
    siteId: SITE_ID,
    siteName: SITE_NAME
  };
})();
