-- 知识点定义（静态内容，seed 写入一次）
CREATE TABLE IF NOT EXISTS knowledge_points (
  id          TEXT PRIMARY KEY,
  priority    TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  module      TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  content_md  TEXT NOT NULL,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL
);

-- 卡片学习进度（每次复习后实时更新）
CREATE TABLE IF NOT EXISTS card_progress (
  id            TEXT PRIMARY KEY REFERENCES knowledge_points(id) ON DELETE CASCADE,
  interval_days INTEGER NOT NULL DEFAULT 1,
  next_due      DATE NOT NULL DEFAULT CURRENT_DATE,
  review_count  INTEGER NOT NULL DEFAULT 0,
  lapses        INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 错题记录
CREATE TABLE IF NOT EXISTS wrong_items (
  id            SERIAL PRIMARY KEY,
  knowledge_id  TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  wrong_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT NOT NULL DEFAULT ''
);

-- 20周学习计划进度
CREATE TABLE IF NOT EXISTS study_plan (
  id      TEXT PRIMARY KEY,
  week    INTEGER NOT NULL,
  title   TEXT NOT NULL,
  phase   TEXT NOT NULL,
  focus   TEXT NOT NULL,
  status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in-progress','done'))
);

-- 论文模板
CREATE TABLE IF NOT EXISTS paper_templates (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  use_for    TEXT NOT NULL,
  structure  JSONB NOT NULL,
  content_md TEXT NOT NULL DEFAULT ''
);
