export const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'];
export const MEMORY_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60, 90];

const priorityRank = (priority) => {
  const index = PRIORITY_ORDER.indexOf(priority);
  return index === -1 ? PRIORITY_ORDER.length : index;
};

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function recordReview(card, outcome, today = new Date()) {
  const known = outcome === 'known';
  const nextIntervalIndex = known
    ? Math.min((card.intervalIndex ?? 0) + 1, MEMORY_INTERVALS_DAYS.length - 1)
    : 0;
  const nextDays = MEMORY_INTERVALS_DAYS[nextIntervalIndex];

  return {
    ...card,
    intervalIndex: nextIntervalIndex,
    reviewCount: (card.reviewCount ?? 0) + 1,
    lapseCount: (card.lapseCount ?? 0) + (known ? 0 : 1),
    lastReviewedAt: formatDate(today),
    nextReviewAt: formatDate(addDays(today, nextDays)),
    status: known ? 'learning' : 'needs-review',
  };
}

export function getDueCards(cards, today = new Date()) {
  const todayKey = formatDate(today);
  return [...cards]
    .filter((card) => card.nextReviewAt <= todayKey)
    .sort((a, b) => (
      priorityRank(a.priority) - priorityRank(b.priority)
      || a.nextReviewAt.localeCompare(b.nextReviewAt)
      || a.id.localeCompare(b.id)
    ));
}

export function sortKnowledgePoints(points) {
  return [...points].sort((a, b) => (
    priorityRank(a.priority) - priorityRank(b.priority)
    || a.title.localeCompare(b.title, 'zh-CN')
  ));
}

export function buildDailyTasks({
  cards,
  plan,
  today = new Date(),
  maxReviewsBeforePause = 80,
}) {
  const dueCards = getDueCards(cards, today);
  const tasks = [];

  if (dueCards.length > 0) {
    tasks.push({
      type: 'review',
      title: `复习到期卡片 ${dueCards.length} 张`,
      detail: '先完成记忆曲线到期内容，再学习新知识。',
      count: dueCards.length,
    });
  }

  if (dueCards.length > maxReviewsBeforePause) {
    tasks.push({
      type: 'catch-up',
      title: '复盘错题/模糊卡片，暂停新增知识点',
      detail: '到期复习量过高时不要继续新增内容，先防止遗忘堆积。',
    });
    return tasks;
  }

  const nextLesson = plan.find((item) => item.status !== 'done');
  if (nextLesson) {
    tasks.push({
      type: 'learn',
      title: nextLesson.title,
      detail: nextLesson.focus ?? '完成当天新知识点，并新增 3-5 张复习卡片。',
      planId: nextLesson.id,
    });
  }

  tasks.push({
    type: 'practice',
    title: '完成 5-10 道选择题或 1 道案例小题',
    detail: '零碎时间用于题目反馈，错题必须关联知识点。',
  });

  return tasks;
}

export function createCardsFromKnowledge(points, startDate = new Date()) {
  return points.map((point, index) => ({
    id: `card-${point.id}`,
    knowledgeId: point.id,
    question: point.question,
    answer: point.answer,
    priority: point.priority,
    intervalIndex: 0,
    reviewCount: 0,
    lapseCount: 0,
    nextReviewAt: formatDate(addDays(startDate, index % 3)),
    status: 'new',
  }));
}
