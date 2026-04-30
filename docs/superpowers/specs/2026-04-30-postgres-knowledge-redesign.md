# 设计文档：知识点全量入库 + 本地 Postgres 直连

**日期：** 2026-04-30  
**状态：** 待实现

---

## 问题陈述

当前系统有两个核心缺陷：

1. **知识点内容不完整**：`src/data.js` 只有 17 个知识领域的简短摘要，用户复习时必须翻阅 PDF 文档。资料中实际有 100+ 考点的完整内容。

2. **持久化过度复杂**：`src/persistence.js`（580 行）实现了云端同步、脏标记、冲突队列等机制，但实际上只需要一个本地 Postgres 数据库直接读写。

## 目标

- 所有 100+ 考点的全文内容（表格、对比、定义）可在系统内直接阅读，无需查文档。
- 所有用户数据（卡片进度、错题、计划状态）实时写入 PostgreSQL。
- 彻底删除 localStorage 状态管理和云端同步代码。

---

## 架构

```
浏览器（纯 fetch 调用，无 localStorage 状态）
        ↓
Node.js HTTP Server（静态文件 + REST API）
        ↓
PostgreSQL 10.122.130.168:32825
```

### 删除的代码

| 文件 | 原因 |
|------|------|
| `src/persistence.js` | 580 行云端同步逻辑全部删除 |
| `src/startupLoad.js` | 竞态控制（云端同步专用） |
| `src/stateSchema.js` | localStorage schema 校验（不再使用） |
| `src/data.js` | 所有数据迁入 DB |
| `test/persistence.test.js` | 删除后无需测试 |
| `test/startupLoad.test.js` | 删除后无需测试 |
| `test/syncStatusUi.test.js` | 同步状态 UI 删除 |

### 改写的文件

| 文件 | 变更内容 |
|------|---------|
| `server/database.js` | 重写：5 张表的 CRUD，删除版本冲突逻辑 |
| `server/api.js` | 重写：10+ REST 端点 |
| `src/app.js` | 重写：所有数据改为异步 fetch，删除 localStorage 引用 |
| `src/studyEngine.js` | 保留为纯函数文件，在 `server/api.js` 中直接 import 使用 |
| `styles.css` | 删除同步状态样式，添加知识点卡片展开样式 |
| `index.html` | 删除 `#sync-status` 元素 |
| `service-worker.js` | 保留，但删除 API 状态缓存相关逻辑，只缓存静态资源（HTML/CSS/JS） |

### 新增的文件

| 文件 | 内容 |
|------|------|
| `server/schema.sql` | 建表 DDL |
| `server/seed.js` | 从提取文本生成知识点数据并写入 DB |

---

## 数据库 Schema

```sql
-- 知识点定义（静态内容，seed 写入一次，更新时重新 seed）
CREATE TABLE knowledge_points (
  id          TEXT PRIMARY KEY,
  priority    TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  module      TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,       -- 一句话摘要，列表视图显示
  content_md  TEXT NOT NULL,       -- 全文内容（Markdown），展开后显示
  question    TEXT NOT NULL,       -- 记忆卡正面
  answer      TEXT NOT NULL        -- 记忆卡背面
);

-- 卡片学习进度（每次复习后实时更新）
CREATE TABLE card_progress (
  id            TEXT PRIMARY KEY REFERENCES knowledge_points(id),
  interval_days INTEGER NOT NULL DEFAULT 1,
  next_due      DATE NOT NULL DEFAULT CURRENT_DATE,
  review_count  INTEGER NOT NULL DEFAULT 0,
  lapses        INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 错题记录
CREATE TABLE wrong_items (
  id            SERIAL PRIMARY KEY,
  knowledge_id  TEXT NOT NULL REFERENCES knowledge_points(id),
  wrong_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT DEFAULT ''
);

-- 20周学习计划进度
CREATE TABLE study_plan (
  id      TEXT PRIMARY KEY,              -- 'week-01' .. 'week-20'
  week    INTEGER NOT NULL,
  title   TEXT NOT NULL,
  phase   TEXT NOT NULL,
  focus   TEXT NOT NULL,
  status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in-progress','done'))
);

-- 论文模板（静态，seed 写入）
CREATE TABLE paper_templates (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  use_for    TEXT NOT NULL,
  structure  JSONB NOT NULL,
  content_md TEXT NOT NULL DEFAULT ''
);
```

