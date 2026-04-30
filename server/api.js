import * as db from './database.js';

const MAX_BODY_BYTES = 100_000;

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let byteLength = 0;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      byteLength += Buffer.byteLength(chunk, 'utf8');
      if (byteLength > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    request.on('error', reject);
  });
}

// Route: GET /api/dashboard
async function handleDashboard(req, res) {
  const data = await db.getDashboard();
  sendJson(res, 200, data);
}

// Route: GET /api/knowledge
async function handleKnowledgeList(req, res) {
  const points = await db.getKnowledgePoints();
  sendJson(res, 200, points);
}

// Route: GET /api/knowledge/:id
async function handleKnowledgeDetail(req, res, id) {
  const point = await db.getKnowledgePoint(id);
  if (!point) return sendJson(res, 404, { error: 'Not found' });
  sendJson(res, 200, point);
}

// Route: GET /api/cards/due
async function handleDueCards(req, res) {
  const cards = await db.getDueCards();
  sendJson(res, 200, cards);
}

// Route: POST /api/cards/:id/review
async function handleReview(req, res, id) {
  const body = await readJsonBody(req);
  if (typeof body.known !== 'boolean') {
    return sendJson(res, 400, { error: 'known must be a boolean' });
  }
  const progress = await db.recordReview(id, body.known);
  sendJson(res, 200, progress);
}

// Route: GET /api/wrong
async function handleWrongList(req, res) {
  const items = await db.getWrongItems();
  sendJson(res, 200, items);
}

// Route: POST /api/wrong
async function handleWrongAdd(req, res) {
  const body = await readJsonBody(req);
  if (!body.knowledge_id) return sendJson(res, 400, { error: 'knowledge_id required' });
  const item = await db.addWrongItem(body.knowledge_id, body.note);
  sendJson(res, 201, item);
}

// Route: DELETE /api/wrong/:id
async function handleWrongDelete(req, res, id) {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return sendJson(res, 400, { error: 'Invalid id' });
  const deleted = await db.deleteWrongItem(numId);
  if (!deleted) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(204); res.end();
}

// Route: GET /api/plan
async function handlePlanList(req, res) {
  const plan = await db.getPlan();
  sendJson(res, 200, plan);
}

// Route: PUT /api/plan/:id
async function handlePlanUpdate(req, res, id) {
  const body = await readJsonBody(req);
  const valid = ['pending', 'in-progress', 'done'];
  if (!valid.includes(body.status)) return sendJson(res, 400, { error: 'Invalid status' });
  const item = await db.updatePlanStatus(id, body.status);
  if (!item) return sendJson(res, 404, { error: 'Not found' });
  sendJson(res, 200, item);
}

// Route: GET /api/papers
async function handlePapers(req, res) {
  const papers = await db.getPapers();
  sendJson(res, 200, papers);
}

// Route: GET /api/health
async function handleHealth(req, res) {
  const { ok } = await db.checkHealth();
  sendJson(res, ok ? 200 : 503, { ok });
}

export async function routeApiRequest(request, response, _opts = {}) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = request.method;

  if (!path.startsWith('/api/')) return false;

  try {
    // Dashboard
    if (method === 'GET' && path === '/api/dashboard') {
      await handleDashboard(request, response); return true;
    }
    // Knowledge points
    if (method === 'GET' && path === '/api/knowledge') {
      await handleKnowledgeList(request, response); return true;
    }
    const knowledgeDetailMatch = path.match(/^\/api\/knowledge\/(.+)$/);
    if (method === 'GET' && knowledgeDetailMatch) {
      await handleKnowledgeDetail(request, response, decodeURIComponent(knowledgeDetailMatch[1])); return true;
    }
    // Cards
    if (method === 'GET' && path === '/api/cards/due') {
      await handleDueCards(request, response); return true;
    }
    const reviewMatch = path.match(/^\/api\/cards\/(.+)\/review$/);
    if (method === 'POST' && reviewMatch) {
      await handleReview(request, response, decodeURIComponent(reviewMatch[1])); return true;
    }
    // Wrong items
    if (method === 'GET' && path === '/api/wrong') {
      await handleWrongList(request, response); return true;
    }
    if (method === 'POST' && path === '/api/wrong') {
      await handleWrongAdd(request, response); return true;
    }
    const wrongDeleteMatch = path.match(/^\/api\/wrong\/(\d+)$/);
    if (method === 'DELETE' && wrongDeleteMatch) {
      await handleWrongDelete(request, response, wrongDeleteMatch[1]); return true;
    }
    // Plan
    if (method === 'GET' && path === '/api/plan') {
      await handlePlanList(request, response); return true;
    }
    const planUpdateMatch = path.match(/^\/api\/plan\/(.+)$/);
    if (method === 'PUT' && planUpdateMatch) {
      await handlePlanUpdate(request, response, decodeURIComponent(planUpdateMatch[1])); return true;
    }
    // Papers
    if (method === 'GET' && path === '/api/papers') {
      await handlePapers(request, response); return true;
    }
    // Health
    if (method === 'GET' && path === '/api/health') {
      await handleHealth(request, response); return true;
    }

    sendJson(response, 404, { error: 'API route not found' });
    return true;

  } catch (err) {
    console.error('API error', { method, path, message: err.message });
    sendJson(response, 503, { error: 'Service error' });
    return true;
  }
}
