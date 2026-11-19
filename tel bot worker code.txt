var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var VERSION = "2.0.1";
var SEARCH_PAGE_SIZE = 8;
var MAX_DETAIL_CHARS = 3600;
var MAX_IMPORT_ROWS = 25e3;
var DEFAULT_IMPORT_LIMIT = 8 * 1024 * 1024;
var DATA_CACHE_MS = 45e3;
var isolateDatasetCache = { at: 0, data: null };
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({
        ok: true,
        service: "imdb-showcase-telegram-bot",
        version: VERSION,
        time: (/* @__PURE__ */ new Date()).toISOString(),
        databaseConfigured: Boolean(env.DB),
        botTokenConfigured: Boolean(env.BOT_TOKEN),
        githubImportConfigured: Boolean(env.GITHUB_TOKEN),
        schedulerMode: "github-actions-http",
        schedulerConfigured: Boolean(env.WORKER_PING_SECRET)
      });
    }
    if (request.method === "POST" && url.pathname === "/internal/scheduled") {
      const expected = String(env.WORKER_PING_SECRET || "");
      const received = request.headers.get("X-Worker-Ping-Secret") || "";
      if (!expected || !safeEqual(received, expected)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      if (!env.DB || !env.BOT_TOKEN) {
        return json({ ok: false, error: "scheduler_not_configured" }, 503);
      }
      try {
        await runScheduled(env);
        return json({ ok: true, task: "notification-scheduler", version: VERSION, completedAt: (/* @__PURE__ */ new Date()).toISOString() });
      } catch (error) {
        safeLog("http_scheduler_failed", error);
        return json({ ok: false, error: "scheduled_task_failed", version: VERSION }, 500);
      }
    }
    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      const expected = String(env.WEBHOOK_SECRET || "");
      const received = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (!expected || !safeEqual(received, expected)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      let update;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      ctx.waitUntil(processUpdate(update, env).catch((error) => safeLog("update_failed", error)));
      return json({ ok: true });
    }
    return json({ ok: false, error: "not_found" }, 404);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env).catch((error) => safeLog("scheduled_failed", error)));
  }
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(json, "json");
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(safeEqual, "safeEqual");
function safeLog(code, error) {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  console.error(JSON.stringify({ code, message: message.slice(0, 220), at: (/* @__PURE__ */ new Date()).toISOString() }));
}
__name(safeLog, "safeLog");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function num(value, fallback = 0) {
  const n = Number.parseFloat(String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] || "");
  return Number.isFinite(n) ? n : fallback;
}
__name(num, "num");
function text(value, fallback = "") {
  if (value === void 0 || value === null) return fallback;
  const out = String(value).replace(/\u0000/g, "").trim();
  if (!out || out.toUpperCase() === "N/A" || out === "\u2014") return fallback;
  return out;
}
__name(text, "text");
function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
__name(html, "html");
function truncate(value, max = 180) {
  const s = text(value);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s;
}
__name(truncate, "truncate");
function intFmt(value) {
  return Math.round(num(value)).toLocaleString("en-US");
}
__name(intFmt, "intFmt");
function ratingEmoji(value) {
  const rating = num(value, -1);
  if (rating >= 9) return "\u{1F3C6}";
  if (rating >= 8) return "\u{1F525}";
  if (rating >= 7) return "\u2B50";
  if (rating >= 5) return "\u{1F642}";
  if (rating > 0) return "\u{1F610}";
  return "\u25AB\uFE0F";
}
__name(ratingEmoji, "ratingEmoji");
function dateStamp(value) {
  const raw = text(value);
  if (!raw) return "\u2014";
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" }).format(date);
}
__name(dateStamp, "dateStamp");
function runtimeMinutes(movie) {
  const raw = text(movie?.runtime) || text(movie?.raw_omdb?.Runtime) || text(movie?.raw_csv?.["Runtime (mins)"]);
  const n = num(raw, 0);
  return Math.max(0, n);
}
__name(runtimeMinutes, "runtimeMinutes");
function runtimeHuman(minutes) {
  const value = Math.max(0, Math.round(minutes));
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  if (mins) return `${mins}m`;
  return "\u2014";
}
__name(runtimeHuman, "runtimeHuman");
function imdbId(movie) {
  return text(movie?.imdb_id) || text(movie?.raw_csv?.Const) || text(movie?.raw_omdb?.imdbID);
}
__name(imdbId, "imdbId");
function titleOf(movie) {
  return text(movie?.title) || text(movie?.raw_csv?.Title) || text(movie?.raw_omdb?.Title, "Untitled");
}
__name(titleOf, "titleOf");
function originalTitle(movie) {
  return text(movie?.original_title) || text(movie?.raw_csv?.["Original Title"]) || titleOf(movie);
}
__name(originalTitle, "originalTitle");
function yearOf(movie) {
  const raw = text(movie?.year) || text(movie?.raw_csv?.Year) || text(movie?.raw_omdb?.Year);
  return raw.match(/\b\d{4}\b/)?.[0] || raw || "\u2014";
}
__name(yearOf, "yearOf");
function userRating(movie) {
  return num(movie?.user_rating ?? movie?.raw_csv?.["Your Rating"], 0);
}
__name(userRating, "userRating");
function imdbRating(movie) {
  return text(movie?.imdb_rating) || text(movie?.raw_omdb?.imdbRating);
}
__name(imdbRating, "imdbRating");
function voteCountOf(movie) {
  return Math.max(0, num(movie?.num_votes ?? movie?.raw_csv?.["Num Votes"] ?? movie?.raw_omdb?.imdbVotes, 0));
}
__name(voteCountOf, "voteCountOf");
function dateRatedOf(movie) {
  return text(movie?.date_rated) || text(movie?.raw_csv?.["Date Rated"]);
}
__name(dateRatedOf, "dateRatedOf");
function ratingMetrics(movie, now = Date.now()) {
  const personalRating = Math.max(0, Math.min(10, userRating(movie)));
  const imdb = Math.max(0, Math.min(10, num(imdbRating(movie), 0)));
  const votes = voteCountOf(movie);
  const voteConfidence = votes / (votes + 1000);
  const adjustedImdb = voteConfidence * (imdb || 6.5) + (1 - voteConfidence) * 6.5;
  const baseScore = personalRating > 0 ? personalRating * 0.65 + adjustedImdb * 0.35 : adjustedImdb;
  const ratedRaw = dateRatedOf(movie);
  const ratedAt = dateValue(ratedRaw);
  const ageDays = ratedAt > 0 ? Math.max(0, (now - ratedAt) / 86400000) : null;
  const freshnessBonus = personalRating > 0 && ageDays !== null ? 0.20 * Math.exp(-ageDays / 1095) : 0;
  return {
    score: Math.max(0, Math.min(10, baseScore + freshnessBonus)),
    baseScore, personalRating, imdbRating: imdb, adjustedImdb, votes,
    voteConfidence, freshnessBonus, ageDays, ratedAt
  };
}
__name(ratingMetrics, "ratingMetrics");
function compareVaultRank(a, b) {
  const A = ratingMetrics(a), B = ratingMetrics(b);
  return (B.score - A.score) || (B.votes - A.votes) || ((B.ratedAt || 0) - (A.ratedAt || 0)) || (B.personalRating - A.personalRating);
}
__name(compareVaultRank, "compareVaultRank");
function dateTimeStamp(value) {
  const raw = text(value);
  if (!raw) return "unknown time";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Tehran" }).format(date)} · ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tehran" }).format(date)} (Tehran)`;
}
__name(dateTimeStamp, "dateTimeStamp");
function formatVoteCount(value) {
  return Math.round(num(value)).toLocaleString("en-US");
}
__name(formatVoteCount, "formatVoteCount");
function genresOf(movie) {
  const source = movie?.genres ?? movie?.raw_omdb?.Genre ?? movie?.raw_csv?.Genres ?? "";
  if (Array.isArray(source)) return source.map((x) => text(x)).filter(Boolean);
  return String(source).split(",").map((x) => text(x)).filter(Boolean);
}
__name(genresOf, "genresOf");
function typeOf(movie) {
  return text(movie?.title_type) || text(movie?.raw_csv?.["Title Type"]) || text(movie?.raw_omdb?.Type);
}
__name(typeOf, "typeOf");
function posterCandidates(movie, env) {
  const local = text(movie?.poster_local);
  const rawRemote = text(movie?.raw_omdb?.Poster);
  const remote = text(movie?.poster);
  const localUrl = local ? `${String(env.SITE_URL || "https://mehrdadmb2.github.io/imdb-showcase").replace(/\/$/, "")}/${local.replace(/^\//, "")}` : "";
  return [...new Set([rawRemote, remote, localUrl].filter((x) => /^https:\/\//i.test(x) && !/^https:\/\/.*\/undefined$/i.test(x)))];
}
__name(posterCandidates, "posterCandidates");
function safeHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-dataset-url";
  }
}
__name(safeHost, "safeHost");
async function loadDataset(env, force = false) {
  if (!force && isolateDatasetCache.data && Date.now() - isolateDatasetCache.at < DATA_CACHE_MS) return isolateDatasetCache.data;
  const rawUrl = String(env.DATA_URL || "https://raw.githubusercontent.com/mehrdadmb2/imdb-showcase/main/docs/movies.json");
  const siteUrl = `${String(env.SITE_URL || "https://mehrdadmb2.github.io/imdb-showcase").replace(/\/$/, "")}/movies.json`;
  const sourceList = [rawUrl, siteUrl];
  let lastError = "dataset_unavailable";
  for (const source of sourceList) {
    try {
      const candidate = new URL(source);
      candidate.searchParams.set("_bot_cache", String(Math.floor(Date.now() / 6e4)));
      const response = await fetch(candidate.toString(), {
        headers: { "accept": "application/json", "cache-control": "no-cache", "user-agent": `IMDb-Showcase-Telegram/${VERSION}` },
        cf: { cacheTtl: 45, cacheEverything: true },
        signal: AbortSignal.timeout(15e3)
      });
      if (!response.ok) {
        lastError = `dataset_http_${response.status}`;
        continue;
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.movies) || data.movies.length === 0) {
        lastError = "dataset_schema_invalid_or_empty";
        continue;
      }
      const normalized = { ...data, movies: data.movies.filter((m) => imdbId(m) && titleOf(m)) };
      if (!normalized.movies.length) {
        lastError = "dataset_has_no_valid_records";
        continue;
      }
      isolateDatasetCache = { at: Date.now(), data: normalized };
      return normalized;
    } catch (error) {
      lastError = error?.name === "TimeoutError" ? "dataset_timeout" : "dataset_fetch_failed";
      safeLog("dataset_source_failed", new Error(`${lastError} (${safeHost(source)})`));
    }
  }
  throw new Error(lastError);
}
__name(loadDataset, "loadDataset");
function movieById(movies, id) {
  const wanted = String(id || "").toLowerCase();
  return movies.find((m) => imdbId(m).toLowerCase() === wanted) || null;
}
__name(movieById, "movieById");
function makeToken() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}
__name(makeToken, "makeToken");
async function makeSearchSession(env, chatId, mode, query = "") {
  const token = makeToken();
  await env.DB.prepare("INSERT INTO search_sessions(token, chat_id, query, mode, created_at) VALUES (?, ?, ?, ?, ?)").bind(token, String(chatId), String(query).slice(0, 100), mode, nowIso()).run();
  return token;
}
__name(makeSearchSession, "makeSearchSession");
async function getSearchSession(env, token, chatId) {
  return env.DB.prepare("SELECT token, chat_id, query, mode, created_at FROM search_sessions WHERE token = ? AND chat_id = ?").bind(String(token), String(chatId)).first();
}
__name(getSearchSession, "getSearchSession");
function queryKey(value) {
  const raw = String(value || "").trim();
  const id = raw.match(/tt\d{5,}/i);
  if (id) return id[0].toLowerCase();
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/title\/(tt\d+)/i);
    if (match) return match[1].toLowerCase();
  } catch {
  }
  return raw.toLowerCase();
}
__name(queryKey, "queryKey");
function searchable(movie) {
  const raw = movie.raw_csv || {};
  const omdb = movie.raw_omdb || {};
  return [
    titleOf(movie),
    originalTitle(movie),
    imdbId(movie),
    movie.series_title,
    movie.series_id,
    movie.plot,
    movie.actors,
    movie.directors,
    movie.writer,
    genresOf(movie).join(" "),
    movie.country,
    raw.Title,
    raw["Original Title"],
    raw.Const,
    raw.Directors,
    raw.Genres,
    omdb.Title,
    omdb.Actors,
    omdb.Director,
    omdb.Writer,
    omdb.Genre,
    omdb.Plot
  ].filter(Boolean).join(" ").toLowerCase();
}
__name(searchable, "searchable");
function scoreMatch(movie, query) {
  const q = queryKey(query);
  const id = imdbId(movie).toLowerCase();
  const title = titleOf(movie).toLowerCase();
  const original = originalTitle(movie).toLowerCase();
  if (id === q) return 1e3;
  if (title === q) return 900;
  if (original === q) return 850;
  if (title.startsWith(q)) return 700;
  if (original.startsWith(q)) return 650;
  if (title.includes(q)) return 500;
  if (original.includes(q)) return 450;
  return 100;
}
__name(scoreMatch, "scoreMatch");
function sortedSearch(movies, query) {
  const q = queryKey(query);
  if (!q) return [];
  return movies.filter((m) => searchable(m).includes(q)).sort((a, b) => scoreMatch(b, query) - scoreMatch(a, query) || userRating(b) - userRating(a) || dateValue(b.date_rated) - dateValue(a.date_rated));
}
__name(sortedSearch, "sortedSearch");
function dateValue(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
__name(dateValue, "dateValue");
async function resolveResults(env, session, chatId) {
  const data = await loadDataset(env);
  let rows = data.movies;
  switch (session.mode) {
    case "latest":
      return rows.filter((m) => text(m.date_rated || m.raw_csv?.["Date Rated"])).sort((a, b) => dateValue(b.date_rated || b.raw_csv?.["Date Rated"]) - dateValue(a.date_rated || a.raw_csv?.["Date Rated"]));
    case "top":
      return rows.filter((m) => userRating(m) > 0).sort(compareVaultRank);
    case "series":
      return rows.filter((m) => typeOf(m).toLowerCase().includes("series")).sort((a, b) => compareVaultRank(a, b) || titleOf(a).localeCompare(titleOf(b)));
    case "genre": {
      const genre = String(session.query || "").toLowerCase();
      return rows.filter((m) => genresOf(m).some((g) => g.toLowerCase() === genre || g.toLowerCase().includes(genre))).sort(compareVaultRank);
    }
    case "favorites": {
      const favs = await env.DB.prepare("SELECT imdb_id FROM favorites WHERE chat_id = ? ORDER BY saved_at DESC").bind(String(chatId)).all();
      const ids = new Set((favs.results || []).map((r) => r.imdb_id));
      return rows.filter((m) => ids.has(imdbId(m)));
    }
    case "search":
    default:
      return sortedSearch(rows, session.query);
  }
}
__name(resolveResults, "resolveResults");
async function telegram(env, method, payload = {}) {
  if (!env.BOT_TOKEN) throw new Error("bot_token_not_configured");
  const endpoint = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12e3)
    });
  } catch (error) {
    throw new Error(`telegram_network_${error?.name || "error"}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`telegram_bad_response_${response.status}`);
  }
  if (!response.ok || body?.ok !== true) {
    const error = new Error(`telegram_${body?.error_code || response.status}:${String(body?.description || "api_error").slice(0, 160)}`);
    error.telegramCode = body?.error_code || response.status;
    error.retryAfter = body?.parameters?.retry_after || 0;
    throw error;
  }
  return body.result;
}
__name(telegram, "telegram");
async function sendMessage(env, chatId, message, extra = {}) {
  const clipped = String(message || "").slice(0, 4e3);
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text: clipped,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}
__name(sendMessage, "sendMessage");
async function answerCallback(env, callbackId, textValue = "", showAlert = false) {
  try {
    return await telegram(env, "answerCallbackQuery", {
      callback_query_id: callbackId,
      text: String(textValue).slice(0, 180),
      show_alert: showAlert
    });
  } catch (error) {
    safeLog("callback_answer_failed", error);
  }
}
__name(answerCallback, "answerCallback");
function baseKeyboard(env) {
  const site = String(env.SITE_URL || "https://mehrdadmb2.github.io/imdb-showcase").replace(/\/$/, "");
  return { inline_keyboard: [
    [{ text: "\u{1F50E} Search", callback_data: "cmd:search" }, { text: "\u{1F195} Latest", callback_data: "cmd:latest" }],
    [{ text: "\u{1F3C6} Top Vault Rank", callback_data: "cmd:top" }, { text: "\u{1F4CA} Library Stats", callback_data: "cmd:stats" }],
    [{ text: "\u{1F514} New-title alerts", callback_data: "sub:toggle" }, { text: "\u{1F310} Open website", url: site }]
  ] };
}
__name(baseKeyboard, "baseKeyboard");
async function upsertSubscriber(env, message, notifications = 1) {
  const chatId = String(message.chat.id);
  const from = message.from || {};
  const stamp = nowIso();
  await env.DB.prepare(`INSERT INTO subscribers(chat_id, user_id, username, first_name, notifications, blocked, joined_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET user_id=excluded.user_id, username=excluded.username, first_name=excluded.first_name, notifications=excluded.notifications, blocked=0, last_seen_at=excluded.last_seen_at`).bind(chatId, String(from.id || ""), text(from.username), text(from.first_name), notifications, stamp, stamp).run();
}
__name(upsertSubscriber, "upsertSubscriber");
async function touchSubscriber(env, message) {
  if (!message?.chat?.id || message.chat.type !== "private") return;
  const from = message.from || {};
  await env.DB.prepare(`INSERT INTO subscribers(chat_id, user_id, username, first_name, notifications, blocked, joined_at, last_seen_at)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET user_id=excluded.user_id, username=excluded.username, first_name=excluded.first_name, last_seen_at=excluded.last_seen_at`).bind(String(message.chat.id), String(from.id || ""), text(from.username), text(from.first_name), nowIso(), nowIso()).run();
}
__name(touchSubscriber, "touchSubscriber");
function isAdmin(env, userId) {
  const adminIds = String(env.ADMIN_IDS || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  return adminIds.includes(String(userId || ""));
}
__name(isAdmin, "isAdmin");
async function consumeRateLimit(env, chatId, maxHits) {
  if (!chatId) return true;
  const key = String(chatId);
  const windowStart = Math.floor(Date.now() / 6e4) * 6e4;
  await env.DB.prepare(`INSERT INTO rate_limits(chat_id, window_start, hits) VALUES (?, ?, 1)
    ON CONFLICT(chat_id) DO UPDATE SET hits = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.hits + 1 ELSE 1 END,
    window_start = excluded.window_start`).bind(key, windowStart).run();
  const state = await env.DB.prepare("SELECT hits FROM rate_limits WHERE chat_id=?").bind(key).first();
  return Number(state?.hits || 0) <= maxHits;
}
__name(consumeRateLimit, "consumeRateLimit");
async function processUpdate(update, env) {
  if (!env.DB) throw new Error("d1_binding_missing");
  if (update?.update_id !== void 0) {
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO processed_updates(update_id, processed_at) VALUES (?, ?)").bind(Number(update.update_id), nowIso()).run();
    if (inserted.meta?.changes === 0) return;
  }
  if (update?.callback_query) return handleCallback(update.callback_query, env);
  const message = update?.message || update?.edited_message;
  if (!message) return;
  if (message.chat?.type === "private") await touchSubscriber(env, message);
  if (message.document) return handleDocument(message, env);
  const isAdminUser = isAdmin(env, message.from?.id);
  const allowed = await consumeRateLimit(env, message.chat?.id, isAdminUser ? 60 : 24);
  if (!allowed) return sendMessage(env, message.chat.id, "\u23F3 You are sending requests too quickly. Please wait a minute and try again.").catch(() => null);
  const incoming = text(message.text);
  if (!incoming) return;
  const chatId = message.chat.id;
  const parts = incoming.split(/\s+/);
  const command = parts[0].split("@")[0].toLowerCase();
  const query = incoming.slice(parts[0].length).trim();
  try {
    switch (command) {
      case "/start":
        if (message.chat.type === "private") await upsertSubscriber(env, message, 1);
        return sendMessage(
          env,
          chatId,
          `\u{1F3AC} <b>Welcome to Cinema Vault</b>
<blockquote>Your personal IMDb Showcase library \u2014 search titles, explore ratings, and receive new-title alerts.</blockquote>

\u{1F50E} Send a movie title, an IMDb ID like <code>tt0133093</code>, or a full IMDb title link.

\u{1F514} Starting the bot enables new-title notifications. Use /unsubscribe to turn them off at any time.`,
          { reply_markup: baseKeyboard(env) }
        );
      case "/help":
        return sendMessage(env, chatId, helpText(isAdmin(env, message.from?.id)), { reply_markup: baseKeyboard(env) });
      case "/id":
        return sendMessage(env, chatId, `\u{1FAAA} <b>Your Telegram ID</b>
<pre>${html(message.from?.id || "unknown")}</pre>Share this number with the bot owner only if you need admin access.`);
      case "/search":
      case "/find":
        if (!query) return sendMessage(env, chatId, "\u{1F50E} Send a search term after the command.\nExample: <code>/search The Grand Budapest Hotel</code>\n\nYou can also send a title or IMDb URL directly.");
        return showList(env, chatId, "search", query, 0);
      case "/latest":
        return showList(env, chatId, "latest", "", 0);
      case "/top":
        return showList(env, chatId, "top", "", 0);
      case "/series":
        return showList(env, chatId, "series", "", 0);
      case "/genres":
        return showGenres(env, chatId);
      case "/genre":
        if (!query) return showGenres(env, chatId);
        return showList(env, chatId, "genre", query, 0);
      case "/stats":
        return showStats(env, chatId);
      case "/random":
        return showRandom(env, chatId);
      case "/subscribe":
        if (message.chat.type !== "private") return sendMessage(env, chatId, "\u{1F514} Notifications are enabled for private chats only. Open the bot privately and use /subscribe.");
        await upsertSubscriber(env, message, 1);
        return sendMessage(env, chatId, "\u2705 <b>New-title alerts enabled.</b> I will send newly added titles after the repository dataset updates. Use /unsubscribe to pause alerts.");
      case "/unsubscribe":
        if (message.chat.type !== "private") return sendMessage(env, chatId, "Manage notification settings in a private chat with the bot.");
        await env.DB.prepare("UPDATE subscribers SET notifications=0, last_seen_at=? WHERE chat_id=?").bind(nowIso(), String(chatId)).run();
        await env.DB.prepare("UPDATE notification_queue SET status='failed', last_error='user_unsubscribed' WHERE chat_id=? AND status='pending'").bind(String(chatId)).run();
        return sendMessage(env, chatId, "\u{1F515} New-title alerts are now paused. Pending alerts were cancelled; you can still search the library. Use /subscribe to enable them again.");
      case "/mylist":
        return showList(env, chatId, "favorites", "", 0);
      case "/import":
        if (!isAdmin(env, message.from?.id)) return sendMessage(env, chatId, "\u26D4 This command is restricted to the repository administrator.");
        return sendMessage(env, chatId, "\u{1F4E5} <b>IMDb CSV import</b>\nSend the exported IMDb ratings file as a Telegram document with a <code>.csv</code> extension. I will validate the CSV, replace only <code>src/ratings.csv</code> in the configured repository, then dispatch the existing GitHub Actions workflow.\n\n\u26A0\uFE0F This operation changes the dataset source for the website. Git history keeps the previous committed file.");
      case "/adminstatus":
        if (!isAdmin(env, message.from?.id)) return sendMessage(env, chatId, "\u26D4 Admin only.");
        return showAdminStatus(env, chatId);
      case "/about":
        return sendMessage(env, chatId, `\u{1F39E}\uFE0F <b>${html(text(env.BOT_DISPLAY_NAME, "Cinema Vault"))}</b>
Personal library powered by your IMDb ratings export and the repository cache.

\u{1F310} <a href="${html(String(env.SITE_URL || "https://mehrdadmb2.github.io/imdb-showcase"))}">Open IMDb Showcase</a>

Data source: public repository dataset. The bot does not need your OMDb keys.`, { reply_markup: baseKeyboard(env) });
      default:
        if (incoming.startsWith("/")) return sendMessage(env, chatId, "I do not recognize that command. Use /help to see available commands.");
        return showList(env, chatId, "search", incoming, 0);
    }
  } catch (error) {
    safeLog("message_handler_failed", error);
    return sendMessage(env, chatId, "\u26A0\uFE0F I could not complete that request. The dataset or a service may be temporarily unavailable. Please try again shortly.").catch(() => null);
  }
}
__name(processUpdate, "processUpdate");
function helpText(admin = false) {
  const base = [
    "\u{1F9ED} <b>Commands</b>",
    "<code>/search title</code> \u2014 search a title, IMDb ID, or IMDb URL",
    "<code>/latest</code> \u2014 recently rated titles",
    "<code>/top</code> \u2014 ranked by personal + IMDb score, vote confidence and rating recency",
    "<code>/series</code> \u2014 TV series in your library",
    "<code>/genres</code> \u2014 popular genres",
    "<code>/genre Action</code> \u2014 browse a genre",
    "<code>/stats</code> \u2014 library summary",
    "<code>/random</code> \u2014 a random title",
    "<code>/mylist</code> \u2014 your saved titles",
    "<code>/subscribe</code> / <code>/unsubscribe</code> \u2014 new-title alerts",
    "<code>/id</code> \u2014 show your Telegram ID",
    "<code>/about</code> \u2014 website and data source",
    "",
    "\u{1F4A1} Or simply send a title, an IMDb ID, or a title URL as a message.",
    "\u{1F3AF} Top lists use Vault Rank: personal rating + vote-weighted IMDb score + a limited recency bonus."
  ];
  if (admin) base.push("", "\u{1F6E1}\uFE0F <b>Admin</b>", "<code>/import</code> \u2014 import an IMDb CSV document", "<code>/adminstatus</code> \u2014 bot, dataset and import diagnostics");
  return base.join("\n");
}
__name(helpText, "helpText");
async function showList(env, chatId, mode, query, offset, editMessageId = null, token = null) {
  const searchToken = token || await makeSearchSession(env, chatId, mode, query);
  const session = await getSearchSession(env, searchToken, chatId);
  if (!session) return sendMessage(env, chatId, "This search expired. Run the command again.");
  const rows = await resolveResults(env, session, chatId);
  const total = rows.length;
  const start = Math.max(0, Math.min(Number(offset) || 0, Math.max(0, total - 1)));
  const pageRows = rows.slice(start, start + SEARCH_PAGE_SIZE);
  const modeLabel = { search: `\u{1F50E} Results for \u201C${truncate(query, 60)}\u201D`, latest: "\u{1F195} Latest rated titles", top: "\u{1F3C6} Top titles by Vault Rank", series: "\u{1F4FA} Series in your library", genre: `\u{1F3AD} ${query}`, favorites: "\u2B50 My saved titles" }[mode] || "\u{1F3AC} Library";
  const lines = [`<b>${html(modeLabel)}</b>`, `<i>${intFmt(total)} matching title(s) \u2022 Page ${Math.floor(start / SEARCH_PAGE_SIZE) + 1}/${Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE))}</i>`, ""];
  const keyboard = [];
  if (!total) lines.push("No matching titles were found. Try a shorter title, original title, or IMDb ID.");
  pageRows.forEach((movie, index) => {
    const id = imdbId(movie);
    const rating = userRating(movie);
    const imdb = imdbRating(movie);
    const rank = ratingMetrics(movie);
    lines.push(`${start + index + 1}. ${ratingEmoji(rating)} <b>${html(truncate(titleOf(movie), 72))}</b> (${html(yearOf(movie))})`);
    lines.push(`   👤 You: <b>${rating ? rating.toFixed(1) : "—"}</b>  ·  ⭐ IMDb: <b>${html(imdb || "—")}</b>  ·  🧠 Vault: <b>${rank.score.toFixed(2)}/10</b>`);
    lines.push(`   🗳️ <b>${intFmt(rank.votes)}</b> votes  ·  IMDb adjusted: <b>${rank.adjustedImdb.toFixed(2)}</b>  ·  📅 Rated: <b>${html(dateStamp(dateRatedOf(movie)))}</b>`);
    lines.push(`   <code>${html(id)}</code>`);
    keyboard.push([{ text: `${ratingEmoji(rating)} ${truncate(titleOf(movie), 48)}`, callback_data: `m:${id}` }]);
  });
  const nav = [];
  if (start > 0) nav.push({ text: "\u2B05\uFE0F Previous", callback_data: `p:${searchToken}:${Math.max(0, start - SEARCH_PAGE_SIZE)}` });
  if (start + SEARCH_PAGE_SIZE < total) nav.push({ text: "Next \u27A1\uFE0F", callback_data: `p:${searchToken}:${start + SEARCH_PAGE_SIZE}` });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: "\u{1F50E} New search", callback_data: "cmd:search" }, { text: "\u{1F3E0} Menu", callback_data: "cmd:menu" }]);
  const replyMarkup = { inline_keyboard: keyboard };
  const messageText = lines.join("\n").slice(0, 3900);
  if (editMessageId) {
    try {
      return await telegram(env, "editMessageText", { chat_id: chatId, message_id: editMessageId, text: messageText, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup });
    } catch (error) {
      if (!String(error.message).includes("message is not modified")) safeLog("edit_list_failed", error);
    }
  }
  return sendMessage(env, chatId, messageText, { reply_markup: replyMarkup });
}
__name(showList, "showList");
async function showGenres(env, chatId) {
  const data = await loadDataset(env);
  const counts = /* @__PURE__ */ new Map();
  for (const movie of data.movies) for (const genre of genresOf(movie)) counts.set(genre, (counts.get(genre) || 0) + 1);
  const popular = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  if (!popular.length) return sendMessage(env, chatId, "No genre metadata is available in the current dataset.");
  const lines = ["\u{1F3AD} <b>Popular genres</b>", "Tap a genre to browse matching titles:", ""];
  const keyboard = [];
  for (let i = 0; i < popular.length; i += 2) {
    const row = [];
    for (const [genre, count] of popular.slice(i, i + 2)) {
      const token = await makeSearchSession(env, chatId, "genre", genre);
      row.push({ text: `${genre} \xB7 ${count}`, callback_data: `g:${token}` });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: "\u{1F3E0} Menu", callback_data: "cmd:menu" }]);
  return sendMessage(env, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: keyboard } });
}
__name(showGenres, "showGenres");
async function showStats(env, chatId) {
  const data = await loadDataset(env);
  const movies = data.movies;
  const movieCount = movies.filter((m) => /movie|short|tv movie/i.test(typeOf(m))).length;
  const seriesCount = movies.filter((m) => /tv series|tv mini series/i.test(typeOf(m))).length;
  const episodeCount = movies.filter((m) => /episode/i.test(typeOf(m)) || m.is_episode).length;
  const rated = movies.filter((m) => userRating(m) > 0);
  const imdbRated = movies.filter((m) => num(imdbRating(m), 0) > 0);
  const avg = rated.length ? rated.reduce((sum, m) => sum + userRating(m), 0) / rated.length : 0;
  const avgImdb = imdbRated.length ? imdbRated.reduce((sum, m) => sum + num(imdbRating(m)), 0) / imdbRated.length : 0;
  const avgVault = rated.length ? rated.reduce((sum, m) => sum + ratingMetrics(m).score, 0) / rated.length : 0;
  const totalVotes = movies.reduce((sum, m) => sum + voteCountOf(m), 0);
  const totalMinutes = movies.reduce((sum, m) => sum + runtimeMinutes(m), 0);
  const genres = new Set(movies.flatMap(genresOf));
  const localPosters = movies.filter((m) => text(m.poster_local)).length;
  const enriched = movies.filter((m) => m.omdb_found || m.raw_omdb?.imdbID).length;
  const top = [...rated].sort(compareVaultRank)[0];
  const latest = [...rated].sort((a, b) => dateValue(dateRatedOf(b)) - dateValue(dateRatedOf(a)))[0];
  const message = [
    "📊 <b>IMDb Showcase — Library Intelligence</b>",
    "<blockquote>Statistics and rankings are calculated from the same shared dataset used by the website.</blockquote>",
    `🎞️ Total records: <b>${intFmt(movies.length)}</b>`,
    `🎬 Movies / shorts: <b>${intFmt(movieCount)}</b>`,
    `📺 Series: <b>${intFmt(seriesCount)}</b>`,
    `🎥 Episodes: <b>${intFmt(episodeCount)}</b>`,
    `⭐ Your average: <b>${avg.toFixed(2)}/10</b> (${intFmt(rated.length)} rated)`,
    `🌐 IMDb average: <b>${avgImdb.toFixed(2)}/10</b> (${intFmt(imdbRated.length)} with IMDb score)`,
    `🧠 Average Vault Rank: <b>${avgVault.toFixed(2)}/10</b>`,
    `🗳️ Total IMDb votes: <b>${intFmt(totalVotes)}</b>`,
    `⏱ Runtime: <b>${runtimeHuman(totalMinutes)}</b>`,
    `🎭 Genres: <b>${intFmt(genres.size)}</b>`,
    `🖼 Local posters: <b>${intFmt(localPosters)}</b> / ${intFmt(movies.length)}`,
    `🧩 OMDb enriched: <b>${intFmt(enriched)}</b> / ${intFmt(movies.length)}`,
    top ? "" : "",
    top ? `🏆 Top ranked: <b>${html(titleOf(top))}</b> · Vault <b>${ratingMetrics(top).score.toFixed(2)}</b> · You ${userRating(top).toFixed(1)} · IMDb ${html(imdbRating(top) || "—")} · ${intFmt(voteCountOf(top))} votes` : "🏆 Top ranked: —",
    latest ? `🕒 Latest rating: <b>${html(titleOf(latest))}</b> · ${html(dateStamp(dateRatedOf(latest)))}` : "🕒 Latest rating: —",
    `🗓 Dataset generated: <code>${html(text(data.last_manual_update || data.data_meta?.generated_at, "unknown"))}</code>`,
    "",
    "<i>Vault Rank = 65% personal score + 35% Bayesian IMDb score (vote-weighted) + up to 0.20 recency bonus.</i>"
  ].filter((line) => line !== "").join("\n");
  return sendMessage(env, chatId, message, { reply_markup: baseKeyboard(env) });
}
__name(showStats, "showStats");
async function showRandom(env, chatId) {
  const data = await loadDataset(env);
  if (!data.movies.length) return sendMessage(env, chatId, "The library is empty.");
  const movie = data.movies[Math.floor(Math.random() * data.movies.length)];
  return sendMovie(env, chatId, movie, { source: "random" });
}
__name(showRandom, "showRandom");
function compactMovieCaption(movie, options = {}) {
  const title = titleOf(movie);
  const rating = userRating(movie);
  const imdb = imdbRating(movie);
  const rank = ratingMetrics(movie);
  const omdb = movie.raw_omdb || {};
  const plot = text(movie.plot) || text(omdb.Plot);
  const type = typeOf(movie);
  const genres = genresOf(movie).slice(0, 4).join(" · ");
  const runtime = runtimeHuman(runtimeMinutes(movie));
  const director = text(movie.directors) || text(omdb.Director);
  const lines = [
    `${ratingEmoji(rating)} <b>${html(truncate(title, 125))}</b> (${html(yearOf(movie))})`,
    options.notification ? `🆕 <b>Newly detected in Cinema Vault:</b> ${html(dateTimeStamp(options.firstSeenAt || nowIso()))}` : "",
    `🧠 <b>Vault Rank: ${rank.score.toFixed(2)}/10</b> · ${rating ? `👤 You: <b>${rating.toFixed(1)}</b>` : "👤 You: —"} · ⭐ IMDb: <b>${html(imdb || "—")}</b>`,
    `🗳️ <b>${intFmt(rank.votes)}</b> IMDb votes · Bayesian IMDb: <b>${rank.adjustedImdb.toFixed(2)}</b>`,
    `🎬 ${html(type || "Title")}${runtime !== "—" ? ` · ⏱ ${html(runtime)}` : ""} · 📅 Rated: <b>${html(dateStamp(dateRatedOf(movie)))}</b>`,
    `${genres ? `🎭 ${html(truncate(genres, 100))}` : ""}${director ? `${genres ? " · " : ""}🎥 ${html(truncate(director, 50))}` : ""}`
  ].filter(Boolean);
  const shortPlot = truncate(plot, 125);
  if (shortPlot) lines.push(`<i>${html(shortPlot)}</i>`);
  lines.push(`<code>${html(imdbId(movie))}</code>`);
  const accepted = [];
  for (const line of lines) {
    const candidate = accepted.length ? `${accepted.join("\n")}\n${line}` : line;
    if (candidate.length > 980) break;
    accepted.push(line);
  }
  return accepted.join("\n");
}
__name(compactMovieCaption, "compactMovieCaption");
function fullMovieDetails(movie, env) {
  const raw = movie.raw_omdb || {};
  const csv = movie.raw_csv || {};
  const rating = userRating(movie);
  const score = imdbRating(movie);
  const rank = ratingMetrics(movie);
  const genre = genresOf(movie).join(", ");
  const runtime = runtimeHuman(runtimeMinutes(movie));
  const plot = text(movie.plot) || text(raw.Plot);
  const seriesName = text(movie.series_title) || text(raw.series);
  const season = num(movie.season_number ?? raw.Season, 0);
  const episode = num(movie.episode_number ?? raw.Episode, 0);
  const rows = [
    `\u{1F3AC} <b>${html(titleOf(movie))}</b>`,
    `\u{1F310} Original title: <b>${html(originalTitle(movie))}</b>`,
    `\u{1F4C5} Year: <b>${html(yearOf(movie))}</b>  \u2022  Type: <b>${html(typeOf(movie) || "Unknown")}</b>`,
    `\u{1F464} Your rating: <b>${rating ? `${rating.toFixed(1)}/10 ${ratingEmoji(rating)}` : "Not rated"}</b>`,
    `🧠 Vault Rank: <b>${rank.score.toFixed(2)}/10</b>  ·  Bayesian IMDb: <b>${rank.adjustedImdb.toFixed(2)}</b>`,
    `🗳️ IMDb votes: <b>${intFmt(rank.votes)}</b>  ·  Vote confidence: <b>${Math.round(rank.voteConfidence * 100)}%</b>  ·  Freshness: <b>+${rank.freshnessBonus.toFixed(2)}</b>`,
    `\u2B50 IMDb: <b>${html(score || "\u2014")}/10</b>  \u2022  Metascore: <b>${html(text(movie.metascore) || text(raw.Metascore) || "\u2014")}</b>`,
    `\u23F1 Runtime: <b>${html(runtime)}</b>`,
    `\u{1F3AD} Genres: <b>${html(genre || "\u2014")}</b>`,
    `\u{1F3AC} Director: ${html(text(movie.directors) || text(raw.Director) || text(csv.Directors) || "\u2014")}`,
    `\u270D\uFE0F Writer: ${html(text(movie.writer) || text(raw.Writer) || "\u2014")}`,
    `\u{1F31F} Cast: ${html(text(movie.actors) || text(raw.Actors) || "\u2014")}`,
    `\u{1F30D} Country: ${html(text(movie.country) || text(raw.Country) || "\u2014")}`,
    `\u{1F5E3} Language: ${html(text(movie.language) || text(raw.Language) || "\u2014")}`,
    `\u{1F5D3} Released: ${html(text(movie.release_date) || text(raw.Released) || "\u2014")}`,
    `\u{1F51E} Rated: ${html(text(movie.rated) || text(raw.Rated) || "\u2014")}`,
    `\u{1F3C6} Awards: ${html(text(movie.awards) || text(raw.Awards) || "\u2014")}`,
    `\u{1F4B5} Box office: ${html(text(movie.box_office) || text(raw.BoxOffice) || "\u2014")}`,
    `\u{1F3E2} Production: ${html(text(movie.production) || text(raw.Production) || "\u2014")}`,
    `\u{1F50E} Dataset status: <code>${html(text(movie.data_status, movie.omdb_found ? "fresh" : "csv-only"))}</code>`,
    `\u{1F5D3} Date rated: <b>${html(dateStamp(movie.date_rated || csv["Date Rated"]))}</b>`,
    `\u{1F194} IMDb ID: <code>${html(imdbId(movie))}</code>`
  ];
  if (seriesName || /episode/i.test(typeOf(movie))) rows.splice(3, 0, `\u{1F4FA} Series: <b>${html(seriesName || "\u2014")}</b>  \u2022  Season: <b>${season || "\u2014"}</b>  \u2022  Episode: <b>${episode || "\u2014"}</b>`);
  if (plot) rows.push("", "\u{1F4DD} <b>Plot</b>", `<blockquote>${html(truncate(plot, 700))}</blockquote>`);
  const sourceRatings = Array.isArray(movie.ratings) ? movie.ratings : Array.isArray(raw.Ratings) ? raw.Ratings : [];
  if (sourceRatings.length) {
    rows.push("", "\u{1F4C8} <b>Other ratings</b>");
    for (const r of sourceRatings.slice(0, 5)) rows.push(`\u2022 ${html(text(r.Source, "Source"))}: <b>${html(text(r.Value, "\u2014"))}</b>`);
  }
  const officialUrl = text(raw.Website);
  if (/^https:\/\//i.test(officialUrl)) rows.push(`\u{1F517} Official site: <a href="${html(officialUrl)}">open</a>`);
  const site = String(env.SITE_URL || "https://mehrdadmb2.github.io/imdb-showcase").replace(/\/$/, "");
  rows.push("", `\u{1F310} <a href="https://www.imdb.com/title/${encodeURIComponent(imdbId(movie))}/">Open on IMDb</a>  \u2022  <a href="${html(site)}">Open your library</a>`);
  const accepted = [];
  for (const row of rows) {
    const candidate = accepted.length ? `${accepted.join("\n")}
${row}` : row;
    if (candidate.length > MAX_DETAIL_CHARS) break;
    accepted.push(row);
  }
  return accepted.join("\n");
}
__name(fullMovieDetails, "fullMovieDetails");
async function sendMovie(env, chatId, movie, options = {}) {
  const caption = compactMovieCaption(movie, options);
  const full = fullMovieDetails(movie, env);
  const keyboard = { inline_keyboard: [
    [{ text: "\u{1F310} IMDb title page", url: `https://www.imdb.com/title/${encodeURIComponent(imdbId(movie))}/` }],
    [{ text: "\u2B50 Save to my list", callback_data: `fav:${imdbId(movie)}` }, { text: "\u{1F50E} Search more", callback_data: "cmd:search" }]
  ] };
  if (options.notification) {
    for (const poster of posterCandidates(movie, env)) {
      try {
        await telegram(env, "sendPhoto", { chat_id: chatId, photo: poster, caption, parse_mode: "HTML", reply_markup: keyboard });
        return true;
      } catch (error) {
        safeLog("notification_photo_failed", new Error(`${imdbId(movie)} ${error.message}`));
      }
    }
    await sendMessage(env, chatId, `${caption}

\u{1F5BC}\uFE0F Poster is currently unavailable.

${truncate(full.replace(/<[^>]*>/g, " "), 500)}`, { reply_markup: keyboard });
    return true;
  }
  let photoSent = false;
  for (const poster of posterCandidates(movie, env)) {
    try {
      await telegram(env, "sendPhoto", { chat_id: chatId, photo: poster, caption, parse_mode: "HTML", reply_markup: keyboard });
      photoSent = true;
      break;
    } catch (error) {
      safeLog("movie_photo_failed", new Error(`${imdbId(movie)} ${error.message}`));
    }
  }
  if (!photoSent) await sendMessage(env, chatId, `${caption}

\u{1F5BC}\uFE0F Poster unavailable right now.`, { reply_markup: keyboard });
  await sendMessage(env, chatId, full, { reply_markup: { inline_keyboard: [[{ text: "\u{1F310} Open IMDb", url: `https://www.imdb.com/title/${encodeURIComponent(imdbId(movie))}/` }], [{ text: "\u2B50 Save to my list", callback_data: `fav:${imdbId(movie)}` }, { text: "\u2B05\uFE0F Back to menu", callback_data: "cmd:menu" }]] } });
}
__name(sendMovie, "sendMovie");
async function handleCallback(callback, env) {
  const callbackId = callback.id;
  const message = callback.message;
  const chatId = message?.chat?.id;
  const userId = callback.from?.id;
  if (!chatId) {
    await answerCallback(env, callbackId, "This action is no longer available.");
    return;
  }
  const data = String(callback.data || "");
  try {
    await answerCallback(env, callbackId);
    if (data.startsWith("m:")) {
      const movieId = data.slice(2);
      if (!/^tt\d{5,}$/i.test(movieId)) return sendMessage(env, chatId, "Invalid title ID.");
      const dataset = await loadDataset(env);
      const movie = movieById(dataset.movies, movieId);
      return movie ? sendMovie(env, chatId, movie) : sendMessage(env, chatId, "That title is not in the current repository dataset.");
    }
    if (data.startsWith("p:")) {
      const [, token, offsetText] = data.split(":");
      const session = await getSearchSession(env, token, chatId);
      if (!session) return sendMessage(env, chatId, "This list has expired. Run the command again.");
      return showList(env, chatId, session.mode, session.query, Number(offsetText) || 0, message.message_id, token);
    }
    if (data.startsWith("g:")) {
      const token = data.slice(2);
      const session = await getSearchSession(env, token, chatId);
      if (!session || session.mode !== "genre") return sendMessage(env, chatId, "This genre menu expired. Use /genres to open it again.");
      return showList(env, chatId, "genre", session.query, 0, null, token);
    }
    if (data.startsWith("fav:")) {
      const id = data.slice(4);
      if (!/^tt\d{5,}$/i.test(id)) return sendMessage(env, chatId, "Invalid title ID.");
      const existing = await env.DB.prepare("SELECT imdb_id FROM favorites WHERE chat_id=? AND imdb_id=?").bind(String(chatId), id).first();
      if (existing) {
        await env.DB.prepare("DELETE FROM favorites WHERE chat_id=? AND imdb_id=?").bind(String(chatId), id).run();
        return sendMessage(env, chatId, "\u{1F5D1} Removed from your saved list. Use /mylist to view it.");
      }
      await env.DB.prepare("INSERT OR IGNORE INTO favorites(chat_id, imdb_id, saved_at) VALUES (?, ?, ?)").bind(String(chatId), id, nowIso()).run();
      return sendMessage(env, chatId, "\u2B50 Saved to your list. Use /mylist to view saved titles.");
    }
    if (data === "sub:toggle") {
      if (message.chat.type !== "private") return sendMessage(env, chatId, "Notification preferences are available in a private chat.");
      const subscriber = await env.DB.prepare("SELECT notifications FROM subscribers WHERE chat_id=?").bind(String(chatId)).first();
      const value = subscriber?.notifications ? 0 : 1;
      await env.DB.prepare(`INSERT INTO subscribers(chat_id, user_id, username, first_name, notifications, blocked, joined_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET notifications=excluded.notifications, blocked=0, last_seen_at=excluded.last_seen_at`).bind(String(chatId), String(userId || ""), text(callback.from?.username), text(callback.from?.first_name), value, nowIso(), nowIso()).run();
      if (!value) await env.DB.prepare("UPDATE notification_queue SET status='failed', last_error='user_unsubscribed' WHERE chat_id=? AND status='pending'").bind(String(chatId)).run();
      return sendMessage(env, chatId, value ? "\u{1F514} New-title notifications enabled." : "\u{1F515} New-title notifications paused. Pending alerts were cancelled.");
    }
    if (data.startsWith("cmd:")) {
      const command = data.slice(4);
      if (command === "menu") return sendMessage(env, chatId, "\u{1F3AC} <b>Cinema Vault</b>\nChoose an action:", { reply_markup: baseKeyboard(env) });
      if (command === "latest") return showList(env, chatId, "latest", "", 0);
      if (command === "top") return showList(env, chatId, "top", "", 0);
      if (command === "stats") return showStats(env, chatId);
      if (command === "search") return sendMessage(env, chatId, "\u{1F50E} Send a movie or series title, an IMDb ID (for example <code>tt0133093</code>), or use <code>/search title</code>.");
    }
    return sendMessage(env, chatId, "This button is no longer available. Use /help.");
  } catch (error) {
    safeLog("callback_failed", error);
    return sendMessage(env, chatId, "\u26A0\uFE0F That action failed temporarily. Please try again.").catch(() => null);
  }
}
__name(handleCallback, "handleCallback");
function parseCsv(input) {
  const source = String(input || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row.");
  const headers = rows[0].map((h) => String(h || "").trim());
  const required = ["Const", "Title", "Your Rating", "Date Rated"];
  const missing = required.filter((key) => !headers.includes(key));
  if (missing.length) throw new Error(`CSV missing required column(s): ${missing.join(", ")}`);
  const idIndex = headers.indexOf("Const");
  const titleIndex = headers.indexOf("Title");
  const seen = /* @__PURE__ */ new Set();
  let valid = 0;
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][idIndex] || "").trim();
    const normalizedId = id.toLowerCase();
    const title = String(rows[i][titleIndex] || "").trim();
    if (!id && !title) continue;
    if (!/^tt\d{5,}$/i.test(id)) throw new Error(`Invalid IMDb Const at CSV row ${i + 1}.`);
    if (!title) throw new Error(`Title is empty at CSV row ${i + 1}.`);
    if (seen.has(normalizedId)) throw new Error(`Duplicate IMDb ID ${id} at CSV row ${i + 1}.`);
    seen.add(normalizedId);
    const item = {};
    headers.forEach((header, index) => { item[header] = String(rows[i][index] || "").trim(); });
    item.Const = normalizedId;
    items.push(item);
    valid++;
    if (valid > MAX_IMPORT_ROWS) throw new Error(`CSV exceeds the maximum of ${MAX_IMPORT_ROWS} records.`);
  }
  if (!valid) throw new Error("No valid IMDb records were found.");
  return { records: valid, headers: headers.length, items, headerNames: headers };
}
__name(parseCsv, "parseCsv");
function base64ToUtf8(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
__name(base64ToUtf8, "base64ToUtf8");
function compareCsvSnapshots(previous, current) {
  const before = new Map((previous?.items || []).map((row) => [String(row.Const || "").toLowerCase(), row]));
  const after = new Map((current?.items || []).map((row) => [String(row.Const || "").toLowerCase(), row]));
  const added = [], removed = [], changed = [];
  let ratingChanged = 0, dateChanged = 0, imdbChanged = 0, votesChanged = 0, metadataChanged = 0;
  const fields = [
    ["Your Rating", "your rating", "rating"],
    ["Date Rated", "rating date", "date"],
    ["IMDb Rating", "IMDb rating", "imdb"],
    ["Num Votes", "IMDb votes", "votes"],
    ["Title", "title", "other"], ["Original Title", "original title", "other"], ["URL", "IMDb URL", "other"],
    ["Year", "year", "other"], ["Title Type", "type", "other"],
    ["Genres", "genres", "other"], ["Runtime (mins)", "runtime", "other"],
    ["Release Date", "release date", "other"], ["Directors", "directors", "other"]
  ];
  for (const [id, row] of after) {
    const old = before.get(id);
    if (!old) { added.push({ id, title: row.Title || id, rating: row["Your Rating"] || "—", date: row["Date Rated"] || "—" }); continue; }
    const labels = [];
    for (const [key, label, kind] of fields) {
      const a = String(old[key] ?? "").trim();
      const b = String(row[key] ?? "").trim();
      if (a !== b) {
        labels.push(label);
        if (kind === "rating") ratingChanged++;
        else if (kind === "date") dateChanged++;
        else if (kind === "imdb") imdbChanged++;
        else if (kind === "votes") votesChanged++;
        else metadataChanged++;
      }
    }
    if (labels.length) changed.push({ id, title: row.Title || old.Title || id, fields: labels });
  }
  for (const [id, row] of before) if (!after.has(id)) removed.push({ id, title: row.Title || id });
  const sortNew = (a, b) => (Number(b.rating) - Number(a.rating)) || String(b.date).localeCompare(String(a.date)) || String(a.title).localeCompare(String(b.title));
  added.sort(sortNew);
  changed.sort((a, b) => a.title.localeCompare(b.title));
  removed.sort((a, b) => a.title.localeCompare(b.title));
  return {
    previousRecords: before.size,
    currentRecords: after.size,
    added: added.length,
    removed: removed.length,
    modified: changed.length,
    unchanged: Math.max(0, after.size - added.length - changed.length),
    ratingChanged, dateChanged, imdbChanged, votesChanged, metadataChanged,
    addedTitles: added.slice(0, 12),
    removedTitles: removed.slice(0, 10),
    changedTitles: changed.slice(0, 12),
    addedMore: Math.max(0, added.length - 12),
    removedMore: Math.max(0, removed.length - 10),
    changedMore: Math.max(0, changed.length - 12)
  };
}
__name(compareCsvSnapshots, "compareCsvSnapshots");

function bytesToBase64(bytes) {
  let binary = "";
  const step = 32768;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  }
  return btoa(binary);
}
__name(bytesToBase64, "bytesToBase64");
async function githubRequest(env, path, options = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("github_token_not_configured");
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": `IMDb-Showcase-Telegram/${VERSION}`,
      ...options.body ? { "content-type": "application/json" } : {}
    },
    body: options.body ? JSON.stringify(options.body) : void 0,
    signal: AbortSignal.timeout(2e4)
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
  }
  if (!response.ok) {
    const error = new Error(`github_http_${response.status}:${String(data.message || "request_failed").slice(0, 120)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
__name(githubRequest, "githubRequest");
async function importCsvToRepository(env, chatId, fileName, bytes, currentValidation) {
  const owner = String(env.REPO_OWNER || "mehrdadmb2");
  const repo = String(env.REPO_NAME || "imdb-showcase");
  const branch = String(env.REPO_BRANCH || "main");
  const path = String(env.DATA_CSV_PATH || "src/ratings.csv").replace(/^\/+/, "");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  let sha = "";
  let previousValidation = null;
  let previousAvailable = false;
  try {
    const file = await githubRequest(env, endpoint);
    sha = text(file.sha);
    if (file.encoding === "base64" && text(file.content)) {
      try {
        previousValidation = parseCsv(base64ToUtf8(file.content));
        previousAvailable = true;
      } catch (error) {
        safeLog("previous_csv_diff_unavailable", new Error(String(error.message || "previous_csv_invalid").slice(0, 140)));
      }
    }
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const diff = previousAvailable
    ? compareCsvSnapshots(previousValidation, currentValidation)
    : {
        previousRecords: 0, currentRecords: currentValidation.records,
        added: currentValidation.records, removed: 0, modified: 0, unchanged: 0,
        ratingChanged: 0, dateChanged: 0, imdbChanged: 0, votesChanged: 0, metadataChanged: 0,
        addedTitles: currentValidation.items.slice(0, 12).map((row) => ({ id: row.Const, title: row.Title || row.Const, rating: row["Your Rating"] || "—", date: row["Date Rated"] || "—" })),
        removedTitles: [], changedTitles: [], addedMore: Math.max(0, currentValidation.records - 12),
        removedMore: 0, changedMore: 0, baselineAvailable: false
      };
  const body = {
    message: `chore(data): import IMDb ratings CSV (${currentValidation.records} records; +${diff.added}/-${diff.removed}/~${diff.modified})`,
    content: bytesToBase64(bytes),
    branch,
    ...sha ? { sha } : {}
  };
  const saved = await githubRequest(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`, { method: "PUT", body });
  let dispatched = false;
  let dispatchMessage = "";
  try {
    await githubRequest(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(String(env.WORKFLOW_FILE || "update-movies.yml"))}/dispatches`, {
      method: "POST",
      body: { ref: branch }
    });
    dispatched = true;
  } catch (error) {
    dispatchMessage = String(error.message || "workflow_dispatch_failed").slice(0, 180);
  }
  const detailPayload = JSON.stringify({ diff, workflow: "update-movies.yml", worker_followup: "workflow_run" });
  await env.DB.prepare("INSERT INTO import_log(chat_id, filename, records, commit_sha, workflow_dispatched, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
    String(chatId), fileName.slice(0, 120), currentValidation.records,
    text(saved.commit?.sha), dispatched ? 1 : 0,
    dispatched ? "saved_and_dispatched" : "saved_dispatch_failed",
    detailPayload.slice(0, 12000), nowIso()
  ).run();
  isolateDatasetCache = { at: 0, data: null };
  return { sha: text(saved.commit?.sha), dispatched, dispatchMessage, diff };
}
__name(importCsvToRepository, "importCsvToRepository");
async function sendHtmlLineChunks(env, chatId, lines, lastOptions = {}, maxChars = 3500) {
  const chunks = [];
  let current = "";
  for (const rawLine of lines) {
    const line = String(rawLine ?? "");
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length) chunks.push("IMDb CSV import completed.");
  for (let i = 0; i < chunks.length; i++) {
    await sendMessage(env, chatId, chunks[i], i === chunks.length - 1 ? lastOptions : {});
  }
  return { ok: true, messages: chunks.length };
}
__name(sendHtmlLineChunks, "sendHtmlLineChunks");
async function handleDocument(message, env) {
  const from = message.from || {};
  const chatId = message.chat.id;
  if (!isAdmin(env, from.id)) return sendMessage(env, chatId, "⛔ CSV import is restricted to the configured admin Telegram IDs.");
  if (message.chat.type !== "private") return sendMessage(env, chatId, "For safety, CSV import is allowed only in the private chat with this bot.");
  const document = message.document || {};
  const filename = text(document.file_name, "ratings.csv");
  if (!filename.toLowerCase().endsWith(".csv")) return sendMessage(env, chatId, "Please upload an IMDb export with a <code>.csv</code> filename.");
  const maxBytes = num(env.MAX_IMPORT_BYTES, DEFAULT_IMPORT_LIMIT);
  if (num(document.file_size, 0) > maxBytes) return sendMessage(env, chatId, `CSV exceeds the configured limit (${Math.round(maxBytes / 1024 / 1024)} MB).`);
  if (!document.file_id) return sendMessage(env, chatId, "Telegram did not include a valid file ID. Please upload the CSV again.");
  await sendMessage(env, chatId, `📥 <b>Cinema Vault import started</b>\n\n1) دریافت و اعتبارسنجی CSV\n2) مقایسه با نسخه قبلی <code>src/ratings.csv</code>\n3) ثبت نسخه جدید در GitHub\n4) اجرای خودکار <b>IMDb Showcase — resilient data pipeline</b>\n5) پس از موفقیت Pipeline، اجرای خودکار <b>Trigger Cinema Vault Telegram Worker</b> و ارسال عنوان‌های جدید\n\n🛡️ تا پایان Pipeline، دیتاست منتشرشدهٔ سایت دست‌نخورده می‌ماند.`);
  try {
    const fileMeta = await telegram(env, "getFile", { file_id: document.file_id });
    const filePath = text(fileMeta?.file_path);
    if (!filePath) throw new Error("telegram_file_path_missing");
    const fileResponse = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`, { signal: AbortSignal.timeout(2e4) });
    if (!fileResponse.ok) throw new Error(`telegram_file_download_http_${fileResponse.status}`);
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) throw new Error("file_size_invalid");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const validation = parseCsv(decoded);
    const result = await importCsvToRepository(env, chatId, filename, bytes, validation);
    const diff = result.diff || {};
    const lines = [
      "✅ <b>IMDb CSV imported successfully</b>",
      `📄 File: <code>${html(filename)}</code> · Size: <b>${(bytes.length / 1024).toFixed(1)} KB</b>`,
      `🎞️ Valid records: <b>${intFmt(validation.records)}</b> · Columns: <b>${intFmt(validation.headers)}</b>`,
      `📚 Previous → Current: <b>${intFmt(diff.previousRecords || 0)} → ${intFmt(diff.currentRecords || validation.records)}</b>`,
      `🆕 Added: <b>+${intFmt(diff.added)}</b> · 🗑 Removed: <b>-${intFmt(diff.removed)}</b> · ✏️ Modified: <b>${intFmt(diff.modified)}</b>`,
      `✅ Unchanged: <b>${intFmt(diff.unchanged)}</b>`,
      `⭐ Rating changes: <b>${intFmt(diff.ratingChanged)}</b> · 📅 Date changes: <b>${intFmt(diff.dateChanged)}</b>`,
      `🌐 IMDb score changes: <b>${intFmt(diff.imdbChanged)}</b> · 🗳️ Vote-count changes: <b>${intFmt(diff.votesChanged)}</b>`,
      `🎬 Metadata field changes (title, year, type, genre, runtime, URL, etc.): <b>${intFmt(diff.metadataChanged)}</b>`,
      `🕒 Imported at: <b>${html(dateTimeStamp(nowIso()))}</b>`,
      `🔗 Commit: <code>${html(result.sha ? result.sha.slice(0, 12) : "created")}</code>`,
      result.dispatched ? "⚙️ <b>Data pipeline dispatched.</b> The Worker trigger will run automatically after the pipeline succeeds." : `⚠️ CSV committed, but pipeline dispatch failed: <code>${html(result.dispatchMessage || "unknown error")}</code>`
    ];
    if (diff.addedTitles?.length) {
      lines.push("", "<b>🆕 Newly added titles</b>");
      for (const item of diff.addedTitles.slice(0, 8)) lines.push(`• ${html(truncate(item.title, 72))} · You ${html(item.rating || "—")} · ${html(item.date || "—")}`);
      if (diff.addedMore) lines.push(`<i>… and ${intFmt(diff.addedMore)} more</i>`);
    }
    if (diff.changedTitles?.length) {
      lines.push("", "<b>✏️ Updated titles</b>");
      for (const item of diff.changedTitles.slice(0, 7)) lines.push(`• ${html(truncate(item.title, 65))} — ${html(item.fields.join(", "))}`);
      if (diff.changedMore) lines.push(`<i>… and ${intFmt(diff.changedMore)} more</i>`);
    }
    if (diff.removedTitles?.length) {
      lines.push("", "<b>🗑 Removed from CSV</b>");
      for (const item of diff.removedTitles.slice(0, 6)) lines.push(`• ${html(truncate(item.title, 68))}`);
      if (diff.removedMore) lines.push(`<i>… and ${intFmt(diff.removedMore)} more</i>`);
    }
    if (diff.baselineAvailable === false) lines.push("", "<i>Previous CSV baseline was unavailable; all current records are treated as new for this comparison only.</i>");
    const actionUrl = `https://github.com/${env.REPO_OWNER || "mehrdadmb2"}/${env.REPO_NAME || "imdb-showcase"}/actions/workflows/update-movies.yml`;
    return sendHtmlLineChunks(env, chatId, lines, { reply_markup: { inline_keyboard: [[{ text: "Open data pipeline", url: actionUrl }], [{ text: "Open repository", url: `https://github.com/${env.REPO_OWNER || "mehrdadmb2"}/${env.REPO_NAME || "imdb-showcase"}` }]] } });
  } catch (error) {
    safeLog("csv_import_failed", error);
    await env.DB.prepare("INSERT INTO import_log(chat_id, filename, records, workflow_dispatched, status, details, created_at) VALUES (?, ?, 0, 0, ?, ?, ?)").bind(String(chatId), filename.slice(0, 120), "failed", String(error.message || "import_failed").slice(0, 180), nowIso()).run().catch(() => null);
    return sendMessage(env, chatId, `❌ <b>Import failed</b>\n<code>${html(String(error.message || "unknown error").slice(0, 280))}</code>\n\nNo valid replacement was published. Check the bot token, GitHub Contents/Actions permissions, CSV headers and GitHub Actions status.`);
  }
}
__name(handleDocument, "handleDocument");
async function showAdminStatus(env, chatId) {
  const dataset = await loadDataset(env).catch(() => null);
  const subscribers = await env.DB.prepare("SELECT COUNT(*) AS count FROM subscribers").first();
  const active = await env.DB.prepare("SELECT COUNT(*) AS count FROM subscribers WHERE notifications=1 AND blocked=0").first();
  const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM notification_queue WHERE status='pending'").first();
  const sent = await env.DB.prepare("SELECT COUNT(*) AS count FROM notification_queue WHERE status='sent'").first();
  const recent = await env.DB.prepare("SELECT filename, records, status, details, created_at, workflow_dispatched FROM import_log ORDER BY id DESC LIMIT 5").all();
  const lines = [
    "\u{1F6E0}\uFE0F <b>Bot diagnostics</b>",
    `\u{1F916} Version: <code>${VERSION}</code>`,
    `\u{1F5C3}\uFE0F D1: <b>${env.DB ? "configured" : "missing"}</b>`,
    `\u{1F510} Bot token: <b>${env.BOT_TOKEN ? "configured" : "missing"}</b>`,
    `\u{1F510} GitHub token: <b>${env.GITHUB_TOKEN ? "configured" : "missing"}</b> (value hidden)`,
    `\u{1F465} Subscribers: <b>${intFmt(subscribers?.count)}</b>`,
    `\u{1F514} Alerts active: <b>${intFmt(active?.count)}</b>`,
    `\u{1F4EC} Notification queue: <b>${intFmt(pending?.count)}</b> pending / ${intFmt(sent?.count)} sent`,
    `\u{1F4DA} Dataset: <b>${dataset ? intFmt(dataset.movies.length) : "unavailable"}</b> records`,
    `\u{1F553} Dataset updated: <code>${html(text(dataset?.last_manual_update || dataset?.data_meta?.generated_at, "unknown"))}</code>`,
    "",
    "<b>Recent CSV imports</b>"
  ];
  for (const item of recent.results || []) lines.push(`\u2022 ${html(item.status)} \u2014 ${intFmt(item.records)} records \u2014 workflow: ${item.workflow_dispatched ? "triggered" : "not triggered"} \u2014 ${html(item.created_at)}`);
  lines.push("", "<i>Secrets and token values are never shown here.</i>");
  return sendMessage(env, chatId, lines.join("\n").slice(0, 3900));
}
__name(showAdminStatus, "showAdminStatus");
async function runScheduled(env) {
  if (!env.DB || !env.BOT_TOKEN) throw new Error("scheduled_missing_required_binding_or_secret");
  const dataset = await loadDataset(env, true);
  const state = await env.DB.prepare("SELECT value FROM bot_state WHERE key='baseline_complete'").first();
  const allKnownRows = await env.DB.prepare("SELECT imdb_id FROM seen_titles").all();
  const known = new Set((allKnownRows.results || []).map((row) => row.imdb_id));
  const movies = dataset.movies;
  if (!state?.value) {
    const stamp = nowIso();
    for (const chunk of chunked(movies, 80)) {
      const statements = chunk.map((movie) => env.DB.prepare("INSERT OR IGNORE INTO seen_titles(imdb_id, title, first_seen_at) VALUES (?, ?, ?)").bind(imdbId(movie), titleOf(movie), stamp));
      if (statements.length) await env.DB.batch(statements);
    }
    await env.DB.prepare("INSERT INTO bot_state(key, value, updated_at) VALUES ('baseline_complete', '1', ?) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=excluded.updated_at").bind(stamp).run();
    console.log(JSON.stringify({ event: "notification_baseline_initialized", datasetCount: movies.length, at: stamp }));
  } else {
    const fresh = movies.filter((m) => !known.has(imdbId(m)));
    if (fresh.length) {
      const stamp = nowIso();
      const subscribers = await env.DB.prepare("SELECT chat_id FROM subscribers WHERE notifications=1 AND blocked=0").all();
      for (const movie of fresh) {
        const jobs = (subscribers.results || []).map((subscriber) => env.DB.prepare(`INSERT OR IGNORE INTO notification_queue(chat_id, imdb_id, status, attempts, next_attempt_at, created_at)
          VALUES (?, ?, 'pending', 0, ?, ?)`).bind(subscriber.chat_id, imdbId(movie), stamp, stamp));
        for (const jobChunk of chunked(jobs, 80)) if (jobChunk.length) await env.DB.batch(jobChunk);
      }
      for (const chunk of chunked(fresh, 80)) {
        await env.DB.batch(chunk.map((movie) => env.DB.prepare("INSERT OR IGNORE INTO seen_titles(imdb_id, title, first_seen_at) VALUES (?, ?, ?)").bind(imdbId(movie), titleOf(movie), stamp)));
      }
      console.log(JSON.stringify({ event: "new_titles_detected", newTitles: fresh.length, subscribers: subscribers.results?.length || 0, at: stamp }));
    }
  }
  await drainNotificationQueue(env, movies, 25);
  await env.DB.prepare("DELETE FROM search_sessions WHERE created_at < datetime('now', '-7 days')").run();
  await env.DB.prepare("DELETE FROM processed_updates WHERE processed_at < datetime('now', '-30 days')").run();
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(Date.now() - 7 * 24 * 60 * 60 * 1e3).run();
}
__name(runScheduled, "runScheduled");
async function drainNotificationQueue(env, movies, limit = 25) {
  const queue = await env.DB.prepare("SELECT id, chat_id, imdb_id, attempts, created_at FROM notification_queue WHERE status='pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?").bind(nowIso(), limit).all();
  const map = new Map(movies.map((movie) => [imdbId(movie), movie]));
  for (const job of queue.results || []) {
    const movie = map.get(job.imdb_id);
    if (!movie) {
      await env.DB.prepare("UPDATE notification_queue SET status='failed', last_error='title_missing_from_current_dataset' WHERE id=?").bind(job.id).run();
      continue;
    }
    try {
      await sendMovie(env, job.chat_id, movie, { notification: true, firstSeenAt: job.created_at || nowIso() });
      await env.DB.prepare("UPDATE notification_queue SET status='sent', sent_at=?, attempts=attempts+1, last_error=NULL WHERE id=?").bind(nowIso(), job.id).run();
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const blocked = /telegram_403/.test(String(error.message || ""));
      const status = attempts >= 6 ? "failed" : "pending";
      const waitMinutes = Math.min(24 * 60, 5 * 2 ** Math.min(attempts, 8));
      const next = new Date(Date.now() + (error.retryAfter || waitMinutes * 60) * 1e3).toISOString();
      await env.DB.prepare("UPDATE notification_queue SET status=?, attempts=?, next_attempt_at=?, last_error=? WHERE id=?").bind(status, attempts, next, String(error.message || "send_failed").slice(0, 180), job.id).run();
      if (blocked) await env.DB.prepare("UPDATE subscribers SET blocked=1, notifications=0 WHERE chat_id=?").bind(job.chat_id).run();
      safeLog("notification_delivery_failed", new Error(`job=${job.id} attempt=${attempts} ${String(error.message || "send_failed").slice(0, 140)}`));
    }
  }
}
__name(drainNotificationQueue, "drainNotificationQueue");
function chunked(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
__name(chunked, "chunked");
var __test = { parseCsv, compareCsvSnapshots, ratingMetrics, compareVaultRank, ratingEmoji, runtimeHuman, queryKey, html, imdbId, titleOf, genresOf };
export {
  __test,
  index_default as default
};
//# sourceMappingURL=index.js.map
