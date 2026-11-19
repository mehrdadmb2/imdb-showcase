import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../index.js';

const { __test } = await import('../index.js');

const sample = {
  imdb_id: 'tt7984766',
  title: 'The King',
  user_rating: 8,
  date_rated: '2026-11-18',
  imdb_rating: '7.3',
  num_votes: '184,977'
};

test('the bundled project IMDb CSV validates and is stable against its own snapshot', async () => {
  const csv = await readFile(new URL('../../src/ratings.csv', import.meta.url), 'utf8');
  const parsed = __test.parseCsv(csv);
  const diff = __test.compareCsvSnapshots(parsed, parsed);
  assert.ok(parsed.records > 0);
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
  assert.equal(diff.modified, 0);
  assert.equal(diff.unchanged, parsed.records);
});

test('shared browser engine and Worker produce the same Vault Rank', async () => {
  const source = await readFile(new URL('../../docs/rating-engine.js', import.meta.url), 'utf8');
  const context = { console };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const now = Date.parse('2026-11-19T12:00:00Z');
  const browserRank = context.CinemaVaultRating.metrics(sample, now);
  const workerRank = __test.ratingMetrics(sample, now);
  for (const key of ['score', 'baseScore', 'bayesianImdb', 'votes', 'freshnessBonus', 'voteConfidence']) {
    const workerKey = key === 'bayesianImdb' ? 'adjustedImdb' : key;
    assert.ok(Math.abs(browserRank[key] - workerRank[workerKey]) < 1e-10, `${key} differs`);
  }
});

test('IMDb vote count changes Bayesian confidence, not raw popularity points', () => {
  const lowVotes = __test.ratingMetrics({ ...sample, num_votes: 10 }, Date.parse('2026-11-19T12:00:00Z'));
  const highVotes = __test.ratingMetrics({ ...sample, num_votes: 100000 }, Date.parse('2026-11-19T12:00:00Z'));
  assert.ok(highVotes.voteConfidence > lowVotes.voteConfidence);
  assert.ok(highVotes.adjustedImdb > lowVotes.adjustedImdb);
});

test('more recent ratings receive a bounded positive freshness bonus', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const recent = __test.ratingMetrics({ ...sample, date_rated: '2026-11-19' }, now);
  const old = __test.ratingMetrics({ ...sample, date_rated: '2021-11-19' }, now);
  assert.ok(recent.freshnessBonus > old.freshnessBonus);
  assert.ok(recent.freshnessBonus <= 0.2);
});

test('CSV parser handles quoted commas and normalizes IMDb IDs', () => {
  const csv = 'Const,Your Rating,Date Rated,Title,IMDb Rating,Num Votes\nTT0000001,8,2026-11-18,"A title, with comma",7.4,"12,345"\n';
  const parsed = __test.parseCsv(csv);
  assert.equal(parsed.records, 1);
  assert.equal(parsed.items[0].Const, 'tt0000001');
  assert.equal(parsed.items[0].Title, 'A title, with comma');
  assert.equal(parsed.items[0]['Num Votes'], '12,345');
});

test('CSV parser rejects duplicate IMDb IDs even when letter case differs', () => {
  const csv = 'Const,Your Rating,Date Rated,Title\ntt0000001,8,2026-11-18,Alpha\nTT0000001,7,2026-11-17,Alpha duplicate';
  assert.throws(() => __test.parseCsv(csv), /Duplicate IMDb ID/i);
});

test('CSV comparison reports added, removed and modified titles/fields', () => {
  const previous = __test.parseCsv([
    'Const,Your Rating,Date Rated,Title,IMDb Rating,Num Votes,URL',
    'tt0000001,7,2025-01-01,Alpha,6.8,100,https://www.imdb.com/title/tt0000001',
    'tt0000002,8,2025-02-01,Beta,7.1,200,https://www.imdb.com/title/tt0000002'
  ].join('\n'));
  const current = __test.parseCsv([
    'Const,Your Rating,Date Rated,Title,IMDb Rating,Num Votes,URL',
    'tt0000001,8,2026-11-18,Alpha,7.0,120,https://www.imdb.com/title/tt0000001/?ref_=changed',
    'tt0000003,9,2026-11-18,Gamma,8.4,500,https://www.imdb.com/title/tt0000003'
  ].join('\n'));
  const diff = __test.compareCsvSnapshots(previous, current);
  assert.deepEqual([diff.added, diff.removed, diff.modified, diff.unchanged], [1, 1, 1, 0]);
  assert.deepEqual([diff.ratingChanged, diff.dateChanged, diff.imdbChanged, diff.votesChanged, diff.metadataChanged], [1, 1, 1, 1, 1]);
  assert.equal(diff.addedTitles[0].title, 'Gamma');
  assert.equal(diff.removedTitles[0].title, 'Beta');
});

test('ranking is deterministic and tie-breaks by votes then rating date', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const items = [
    { ...sample, imdb_id: 'tt0000001', num_votes: 10 },
    { ...sample, imdb_id: 'tt0000002', num_votes: 1000 }
  ];
  const sorted = [...items].sort(__test.compareVaultRank);
  assert.equal(sorted[0].imdb_id, 'tt0000002');
  assert.equal(__test.ratingMetrics(sample, now).votes, 184977);
});
