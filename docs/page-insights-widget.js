(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const cfg = window.PAGE_INSIGHTS_CONFIG || {};
  const worker = String(cfg.workerUrl || "").replace(/\/+$/, "");
  const siteId = encodeURIComponent(cfg.siteId || "imdb-showcase");
  const fmt = value => Number(value || 0).toLocaleString("en-US");
  const status = (kind, label) => { const el = $("insightsStatus"); if (!el) return; el.className = `insights-status ${kind}`; el.innerHTML = `<i></i><span>${label}</span>`; };
  async function load(){
    if (!worker) { status("error","Worker تنظیم نشده"); return; }
    try {
      const res = await fetch(`${worker}/api/site/${siteId}?days=30`,{cache:"no-store"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      $("piViews").textContent = fmt(d.views);
      $("piVisitors").textContent = fmt(d.uniqueVisitors);
      $("piToday").textContent = fmt(d.today?.views);
      $("piTodayMeta").textContent = `${fmt(d.today?.uniqueVisitors)} بازدیدکننده یکتا`;
      $("piSessions").textContent = fmt(d.sessions);
      status("ok",`LIVE • ${new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`);
    } catch(error){
      console.warn("Page Insights unavailable",error);
      status("warn","داده بازدید موقتاً در دسترس نیست");
    }
  }
  document.addEventListener("DOMContentLoaded",()=>{ load(); setInterval(load, Number(cfg.refreshMs || 60000)); });
})();
