import test from 'node:test';
import assert from 'node:assert/strict';

import * as db from '../server/database.js';

test('checkHealth returns ok:true when DB is reachable', async () => {
  const result = await db.checkHealth();
  assert.equal(result.ok, true);
});

test('getDashboard returns numeric counts', async () => {
  const data = await db.getDashboard();
  assert.equal(typeof data.due_count, 'number');
  assert.equal(typeof data.reviewed_count, 'number');
  assert.equal(typeof data.total_cards, 'number');
  assert.equal(typeof data.p0_total, 'number');
  assert.ok(data.total_cards > 0, 'should have seeded knowledge points');
});

test('getKnowledgePoints returns sorted list with required fields', async () => {
  const points = await db.getKnowledgePoints();
  assert.ok(points.length > 0);
  assert.ok(points[0].id, 'has id');
  assert.ok(points[0].title, 'has title');
  assert.ok(points[0].priority, 'has priority');
  assert.ok(points[0].module, 'has module');
  // First item should be P0 (sorted by priority)
  assert.equal(points[0].priority, 'P0');
});

test('getKnowledgePoint returns full detail for known id', async () => {
  const all = await db.getKnowledgePoints();
  const first = all[0];
  const point = await db.getKnowledgePoint(first.id);
  assert.ok(point, 'should find the point');
  assert.equal(point.id, first.id);
  assert.equal(point.title, first.title);
  assert.ok(point.content_md !== undefined, 'has content_md field');
});

test('getKnowledgePoint returns null for unknown id', async () => {
  const result = await db.getKnowledgePoint('nonexistent-id-xyz-abc');
  assert.equal(result, null);
});

test('getDueCards returns array of cards', async () => {
  const cards = await db.getDueCards();
  assert.ok(Array.isArray(cards));
  if (cards.length > 0) {
    assert.ok(cards[0].id);
    assert.ok(cards[0].title);
    assert.ok(cards[0].question);
  }
});

test('recordReview with known=true increments review_count', async () => {
  const all = await db.getKnowledgePoints();
  const point = all[0];
  const before = await db.getKnowledgePoint(point.id);
  const prevCount = Number(before.review_count ?? 0);

  const result = await db.recordReview(point.id, true);
  assert.ok(result.review_count > 0);
  assert.equal(Number(result.review_count), prevCount + 1);
  assert.ok(result.next_due);
});

test('recordReview with known=false increments lapses', async () => {
  const all = await db.getKnowledgePoints();
  const point = all[0];
  const before = await db.getKnowledgePoint(point.id);
  const prevLapses = Number(before.lapses ?? 0);

  const result = await db.recordReview(point.id, false);
  assert.ok(Number(result.lapses) >= prevLapses + 1);
});

test('getPlan returns 20 weeks ordered by week number', async () => {
  const plan = await db.getPlan();
  assert.equal(plan.length, 20);
  assert.equal(plan[0].week, 1);
  assert.equal(plan[19].week, 20);
  assert.ok(plan[0].title);
  assert.ok(plan[0].status);
});

test('updatePlanStatus sets status and returns updated item', async () => {
  const plan = await db.getPlan();
  const item = plan[0];
  const original = item.status;

  const updated = await db.updatePlanStatus(item.id, 'in-progress');
  assert.ok(updated, 'should return updated row');
  assert.equal(updated.status, 'in-progress');

  // Restore original status
  await db.updatePlanStatus(item.id, original);
});

test('updatePlanStatus returns null for nonexistent id', async () => {
  const result = await db.updatePlanStatus('00000000-0000-0000-0000-000000000000', 'done');
  assert.equal(result, null);
});

test('getPapers returns paper templates with required fields', async () => {
  const papers = await db.getPapers();
  assert.ok(papers.length > 0);
  assert.ok(papers[0].title);
  assert.ok(papers[0].content_md !== undefined, 'has content_md field');
});

test('addWrongItem and deleteWrongItem roundtrip', async () => {
  const all = await db.getKnowledgePoints();
  const point = all[0];

  const item = await db.addWrongItem(point.id, 'integration test note');
  assert.equal(item.knowledge_id, point.id);
  assert.equal(item.note, 'integration test note');
  assert.ok(item.id);

  const deleted = await db.deleteWrongItem(item.id);
  assert.equal(deleted, true);
});

test('deleteWrongItem returns false for nonexistent id', async () => {
  const result = await db.deleteWrongItem(999999999);
  assert.equal(result, false);
});

test('getWrongItems returns array with joined knowledge point fields', async () => {
  const all = await db.getKnowledgePoints();
  const point = all[0];

  const item = await db.addWrongItem(point.id, 'temp test');
  try {
    const items = await db.getWrongItems();
    assert.ok(Array.isArray(items));
    const found = items.find((i) => i.id === item.id);
    assert.ok(found, 'added item should appear in list');
    assert.ok(found.title, 'has joined title');
    assert.ok(found.module, 'has joined module');
  } finally {
    await db.deleteWrongItem(item.id);
  }
});
