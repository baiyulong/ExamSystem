import { knowledgePoints, paperTemplates, studyPlan } from './data.js';
import {
  buildDailyTasks,
  createCardsFromKnowledge,
  formatDate,
  getDueCards,
  recordReview,
  sortKnowledgePoints,
} from './studyEngine.js';

const STORAGE_KEY = 'architect-exam-study-state-v1';

const today = () => new Date();

function initialState() {
  return {
    cards: createCardsFromKnowledge(knowledgePoints, today()),
    plan: studyPlan.map((item) => ({ ...item, status: item.week === 1 ? 'in-progress' : 'pending' })),
    wrongItems: [],
    startedAt: formatDate(today()),
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : initialState();
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

const $ = (selector) => document.querySelector(selector);
const panels = [...document.querySelectorAll('.panel')];

function renderDashboard() {
  const due = getDueCards(state.cards, today()).length;
  const reviewed = state.cards.filter((card) => card.reviewCount > 0).length;
  const p0Total = knowledgePoints.filter((point) => point.priority === 'P0').length;
  const p0Reviewed = state.cards.filter((card) => {
    const point = knowledgePoints.find((item) => item.id === card.knowledgeId);
    return point?.priority === 'P0' && card.reviewCount > 0;
  }).length;
  const doneWeeks = state.plan.filter((item) => item.status === 'done').length;

  $('#dashboard').innerHTML = [
    ['今日到期', `${due} 张`, '先复习，再学新内容'],
    ['卡片进度', `${reviewed}/${state.cards.length}`, '按 D1/D3/D7/D14/D30/D60/D90 推进'],
    ['P0 核心覆盖', `${p0Reviewed}/${p0Total}`, '案例与论文优先保障'],
    ['计划完成', `${doneWeeks}/20 周`, '周末用真题校准'],
  ].map(([label, value, hint]) => `
    <article class="metric">
      <span class="muted">${label}</span>
      <strong>${value}</strong>
      <small class="muted">${hint}</small>
    </article>
  `).join('');
}

function renderTasks() {
  const tasks = buildDailyTasks({ cards: state.cards, plan: state.plan, today: today() });
  $('#tasks').innerHTML = `
    <h2>今日任务</h2>
    <p class="muted">系统按记忆曲线优先级生成任务：到期复习 > 新知识 > 题目反馈。</p>
    ${tasks.map((task) => `
      <div class="task">
        <span class="pill">${task.type}</span>
        <div>
          <strong>${task.title}</strong>
          <p class="muted">${task.detail}</p>
        </div>
      </div>
    `).join('')}
  `;
}

function renderReview() {
  const due = getDueCards(state.cards, today());
  if (due.length === 0) {
    $('#review').innerHTML = '<h2>记忆卡片</h2><p class="muted">今天没有到期卡片，可以推进一个新知识点或做真题。</p>';
    return;
  }

  const card = due[0];
  const point = knowledgePoints.find((item) => item.id === card.knowledgeId);
  $('#review').innerHTML = `
    <div class="review-card">
      <h2>记忆卡片</h2>
      <p class="muted">剩余到期 ${due.length} 张 · ${point.module} · ${point.priority}</p>
      <div class="question">${card.question}</div>
      <div class="answer" hidden>${card.answer}</div>
      <div class="actions">
        <button class="show" type="button" id="show-answer">显示答案</button>
        <button class="forgotten" type="button" data-outcome="forgotten">模糊/忘记</button>
        <button class="known" type="button" data-outcome="known">记住了</button>
      </div>
    </div>
  `;
  $('#show-answer').addEventListener('click', () => {
    $('.answer').hidden = false;
  });
  document.querySelectorAll('[data-outcome]').forEach((button) => {
    button.addEventListener('click', () => {
      const outcome = button.dataset.outcome;
      const reviewed = recordReview(card, outcome, today());
      state.cards = state.cards.map((item) => item.id === card.id ? reviewed : item);
      if (outcome !== 'known') {
        state.wrongItems.unshift({
          id: `${card.id}-${Date.now()}`,
          cardId: card.id,
          title: point.title,
          reason: '卡片复习时选择“模糊/忘记”',
          createdAt: formatDate(today()),
        });
      }
      saveState(state);
      renderAll();
    });
  });
}

function renderKnowledge() {
  const grouped = sortKnowledgePoints(knowledgePoints);
  $('#knowledge').innerHTML = `
    <h2>知识点地图</h2>
    <p class="muted">P0 先学，P1 巩固，P2 稳定上午分，P3 用于论文和案例加分。</p>
    <div class="grid">
      ${grouped.map((point) => `
        <article class="card">
          <div class="meta">
            <span class="pill ${point.priority.toLowerCase()}">${point.priority}</span>
            <span class="pill">${point.module}</span>
          </div>
          <h3>${point.title}</h3>
          <p>${point.summary}</p>
          <details>
            <summary>资料路径</summary>
            <ul class="resource-list">${point.resources.map((resource) => `<li>${resource}</li>`).join('')}</ul>
          </details>
        </article>
      `).join('')}
    </div>
  `;
}

function renderPlan() {
  $('#plan').innerHTML = `
    <h2>20 周学习计划</h2>
    <p class="muted">每周一个主题，工作日学知识，周末用真题/案例/论文验证。</p>
    ${state.plan.map((item) => `
      <div class="plan-row">
        <strong>第 ${item.week} 周</strong>
        <span class="pill">${item.phase}</span>
        <div>
          <strong>${item.title}</strong>
          <p class="muted">${item.focus}</p>
        </div>
        <button class="ghost" type="button" data-plan="${item.id}">
          ${item.status === 'done' ? '已完成' : '标记完成'}
        </button>
      </div>
    `).join('')}
  `;
  document.querySelectorAll('[data-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      state.plan = state.plan.map((item) => (
        item.id === button.dataset.plan ? { ...item, status: 'done' } : item
      ));
      saveState(state);
      renderAll();
    });
  });
}