---

## API 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/dashboard` | 仪表板统计（到期卡数、进度、P0覆盖率） |
| GET | `/api/knowledge` | 知识点列表（不含全文） |
| GET | `/api/knowledge/:id` | 单个知识点详情（含 content_md） |
| GET | `/api/cards/due` | 今日到期卡片列表 |
| POST | `/api/cards/:id/review` | 记录复习 `{known: boolean}` |
| GET | `/api/wrong` | 错题列表 |
| POST | `/api/wrong` | 添加错题 `{knowledge_id, note}` |
| DELETE | `/api/wrong/:id` | 删除错题 |
| GET | `/api/plan` | 20周计划列表 |
| PUT | `/api/plan/:id` | 更新周状态 `{status}` |
| GET | `/api/papers` | 论文模板列表 |

**错误处理：** 所有端点返回标准 `{error: string}` JSON，HTTP 状态码 4xx/5xx。DB 连接失败返回 503。

---

## 记忆曲线算法（服务端）

`POST /api/cards/:id/review` 接收 `{known: true/false}`，服务端基于 SM-2 变体计算新的 `interval_days`：

```
known=true:
  if review_count == 0: interval = 1
  if review_count == 1: interval = 3
  else: interval = min(interval * 2, 90)
  next_due = today + interval

known=false:
  lapses += 1
  interval = 1
  next_due = tomorrow
```

写入 `card_progress`，返回更新后的进度。

---

## 前端 UI 变更

### 知识点地图（最大变化）

- 按 P0 / P1 / P2 / P3 分组展示所有知识点
- 每张卡片显示：优先级徽章、模块、标题、一句话摘要
- 点击卡片 → 内联展开：`content_md` 渲染为 HTML + Q&A
- 多张可同时展开（手风琴或独立展开均可）

### 移除的 UI

- `#sync-status` 同步状态徽章
- 同步状态相关 CSS（`data-status` 变体）

### 其余模块

数据改为异步 fetch，UI 逻辑基本不变：

```javascript
// 新的数据加载模式（示例）
async function init() {
  const [dashboard, due, plan, wrong, papers] = await Promise.all([
    fetch('/api/dashboard').then(r => r.json()),
    fetch('/api/cards/due').then(r => r.json()),
    fetch('/api/plan').then(r => r.json()),
    fetch('/api/wrong').then(r => r.json()),
    fetch('/api/papers').then(r => r.json()),
  ]);
  render({ dashboard, due, plan, wrong, papers });
}
```

---

## 内容提取计划

**来源：** `2024年系统架构设计师核心考点提炼.txt`（已提取，872 行，100+ 考点）

**提取策略（`server/seed.js`）：**
1. 解析文本，按"考点 N"分割为条目
2. 每个条目生成 knowledge_point 记录：
   - `id`：slug 化（如 `kp-001-cpu`）
   - `priority`：按考点编号和模块映射（P0/P1/P2/P3）
   - `module`：从考点标题推断
   - `title`：考点标题
   - `summary`：第一句话
   - `content_md`：考点全文（保留表格格式）
   - `question` / `answer`：从内容中提取或生成关键问答
3. 同时 seed `study_plan`（20周）和 `paper_templates`（4 篇）

---

## 测试策略

**保留的测试（适配新 API）：**
- `test/studyEngine.test.js` → 移到 server 端，测试记忆曲线函数
- `test/database.test.js` → 重写：测试 5 张表的 CRUD
- `test/api.test.js` → 重写：测试 10+ 端点

**删除的测试：**
- `test/persistence.test.js`（39 项，全部删除）
- `test/startupLoad.test.js`
- `test/syncStatusUi.test.js`

**新增的测试：**
- `test/seed.test.js`：验证 seed 数据格式正确性

---

## 实现顺序

1. 建表并配置 DB 连接（`.env` 更新）
2. 编写并执行 `seed.js`（内容导入）
3. 重写 `server/database.js`（5张表 CRUD）
4. 重写 `server/api.js`（10+ 端点）
5. 重写 `src/app.js`（删除 localStorage，改为异步 fetch）
6. 更新 `index.html` + `styles.css`（删除同步 UI，添加展开样式）
7. 删除旧文件（persistence.js 等）
8. 更新/补充测试
9. 端到端验证
