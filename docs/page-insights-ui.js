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
  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  const number = (value) =>
    Number(value || 0).toLocaleString("en-US");

  const clamp = (n, min, max) =>
    Math.min(max, Math.max(min, n));

  function duration(ms) {
    const seconds = Math.max(
      0,
      Math.round(Number(ms || 0) / 1000)
    );

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;

    if (minutes < 60) {
      return `${minutes}m ${String(rest).padStart(2, "0")}s`;
    }

    const hours = Math.floor(minutes / 60);

    return `${hours}h ${minutes % 60}m`;
  }

  function safeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
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

  async function get(path) {
    const response = await fetch(`${worker}${path}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Insights HTTP ${response.status}`
      );
    }

    return response.json();
  }

  function setConnection(ok) {
    const status = $("insightConnectionStatus");

    if (!status) return;

    if (ok) {
      status.classList.remove("offline");
      status.innerHTML = `<i></i> Connected`;
    } else {
      status.classList.add("offline");
      status.innerHTML = `<i></i> Offline`;
    }
  }

  function getSeries(data) {
    const series = Array.isArray(data?.series)
      ? data.series
      : [];

    return series
      .map((item) => ({
        date: item.date || item.day || item.label || "",
        views: Number(item.views || 0),
        visitors: Number(
          item.uniqueVisitors ||
          item.visitors ||
          item.unique_visitors ||
          0
        ),
        sessions: Number(
          item.sessions || 0
        )
      }))
      .filter((item) => item.date)
      .sort((a, b) =>
        String(a.date).localeCompare(
          String(b.date)
        )
      );
  }

  function sumLast(series, days, field = "views") {
    return series
      .slice(-days)
      .reduce(
        (sum, item) =>
          sum + Number(item[field] || 0),
        0
      );
  }

  function calculateToday(series) {
    if (!series.length) return null;

    const latest =
      series[series.length - 1];

    return latest;
  }

  function calculateAverageVisit(data) {
    const visits = Array.isArray(
      data?.recentVisits
    )
      ? data.recentVisits
      : [];

    const durations = visits
      .map((visit) => Number(
        visit.durationMs ??
        visit.duration ??
        0
      ))
      .filter((value) => value > 0);

    if (!durations.length) {
      return "—";
    }

    const average =
      durations.reduce(
        (sum, value) => sum + value,
        0
      ) / durations.length;

    return duration(average);
  }

  function calculateAverage(data, field) {
    const visits = Array.isArray(
      data?.recentVisits
    )
      ? data.recentVisits
      : [];

    const values = visits
      .map((visit) => Number(visit[field] || 0))
      .filter(Number.isFinite);

    if (!values.length) return "—";

    const average =
      values.reduce(
        (sum, value) => sum + value,
        0
      ) / values.length;

    return Math.round(average).toLocaleString("en-US");
  }

  function renderSparkline(series) {
    const line = $("insightLine");
    const area = $("insightArea");

    if (!line || !area) return;

    const values = series
      .slice(-30)
      .map((item) => Number(item.views || 0));

    if (!values.length) {
      line.setAttribute(
        "points",
        "0,150 600,150"
      );
      area.setAttribute(
        "d",
        "M0,150 L600,150 Z"
      );
      return;
    }

    const max = Math.max(
      1,
      ...values
    );

    const points = values.map(
      (value, index) => {
        const x = values.length === 1
          ? 300
          : (index / (values.length - 1)) * 600;

        const y =
          138 -
          (value / max) * 112;

        return `${x.toFixed(1)},${clamp(
          y,
          20,
          140
        ).toFixed(1)}`;
      }
    );

    line.setAttribute(
      "points",
      points.join(" ")
    );

    const first = points[0].split(",");
    const last = points[points.length - 1].split(",");

    area.setAttribute(
      "d",
      `M${first[0]},150 L${points.join(" L")} L${last[0]},150 Z`
    );
  }

  function renderDevices(data) {
    const container = $("insightDevices");

    if (!container) return;

    const source = data?.devices || {};

    const entries = Array.isArray(source)
      ? source.map((item) => [
          item.name || item.device || "Unknown",
          Number(item.count || item.views || item.value || 0)
        ])
      : Object.entries(source).map(
          ([name, value]) => [
            name,
            Number(value || 0)
          ]
        );

    entries.sort(
      (a, b) => b[1] - a[1]
    );

    const total = entries.reduce(
      (sum, [, value]) => sum + value,
      0
    );

    set(
      "insightDeviceTotal",
      `${number(total)} events`
    );

    if (!entries.length) {
      container.innerHTML =
        `<div class="insight-empty">No device data yet</div>`;
      return;
    }

    container.innerHTML = entries
      .slice(0, 6)
      .map(([name, value]) => {
        const percent = total
          ? Math.round(
              (value / total) * 100
            )
          : 0;

        return `
          <div class="insight-device-row">
            <div class="insight-device-name">
              <span>${escapeHtml(name)}</span>
              <b>${percent}%</b>
            </div>
            <i><em style="width:${percent}%"></em></i>
          </div>
        `;
      })
      .join("");
  }

  function renderTopPages(data) {
    const container = $("insightTopPages");

    if (!container) return;

    let source = data?.topPages;

    if (!source) {
      source = data?.pages;
    }

    let entries = [];

    if (Array.isArray(source)) {
      entries = source.map((item) => ({
        path:
          item.path ||
          item.page ||
          item.url ||
          "Unknown",
        views: Number(
          item.views ||
          item.count ||
          item.value ||
          0
        )
      }));
    } else if (source && typeof source === "object") {
      entries = Object.entries(source)
        .map(([path, views]) => ({
          path,
          views: Number(views || 0)
        }));
    }

    entries.sort(
      (a, b) => b.views - a.views
    );

    if (!entries.length) {
      container.innerHTML =
        `<div class="insight-empty">Top-page data is not available yet</div>`;
      return;
    }

    const max = Math.max(
      1,
      ...entries.map((item) => item.views)
    );

    container.innerHTML = entries
      .slice(0, 6)
      .map((item, index) => {
        const percent = Math.round(
          (item.views / max) * 100
        );

        return `
          <div class="insight-list-row">
            <div class="insight-rank">${index + 1}</div>
            <div class="insight-list-main">
              <strong>${escapeHtml(item.path)}</strong>
              <i><em style="width:${percent}%"></em></i>
            </div>
            <b>${number(item.views)}</b>
          </div>
        `;
      })
      .join("");
  }

  function renderRecentVisits(data) {
    const container = $("insightRecentVisits");

    if (!container) return;

    const visits = Array.isArray(
      data?.recentVisits
    )
      ? data.recentVisits
      : [];

    if (!visits.length) {
      container.innerHTML =
        `<div class="insight-empty">No visits recorded yet</div>`;
      return;
    }

    set(
      "insightLastSeen",
      safeDate(visits[0].ts || visits[0].timestamp)
    );

    container.innerHTML = visits
      .slice(0, 6)
      .map((visit) => {
        const path =
          visit.path ||
          visit.page ||
          "/";

        const when =
          visit.ts ||
          visit.timestamp;

        const durationValue = Number(
          visit.durationMs ??
          visit.duration ??
          0
        );

        const scroll = Number(
          visit.maxScroll ??
          visit.scroll ??
          0
        );

        return `
          <div class="insight-list-row recent-row">
            <div class="recent-dot"></div>
            <div class="insight-list-main">
              <strong>${escapeHtml(path)}</strong>
              <small>${escapeHtml(safeDate(when))}</small>
            </div>
            <b>${durationValue ? escapeHtml(duration(durationValue)) : `${Math.round(scroll)}%`}</b>
          </div>
        `;
      })
      .join("");
  }

  function renderSite(data) {
    const series = getSeries(data);
    const today = calculateToday(series);

    const totalViews = Number(
      data.views ||
      data.totalViews ||
      0
    );

    const visitors = Number(
      data.uniqueVisitors ||
      data.visitors ||
      data.unique_visitors ||
      0
    );

    const sessions = Number(
      data.sessions || 0
    );

    const todayViews = today
      ? today.views
      : Number(data.today?.views || 0);

    const last7 = sumLast(series, 7);
    const last30 = sumLast(series, 30);

    set("insightTotalViews", number(totalViews));
    set("insightVisitors", number(visitors));
    set("insightSessions", number(sessions));
    set("insightTodayViews", number(todayViews));
    set("insight7d", number(last7));
    set("insight30d", number(last30));

    set(
      "insightRangeLabel",
      series.length
        ? `Analytics window: ${series.length} recorded days`
        : "Analytics window unavailable"
    );

    set(
      "insightTodaySub",
      today
        ? `${number(today.visitors)} unique • ${number(today.sessions)} sessions`
        : "No daily breakdown yet"
    );

    const avgDuration =
      calculateAverageVisit(data);

    set(
      "insightAvgDuration",
      avgDuration
    );

    set(
      "insightAvgScroll",
      `${calculateAverage(data, "maxScroll")}%`
    );

    set(
      "insightAvgClicks",
      calculateAverage(data, "clicks")
    );

    set(
      "insight7dDelta",
      series.length >= 14
        ? `vs previous 7d: ${number(
            last7 - sumLast(series.slice(0, -7), 7)
          )}`
        : "7-day window"
    );

    set(
      "insight30dDelta",
      series.length
        ? `${number(series.length)} recorded days`
        : "30-day window"
    );

    renderSparkline(series);
    renderDevices(data);
    renderTopPages(data);
    renderRecentVisits(data);

    set(
      "insightFreshness",
      `Updated ${safeDate(new Date().toISOString())}`
    );

    setConnection(true);
    document.documentElement.dataset.insightsReady = "true";
  }

  async function load() {
    try {
      const data = await get(
        `/api/site/${encodeURIComponent(siteId)}?days=365`
      );

      renderSite(data);

    } catch (error) {
      console.warn(
        "GitHub Page Insights unavailable:",
        error
      );

      setConnection(false);

      const fallback = "—";

      [
        "insightTotalViews",
        "insightVisitors",
        "insightSessions",
        "insightTodayViews",
        "insight7d",
        "insight30d",
        "insightAvgDuration",
        "insightAvgScroll",
        "insightAvgClicks"
      ].forEach((id) => set(id, fallback));

      set(
        "insightRangeLabel",
        "Analytics unavailable"
      );

      set(
        "insightFreshness",
        "Worker unavailable"
      );

      set(
        "insightTodaySub",
        "Unable to load traffic data"
      );
    }
  }

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      load();

      const refresh = Math.max(
        30000,
        Number(
          window.PAGE_INSIGHTS_CONFIG?.refreshMs ||
          60000
        )
      );

      window.setInterval(
        load,
        refresh
      );
    },
    { once: true }
  );

})();