function renderWrongBook() {
  $('#wrong').innerHTML = `
    <h2>错题本</h2>
    <p class="muted">所有“模糊/忘记”的卡片会自动进入错题本；真题错题也可以手动记录。</p>
    <textarea id="wrong-note" placeholder="记录真题年份、题号、错因、正确思路、关联知识点"></textarea>
    <p><button class="primary" type="button" id="add-wrong">加入错题本</button></p>
    <div class="grid">
      ${state.wrongItems.map((item) => `
        <article class="card">
          <span class="pill p0">${item.createdAt}</span>
          <h3>${item.title}</h3>
          <p>${item.reason}</p>
        </article>
      `).join('') || '<p class="muted">暂无错题记录。</p>'}
    </div>
  `;
  $('#add-wrong').addEventListener('click', () => {
    const note = $('#wrong-note').value.trim();
    if (!note) return;
    state.wrongItems.unshift({
      id: `manual-${Date.now()}`,
      title: '手动错题',
      reason: note,
      createdAt: formatDate(today()),
    });
    saveState(state);
    renderAll();
  });
}

function renderPaper() {
  $('#paper').innerHTML = `
    <h2>论文模板库</h2>
    <p class="muted">优先准备 4 篇可套用模板，考前只背自己的项目版本。</p>
    <div class="grid">
      ${paperTemplates.map((template) => `
        <article class="card">
          <h3>${template.title}</h3>
          <p>${template.useFor}</p>
          <ol>${template.structure.map((item) => `<li>${item}</li>`).join('')}</ol>
        </article>
      `).join('')}
    </div>
  `;
}

function renderAll() {
  renderDashboard();
  renderTasks();
  renderReview();
  renderKnowledge();
  renderPlan();
  renderWrongBook();
  renderPaper();
}

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    panels.forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
  });
});

$('#reset-demo').addEventListener('click', () => {
  state = initialState();
  saveState(state);
  renderAll();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

renderAll();
