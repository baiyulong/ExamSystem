const REQUIRED_STATE_ARRAYS = ['cards', 'plan', 'wrongItems'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value, key) {
  return typeof value[key] === 'string' && value[key].length > 0;
}

function isCard(value) {
  return isPlainObject(value)
    && hasString(value, 'id')
    && hasString(value, 'knowledgeId')
    && hasString(value, 'question')
    && hasString(value, 'answer')
    && hasString(value, 'priority')
    && Number.isInteger(value.intervalIndex)
    && value.intervalIndex >= 0
    && Number.isInteger(value.reviewCount)
    && Number.isInteger(value.lapseCount)
    && hasString(value, 'nextReviewAt')
    && hasString(value, 'status');
}

function isPlanItem(value) {
  return isPlainObject(value)
    && hasString(value, 'id')
    && Number.isInteger(value.week)
    && hasString(value, 'phase')
    && hasString(value, 'title')
    && hasString(value, 'focus')
    && hasString(value, 'status');
}

function isWrongItem(value) {
  return isPlainObject(value)
    && hasString(value, 'id')
    && hasString(value, 'title')
    && hasString(value, 'reason')
    && hasString(value, 'createdAt');
}

export function isStudyState(value) {
  if (!isPlainObject(value) || !hasString(value, 'startedAt')) return false;
  if (!REQUIRED_STATE_ARRAYS.every((key) => Array.isArray(value[key]))) return false;

  return value.cards.every(isCard)
    && value.plan.every(isPlanItem)
    && value.wrongItems.every(isWrongItem);
}

export function validateStudyState(value) {
  if (!isStudyState(value)) {
    throw new Error('Invalid study state: expected cards, plan, wrongItems, and startedAt');
  }
  return value;
}
