import test from 'node:test';
import assert from 'node:assert/strict';

import { isStudyState, validateStudyState } from '../src/stateSchema.js';

const validState = {
  cards: [
    {
      id: 'card-quality-attributes',
      knowledgeId: 'quality-attributes',
      question: '质量属性如何影响架构设计？',
      answer: '质量属性决定架构取舍。',
      priority: 'P0',
      intervalIndex: 1,
      reviewCount: 2,
      lapseCount: 0,
      nextReviewAt: '2026-05-01',
      status: 'learning',
    },
  ],
  plan: [
    {
      id: 'week-1',
      week: 1,
      phase: '框架建立',
      title: '考试大纲与导学',
      focus: '建立考试地图',
      status: 'in-progress',
    },
  ],
  wrongItems: [
    {
      id: 'wrong-1',
      cardId: 'card-quality-attributes',
      title: '质量属性',
      reason: '容易混淆可用性和可靠性',
      createdAt: '2026-04-28',
    },
  ],
  startedAt: '2026-04-28',
};

test('isStudyState accepts the current persisted state shape', () => {
  assert.equal(isStudyState(validState), true);
});

test('isStudyState rejects missing required collections', () => {
  assert.equal(isStudyState({ ...validState, cards: undefined }), false);
  assert.equal(isStudyState({ ...validState, plan: undefined }), false);
  assert.equal(isStudyState({ ...validState, wrongItems: undefined }), false);
});

test('isStudyState rejects missing or empty startedAt', () => {
  assert.equal(isStudyState({ ...validState, startedAt: undefined }), false);
  assert.equal(isStudyState({ ...validState, startedAt: '' }), false);
});

test('isStudyState rejects invalid card shapes', () => {
  assert.equal(
    isStudyState({
      ...validState,
      cards: [{ ...validState.cards[0], intervalIndex: 'not-a-number' }],
    }),
    false,
  );

  assert.equal(
    isStudyState({
      ...validState,
      cards: [{ ...validState.cards[0], intervalIndex: -1 }],
    }),
    false,
  );

  assert.equal(
    isStudyState({
      ...validState,
      cards: [{ ...validState.cards[0], reviewCount: -1 }],
    }),
    false,
  );

  assert.equal(
    isStudyState({
      ...validState,
      cards: [{ ...validState.cards[0], lapseCount: -1 }],
    }),
    false,
  );
});

test('isStudyState rejects invalid plan item shapes', () => {
  const { week, ...invalidPlanItem } = validState.plan[0];

  assert.equal(
    isStudyState({
      ...validState,
      plan: [invalidPlanItem],
    }),
    false,
  );
});

test('isStudyState rejects invalid wrong item shapes', () => {
  const { reason, ...invalidWrongItem } = validState.wrongItems[0];

  assert.equal(
    isStudyState({
      ...validState,
      wrongItems: [invalidWrongItem],
    }),
    false,
  );
});

test('isStudyState accepts wrong items without cardId', () => {
  const { cardId, ...manualWrongItem } = validState.wrongItems[0];

  assert.equal(
    isStudyState({
      ...validState,
      wrongItems: [manualWrongItem],
    }),
    true,
  );
});

test('validateStudyState returns the original state for valid input', () => {
  assert.equal(validateStudyState(validState), validState);
});

test('validateStudyState throws a clear error for invalid input', () => {
  assert.throws(
    () => validateStudyState({ cards: [], plan: [], startedAt: '2026-04-28' }),
    /Invalid study state/,
  );
});
