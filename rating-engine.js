/* Cinema Vault Rating Engine — shared by Classic and Advanced pages.
 * Vault Rank v1: 65% personal rating + 35% Bayesian IMDb score + up to 0.20
 * freshness bonus. IMDb votes control confidence in the Bayesian score.
 */
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({
    version: 'vault-rank-v1',
    personalWeight: 0.65,
    imdbWeight: 0.35,
    priorRating: 6.5,
    priorVotes: 1000,
    maxFreshnessBonus: 0.20,
    freshnessHalfLifeDays: 1095
  });

  function number(value, fallback = 0) {
    const raw = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    const parsed = raw ? Number(raw[0]) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function userRating(movie) {
    return number(movie?.user_rating ?? movie?.raw_csv?.['Your Rating'], 0);
  }

  function imdbRating(movie) {
    return number(movie?.imdb_rating ?? movie?.raw_omdb?.imdbRating, 0);
  }

  function voteCount(movie) {
    return Math.max(0, number(
      movie?.num_votes ?? movie?.raw_csv?.['Num Votes'] ?? movie?.raw_omdb?.imdbVotes,
      0
    ));
  }

  function dateRated(movie) {
    return String(movie?.date_rated ?? movie?.raw_csv?.['Date Rated'] ?? '').trim();
  }

  function dateValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function metrics(movie, now = Date.now()) {
    const personal = Math.max(0, Math.min(10, userRating(movie)));
    const imdb = Math.max(0, Math.min(10, imdbRating(movie)));
    const votes = voteCount(movie);
    const voteConfidence = votes / (votes + CONFIG.priorVotes);
    const rawImdb = imdb > 0 ? imdb : CONFIG.priorRating;
    const bayesianImdb = (voteConfidence * rawImdb) + ((1 - voteConfidence) * CONFIG.priorRating);
    const base = personal > 0
      ? (personal * CONFIG.personalWeight) + (bayesianImdb * CONFIG.imdbWeight)
      : bayesianImdb;

    const ratedAt = dateValue(dateRated(movie));
    const ageDays = ratedAt > 0 ? Math.max(0, (now - ratedAt) / 86400000) : null;
    const freshnessBonus = personal > 0 && ageDays !== null
      ? CONFIG.maxFreshnessBonus * Math.exp(-ageDays / CONFIG.freshnessHalfLifeDays)
      : 0;
    const score = Math.max(0, Math.min(10, base + freshnessBonus));

    return {
      score,
      baseScore: base,
      personalRating: personal,
      imdbRating: imdb,
      bayesianImdb,
      votes,
      voteConfidence,
      freshnessBonus,
      ageDays,
      ratedAt
    };
  }

  function compare(a, b, now = Date.now()) {
    const A = metrics(a, now);
    const B = metrics(b, now);
    return (B.score - A.score)
      || (B.votes - A.votes)
      || ((B.ratedAt || 0) - (A.ratedAt || 0))
      || (B.personalRating - A.personalRating);
  }

  function formatVotes(value) {
    const n = Math.max(0, number(value));
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
    return Math.round(n).toLocaleString('en-US');
  }

  root.CinemaVaultRating = Object.freeze({ CONFIG, metrics, compare, voteCount, dateRated, dateValue, formatVotes });
})(typeof window !== 'undefined' ? window : globalThis);
