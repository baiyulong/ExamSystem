/* 备考系统主入口 — 所有数据从 API 实时读取，无 localStorage 依赖 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ─── API helpers ─────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  return res.json();
}

const get = (path) => api('GET', path);
const post = (path, body) => api('POST', path, body);
const put = (path, body) => api('PUT', path, body);
const del = (path) => api('DELETE', path);

// ─── State ───────────────────────────────────────────────────────────

let gDue = [];        // today's due cards
let gDueIndex = 0;    // current card index
let gFlipped = false; // card flipped state

// ─── Tab routing ─────────────────────────────────────────────────────

const panels = $$('.panel');

function switchTab(tabName) {
  $$('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  panels.forEach(p => p.classList.toggle('active', p.id === tabName));
  renderTab(tabName);
}

function renderTab(tabName) {
  if (tabName === 'tasks') renderTasks();
  else if (tabName === 'review') renderReview();
  else if (tabName === 'knowledge') renderKnowledge();
  else if (tabName === 'plan') renderPlan();
  else if (tabName === 'wrong') renderWrong();
  else if (tabName === 'paper') renderPaper();
}

// ─── Dashboard ───────────────────────────────────────────────────────

async function renderDashboard() {
  const d = await get('/api/dashboard');
  if (!d) return;
  $('#dashboard').innerHTML = [
    ['今日到期', `${d.due_count} 张`, '先复习，再学新内容'],
    ['卡片进度', `${d.reviewed_count}/${d.total_cards}`, '按记忆曲线推进'],
    ['P0 核心覆盖', `${d.p0_reviewed}/${d.p0_total}`, '案例与论文优先保障'],
    ['计划完成', `${d.done_weeks}/20 周`, '周末用真题校准'],
  ].map(([label, value, hint]) => `
    <article class="metric">
      <span class="muted">${label}</span>
      <strong>${value}</strong>
      <small class="muted">${hint}</small>
    </article>
  `).join('');
}

// ─── Tasks tab ───────────────────────────────────────────────────────

async function renderTasks() {
  const panel = $('#tasks');
  panel.innerHTML = '<p class="muted">加载中…</p>';
  const [due, plan] = await Promise.all([get('/api/cards/due'), get('/api/plan')]);
  if (!due || !plan) { panel.innerHTML = '<p class="muted">加载失败，请刷新</p>'; return; }

  gDue = due;
  gDueIndex = 0;

  const currentWeek = plan.find(w => w.status === 'in-progress');
  const overdue = due.filter(c => c.next_due && c.next_due < new Date().toISOString().slice(0,10));

  panel.innerHTML = `
    <h2>今日任务</h2>
    ${currentWeek ? `
      <div class="task-card">
        <h3>📅 本周学习：第 ${currentWeek.week} 周 · ${currentWeek.phase}</h3>
        <p>${currentWeek.title}</p>
        <p class="muted">${currentWeek.focus}</p>
      </div>
    ` : ''}
    <div class="task-card ${due.length > 0 ? 'urgent' : ''}">
      <h3>🔄 今日到期复习：${due.length} 张</h3>
      ${due.length > 0 ? `
        <p class="muted">按优先级排列：${due.slice(0,3).map(c => c.title).join('、')}${due.length > 3 ? '…' : ''}</p>
        <button onclick="switchTab('review')" type="button">开始复习</button>
      ` : '<p class="muted success">✅ 今日复习已完成！</p>'}
    </div>
    ${overdue.length > 0 ? `
      <div class="task-card urgent">
        <h3>⚠️ 逾期卡片：${overdue.length} 张</h3>
        <p class="muted">这些卡片已过期，建议优先复习。</p>
      </div>
    ` : ''}
  `;
}

// ─── Review tab ──────────────────────────────────────────────────────

async function renderReview() {
  const panel = $('#review');
  if (gDue.length === 0) {
    const due = await get('/api/cards/due');
    gDue = due ?? [];
    gDueIndex = 0;
  }

  if (gDue.length === 0) {
    panel.innerHTML = `
      <div class="review-card">
        <h2>记忆卡片</h2>
        <p class="muted success">✅ 今日无到期卡片，保持节奏！</p>
      </div>
    `;
    return;
  }

  if (gDueIndex >= gDue.length) {
    panel.innerHTML = `
      <div class="review-card">
        <h2>记忆卡片</h2>
        <p class="muted success">✅ 本批 ${gDue.length} 张卡片复习完成！</p>
        <button onclick="resetReview()" type="button">再次复习</button>
      </div>
    `;
    return;
  }

  const card = gDue[gDueIndex];
  gFlipped = false;
  panel.innerHTML = `
    <div class="review-card">
      <h2>记忆卡片</h2>
      <p class="muted">第 ${gDueIndex + 1}/${gDue.length} 张 · ${card.module} · ${card.priority}</p>
      <div class="question">${escHtml(card.question)}</div>
      <div class="answer hidden" id="card-answer">${escHtml(card.answer)}</div>
      <div class="review-actions">
        <button onclick="flipCard()" id="btn-flip" type="button">显示答案</button>
        <button onclick="submitReview(true)" id="btn-known" class="hidden" type="button">✅ 记住了</button>
        <button onclick="submitReview(false)" id="btn-unknown" class="hidden danger" type="button">❌ 没记住</button>
        <button onclick="markWrong('${card.id}')" id="btn-wrong" class="hidden muted-btn" type="button">📌 加入错题</button>
      </div>
      <p class="muted hint">间隔：${card.interval_days ?? 1}天 · 复习次数：${card.review_count ?? 0} · 遗忘：${card.lapses ?? 0}</p>
    </div>
  `;
}

window.flipCard = function () {
  gFlipped = true;
  $('#card-answer')?.classList.remove('hidden');
  $('#btn-flip')?.classList.add('hidden');
  $('#btn-known')?.classList.remove('hidden');
  $('#btn-unknown')?.classList.remove('hidden');
  $('#btn-wrong')?.classList.remove('hidden');
};

window.resetReview = async function () {
  const due = await get('/api/cards/due');
  gDue = due ?? [];
  gDueIndex = 0;
  renderReview();
};

window.submitReview = async function (known) {
  const card = gDue[gDueIndex];
  if (!card) return;
  await post(`/api/cards/${encodeURIComponent(card.id)}/review`, { known });
  gDueIndex++;
  renderReview();
  renderDashboard();
};

window.markWrong = async function (id) {
  await post('/api/wrong', { knowledge_id: id, note: '' });
  const btn = $('#btn-wrong');
  if (btn) { btn.textContent = '✅ 已加入错题'; btn.disabled = true; }
};

// ─── Knowledge tab ───────────────────────────────────────────────────

async function renderKnowledge() {
  const panel = $('#knowledge');
  panel.innerHTML = '<p class="muted">加载知识点…</p>';
  const points = await get('/api/knowledge');
  if (!points) { panel.innerHTML = '<p class="muted">加载失败</p>'; return; }

  const grouped = groupBy(points, p => p.priority);
  const priorities = ['P0', 'P1', 'P2', 'P3'];
  const labels = { P0: '🔴 P0 核心必掌握', P1: '🟠 P1 重点', P2: '🟡 P2 上午基础', P3: '🟢 P3 补充' };

  panel.innerHTML = `
    <h2>知识点地图</h2>
    <p class="muted">点击卡片展开全部内容。P0 先学，P1 巩固，P2 稳定上午分，P3 加分素材。</p>
    <p class="muted">共 ${points.length} 个知识点</p>
    ${priorities.filter(p => grouped[p]?.length).map(priority => `
      <section class="kp-group">
        <h3>${labels[priority]} (${grouped[priority].length})</h3>
        <div class="kp-list">
          ${grouped[priority].map(point => renderKnowledgeCard(point)).join('')}
        </div>
      </section>
    `).join('')}
  `;
}

function renderKnowledgeCard(point) {
  const reviewInfo = point.review_count > 0
    ? `复习 ${point.review_count} 次`
    : '未复习';
  return `
    <div class="kp-card" id="kp-${escAttr(point.id)}" onclick="toggleKnowledgeCard('${escAttr(point.id)}')">
      <div class="kp-header">
        <span class="priority-badge p-${point.priority.toLowerCase()}">${point.priority}</span>
        <span class="kp-module">${escHtml(point.module)}</span>
        <strong class="kp-title">${escHtml(point.title)}</strong>
        <span class="kp-meta muted">${reviewInfo}</span>
        <span class="kp-toggle">▶</span>
      </div>
      <div class="kp-summary muted">${escHtml(point.summary)}</div>
      <div class="kp-detail hidden">
        <div class="kp-content-loading muted">加载中…</div>
      </div>
    </div>
  `;
}

window.toggleKnowledgeCard = async function (id) {
  const card = $(`#kp-${CSS.escape(id)}`);
  if (!card) return;
  const detail = card.querySelector('.kp-detail');
  const toggle = card.querySelector('.kp-toggle');
  const isOpen = !detail.classList.contains('hidden');

  if (isOpen) {
    detail.classList.add('hidden');
    toggle.textContent = '▶';
    return;
  }

  detail.classList.remove('hidden');
  toggle.textContent = '▼';

  // Load full content if not yet loaded
  if (detail.querySelector('.kp-content-loading')) {
    const point = await get(`/api/knowledge/${encodeURIComponent(id)}`);
    if (!point) { detail.innerHTML = '<p class="muted">加载失败</p>'; return; }
    detail.innerHTML = `
      <div class="kp-content">${mdToHtml(point.content_md)}</div>
      <div class="kp-qa">
        <div class="qa-question"><strong>考题：</strong>${escHtml(point.question)}</div>
        <div class="qa-answer"><strong>要点：</strong>${escHtml(point.answer)}</div>
      </div>
      <div class="kp-actions">
        <button onclick="event.stopPropagation(); markWrong('${escAttr(id)}')" type="button" class="muted-btn">📌 加入错题</button>
      </div>
    `;
  }
};

// ─── Plan tab ────────────────────────────────────────────────────────

async function renderPlan() {
  const panel = $('#plan');
  panel.innerHTML = '<p class="muted">加载中…</p>';
  const plan = await get('/api/plan');
  if (!plan) { panel.innerHTML = '<p class="muted">加载失败</p>'; return; }

  const phases = [...new Set(plan.map(w => w.phase))];

  panel.innerHTML = `
    <h2>20 周学习计划</h2>
    <p class="muted">点击"完成"标记当前周，进度实时保存。</p>
    ${phases.map(phase => `
      <section class="plan-phase">
        <h3>${phase}</h3>
        ${plan.filter(w => w.phase === phase).map(week => `
          <div class="plan-week status-${week.status}">
            <div class="plan-week-header">
              <span class="week-num">第 ${week.week} 周</span>
              <span class="week-title">${escHtml(week.title)}</span>
              <span class="status-badge">${statusLabel(week.status)}</span>
            </div>
            <p class="muted week-focus">${escHtml(week.focus)}</p>
            <div class="plan-actions">
              ${week.status !== 'done' ? `<button onclick="updatePlanStatus('${week.id}', 'done')" type="button">✅ 标记完成</button>` : ''}
              ${week.status === 'pending' ? `<button onclick="updatePlanStatus('${week.id}', 'in-progress')" type="button">▶ 开始</button>` : ''}
              ${week.status !== 'pending' ? `<button onclick="updatePlanStatus('${week.id}', 'pending')" type="button" class="muted-btn">↩ 重置</button>` : ''}
            </div>
          </div>
        `).join('')}
      </section>
    `).join('')}
  `;
}

window.updatePlanStatus = async function (id, status) {
  await put(`/api/plan/${id}`, { status });
  renderPlan();
  renderDashboard();
};

function statusLabel(s) {
  if (s === 'done') return '✅ 已完成';
  if (s === 'in-progress') return '▶ 进行中';
  return '⏳ 待开始';
}

// ─── Wrong book tab ──────────────────────────────────────────────────

async function renderWrong() {
  const panel = $('#wrong');
  panel.innerHTML = '<p class="muted">加载中…</p>';
  const items = await get('/api/wrong');
  if (!items) { panel.innerHTML = '<p class="muted">加载失败</p>'; return; }

  if (items.length === 0) {
    panel.innerHTML = '<h2>错题本</h2><p class="muted">暂无错题，继续加油！</p>';
    return;
  }

  panel.innerHTML = `
    <h2>错题本</h2>
    <p class="muted">共 ${items.length} 条错题记录</p>
    <div class="wrong-list">
      ${items.map(item => `
        <div class="wrong-item">
          <div class="wrong-header">
            <span class="priority-badge p-${item.priority?.toLowerCase()}">${item.priority}</span>
            <span class="muted">${item.module}</span>
            <strong>${escHtml(item.title)}</strong>
            <span class="muted">${item.wrong_date}</span>
            <button onclick="deleteWrong(${item.id})" type="button" class="muted-btn">🗑️</button>
          </div>
          ${item.note ? `<p class="wrong-note muted">${escHtml(item.note)}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

window.deleteWrong = async function (id) {
  await del(`/api/wrong/${id}`);
  renderWrong();
};

// ─── Paper tab ───────────────────────────────────────────────────────

async function renderPaper() {
  const panel = $('#paper');
  panel.innerHTML = '<p class="muted">加载中…</p>';
  const papers = await get('/api/papers');
  if (!papers) { panel.innerHTML = '<p class="muted">加载失败</p>'; return; }

  panel.innerHTML = `
    <h2>论文模板</h2>
    <p class="muted">点击展开模板全文，按自身项目经历改写后背诵。</p>
    ${papers.map(paper => `
      <div class="paper-card" onclick="togglePaper('${escAttr(paper.id)}')">
        <div class="paper-header">
          <strong>${escHtml(paper.title)}</strong>
          <span class="paper-toggle">▶</span>
        </div>
        <p class="muted">${escHtml(paper.use_for)}</p>
        <div class="paper-structure">
          ${(paper.structure || []).map(s => `<span class="struct-tag">${escHtml(s)}</span>`).join('')}
        </div>
        <div class="paper-content hidden" id="paper-content-${escAttr(paper.id)}">
          ${paper.content_md ? mdToHtml(paper.content_md) : '<p class="muted">暂无内容</p>'}
        </div>
      </div>
    `).join('')}
  `;
}

window.togglePaper = function (id) {
  const content = $(`#paper-content-${CSS.escape(id)}`);
  const toggle = content?.closest('.paper-card')?.querySelector('.paper-toggle');
  if (!content) return;
  const isOpen = !content.classList.contains('hidden');
  content.classList.toggle('hidden', isOpen);
  if (toggle) toggle.textContent = isOpen ? '▶' : '▼';
};

// ─── Utilities ───────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function groupBy(arr, fn) {
  return arr.reduce((acc, item) => {
    const key = fn(item);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
}

/** Very minimal Markdown → HTML: headings, bold, lists, line breaks */
function mdToHtml(md) {
  return escHtml(md)
    .replace(/^#{3}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{2}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{1}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^([^<\n].*)$/gm, (_, l) => l.trim() ? l : '')
    .replace(/^(?!<[hul])(?!$)(.+)$/gm, '$1<br>');
}

// ─── Reset ───────────────────────────────────────────────────────────

async function resetProgress() {
  if (!confirm('确定要重置所有学习进度吗？此操作不可撤销。')) return;
  // Reset card progress to initial state (re-run seed reset)
  await fetch('/api/admin/reset', { method: 'POST' }).catch(() => {});
  alert('进度已重置，页面将刷新');
  location.reload();
}

// ─── Init ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Tab navigation
  $$('nav.tabs button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Reset button
  const resetBtn = $('#reset-demo');
  if (resetBtn) resetBtn.addEventListener('click', resetProgress);

  // Load dashboard + initial tab
  await renderDashboard();
  switchTab('tasks');
});
