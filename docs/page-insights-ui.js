(function () {
  "use strict";

  const worker = String(
    window.PAGE_INSIGHTS_CONFIG?.workerUrl ||
    "https://github-page-insights-worker.game-developer-mb.workers.dev"
  ).replace(/\/+$/, "");

  const siteId = String(
    window.PAGE_INSIGHTS_CONFIG?.siteId || "imdb-showcase"
  );

  const $ = (id) => document.getElementById(id);
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const number = (value) => Number(value || 0).toLocaleString("en-US");

  function duration(ms) {
    const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return `${minutes}m ${rest}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  async function get(path) {
    const response = await fetch(`${worker}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Insights HTTP ${response.status}`);
    return response.json();
  }

  function renderSite(data) {
    const views = Number(data.views || 0);
    const visitors = Number(data.uniqueVisitors || 0);
    const sessions = Number(data.sessions || 0);
    const series = Array.isArray(data.series) ? data.series : [];
    const latestDay = series.length ? series[series.length - 1] : null;
    const todayViews = latestDay ? Number(latestDay.views || 0) : 0;

    set("insightTotalViews", number(views));
    set("insightVisitors", number(visitors));
    set("insightSessions", number(sessions));
    set("insightTodayViews", number(todayViews));
    set("insightRangeLabel", "Last 365 days");
    set("insightLastSeen", data.recentVisits?.[0]?.ts ? new Date(data.recentVisits[0].ts).toLocaleString("en-US") : "No visit yet");

    const devices = data.devices || {};
    const deviceEntries = Object.entries(devices).sort((a,b) => Number(b[1]) - Number(a[1]));
    const deviceList = $("insightDevices");
    if (deviceList) {
      const total = deviceEntries.reduce((sum, [, value]) => sum + Number(value || 0), 0) || 1;
      deviceList.innerHTML = deviceEntries.slice(0, 5).map(([name, value]) => {
        const pct = Math.round((Number(value || 0) / total) * 100);
        return `<div class="insight-device-row"><span>${escapeHtml(name)}</span><i><em style="width:${pct}%"></em></i><b>${pct}%</b></div>`;
      }).join("") || `<div class="insight-muted">No device data yet</div>`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  async function load() {
    try {
      const data = await get(`/api/site/${encodeURIComponent(siteId)}?days=365`);
      renderSite(data);
      document.documentElement.dataset.insightsReady = "true";
    } catch (error) {
      console.warn("GitHub Page Insights unavailable:", error);
      set("insightTotalViews", "—");
      set("insightVisitors", "—");
      set("insightSessions", "—");
      set("insightTodayViews", "—");
      set("insightRangeLabel", "Analytics unavailable");
      set("insightLastSeen", "Worker unavailable");
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    load();
    const refresh = Math.max(30000, Number(window.PAGE_INSIGHTS_CONFIG?.refreshMs || 60000));
    setInterval(load, refresh);
  });
})();
