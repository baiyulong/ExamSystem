import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

let _pool;
function getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

// ─── Dashboard ───────────────────────────────────────────────────────

export async function getDashboard() {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT
      (SELECT count(*)::int FROM card_progress WHERE next_due <= CURRENT_DATE) AS due_count,
      (SELECT count(*)::int FROM card_progress WHERE review_count > 0) AS reviewed_count,
      (SELECT count(*)::int FROM knowledge_points) AS total_cards,
      (SELECT count(*)::int FROM knowledge_points WHERE priority = 'P0') AS p0_total,
      (SELECT count(*)::int
         FROM card_progress cp
         JOIN knowledge_points kp ON kp.id = cp.id
         WHERE kp.priority = 'P0' AND cp.review_count > 0) AS p0_reviewed,
      (SELECT count(*)::int FROM study_plan WHERE status = 'done') AS done_weeks,
      (SELECT count(*)::int FROM wrong_items) AS wrong_count
  `);
  return rows[0];
}

// ─── Knowledge Points ────────────────────────────────────────────────

export async function getKnowledgePoints() {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT kp.id, kp.priority, kp.module, kp.title, kp.summary,
           kp.question, kp.answer,
           cp.review_count, cp.next_due, cp.interval_days, cp.lapses
    FROM knowledge_points kp
    LEFT JOIN card_progress cp ON kp.id = cp.id
    ORDER BY
      CASE kp.priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
      kp.module, kp.title
  `);
  return rows;
}

export async function getKnowledgePoint(id) {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT kp.*, cp.review_count, cp.next_due, cp.interval_days, cp.lapses
    FROM knowledge_points kp
    LEFT JOIN card_progress cp ON kp.id = cp.id
    WHERE kp.id = $1
  `, [id]);
  return rows[0] ?? null;
}

// ─── Cards / Review ──────────────────────────────────────────────────

export async function getDueCards() {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT kp.id, kp.priority, kp.module, kp.title, kp.question, kp.answer,
           cp.interval_days, cp.next_due, cp.review_count, cp.lapses
    FROM knowledge_points kp
    LEFT JOIN card_progress cp ON kp.id = cp.id
    WHERE cp.next_due IS NULL OR cp.next_due <= CURRENT_DATE
    ORDER BY
      CASE kp.priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
      cp.next_due NULLS FIRST
  `);
  return rows;
}

function computeNextInterval(intervalDays, reviewCount, known) {
  if (!known) {
    return { nextInterval: 1, lapsesDelta: 1 };
  }
  let next;
  if (reviewCount === 0) next = 1;
  else if (reviewCount === 1) next = 3;
  else if (reviewCount === 2) next = 7;
  else next = Math.min(Math.round(intervalDays * 2.5), 90);
  return { nextInterval: next, lapsesDelta: 0 };
}

export async function recordReview(id, known) {
  const db = getPool();
  const existing = await db.query(
    `SELECT interval_days, review_count, lapses FROM card_progress WHERE id = $1`,
    [id]
  );
  const cur = existing.rows[0] ?? { interval_days: 1, review_count: 0, lapses: 0 };
  const { nextInterval, lapsesDelta } = computeNextInterval(
    Number(cur.interval_days), Number(cur.review_count), known
  );
  const { rows } = await db.query(`
    INSERT INTO card_progress (id, interval_days, next_due, review_count, lapses, updated_at)
    VALUES ($1, $2, CURRENT_DATE + $2::int, $3, $4, NOW())
    ON CONFLICT (id) DO UPDATE SET
      interval_days = $2,
      next_due = CURRENT_DATE + $2::int,
      review_count = $3,
      lapses = card_progress.lapses + $4,
      updated_at = NOW()
    RETURNING *
  `, [id, nextInterval, Number(cur.review_count) + 1, lapsesDelta]);
  return rows[0];
}

// ─── Wrong Items ─────────────────────────────────────────────────────

export async function getWrongItems() {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT wi.id, wi.knowledge_id, wi.wrong_date, wi.note,
           kp.title, kp.module, kp.priority
    FROM wrong_items wi
    JOIN knowledge_points kp ON kp.id = wi.knowledge_id
    ORDER BY wi.wrong_date DESC, wi.id DESC
  `);
  return rows;
}

export async function addWrongItem(knowledgeId, note) {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO wrong_items (knowledge_id, note) VALUES ($1, $2) RETURNING *`,
    [knowledgeId, note ?? '']
  );
  return rows[0];
}

export async function deleteWrongItem(id) {
  const db = getPool();
  const result = await db.query(`DELETE FROM wrong_items WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

// ─── Study Plan ──────────────────────────────────────────────────────

export async function getPlan() {
  const db = getPool();
  const { rows } = await db.query(`SELECT * FROM study_plan ORDER BY week`);
  return rows;
}

export async function updatePlanStatus(id, status) {
  const db = getPool();
  const { rows } = await db.query(
    `UPDATE study_plan SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] ?? null;
}

// ─── Paper Templates ─────────────────────────────────────────────────

export async function getPapers() {
  const db = getPool();
  const { rows } = await db.query(`SELECT * FROM paper_templates ORDER BY id`);
  return rows;
}

// ─── Health ──────────────────────────────────────────────────────────

export async function checkHealth() {
  try {
    const db = getPool();
    await db.query('SELECT 1');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
