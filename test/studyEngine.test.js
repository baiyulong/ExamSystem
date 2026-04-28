import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRIORITY_ORDER,
  buildDailyTasks,
  getDueCards,
  recordReview,
  sortKnowledgePoints,
} from '../src/studyEngine.js';

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

test('recordReview advances cards through the configured forgetting-curve intervals', () => {
  const card = {
    id: 'quality-attributes',
    intervalIndex: 0,
    nextReviewAt: '2026-04-28',
    reviewCount: 0,
    lapseCount: 0,
  };

  const reviewed = recordReview(card, 'known', day('2026-04-28'));

  assert.equal(reviewed.intervalIndex, 1);
  assert.equal(reviewed.reviewCount, 1);
  assert.equal(reviewed.lapseCount, 0);
  assert.equal(reviewed.nextReviewAt, '2026-05-01');
});

test('recordReview resets uncertain cards to tomorrow and tracks lapses', () => {
  const card = {
    id: 'atam',
    intervalIndex: 4,
    nextReviewAt: '2026-04-28',
    reviewCount: 5,
    lapseCount: 1,
  };

  const reviewed = recordReview(card, 'forgotten', day('2026-04-28'));

  assert.equal(reviewed.intervalIndex, 0);
  assert.equal(reviewed.reviewCount, 6);
  assert.equal(reviewed.lapseCount, 2);
  assert.equal(reviewed.nextReviewAt, '2026-04-29');
});

test('getDueCards returns only cards due today or earlier, ordered by priority then due date', () => {
  const cards = [
    { id: 'future', priority: 'P0', nextReviewAt: '2026-04-29' },
    { id: 'database', priority: 'P1', nextReviewAt: '2026-04-26' },
    { id: 'architecture', priority: 'P0', nextReviewAt: '2026-04-27' },
  ];

  const due = getDueCards(cards, day('2026-04-28'));

  assert.deepEqual(due.map((card) => card.id), ['architecture', 'database']);
});

test('sortKnowledgePoints orders by exam priority and keeps stable title order inside priorities', () => {
  const points = [
    { title: '项目管理', priority: 'P2' },
    { title: '质量属性', priority: 'P0' },
    { title: '软件工程', priority: 'P1' },
    { title: '架构评估', priority: 'P0' },
  ];

  const sorted = sortKnowledgePoints(points);

  assert.deepEqual(sorted.map((point) => point.title), ['架构评估', '质量属性', '软件工程', '项目管理']);
  assert.deepEqual(PRIORITY_ORDER, ['P0', 'P1', 'P2', 'P3']);
});

test('buildDailyTasks follows memory curve first and pauses new learning when review load is high', () => {
  const dueCards = Array.from({ length: 4 }, (_, index) => ({
    id: `card-${index}`,
    priority: 'P0',
    nextReviewAt: '2026-04-28',
  }));
  const plan = [
    { id: 'week-1', title: '考试大纲与导学', status: 'done' },
    { id: 'week-2', title: '操作系统基础', status: 'pending' },
  ];

  const tasks = buildDailyTasks({
    cards: dueCards,
    plan,
    today: day('2026-04-28'),
    maxReviewsBeforePause: 3,
  });

  assert.equal(tasks[0].type, 'review');
  assert.equal(tasks[0].title, '复习到期卡片 4 张');
  assert.equal(tasks.some((task) => task.type === 'learn'), false);
  assert.equal(tasks.at(-1).title, '复盘错题/模糊卡片，暂停新增知识点');
});
