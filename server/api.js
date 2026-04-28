import { StudyStateValidationError, validateStudyState } from '../src/stateSchema.js';

const MAX_BODY_BYTES = 1_000_000;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large');
    this.name = 'RequestBodyTooLargeError';
  }
}

class InvalidJsonBodyError extends Error {
  constructor() {
    super('Request body must be valid JSON');
    this.name = 'InvalidJsonBodyError';
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let byteLength = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (settled) return;
      byteLength += Buffer.byteLength(chunk, 'utf8');
      if (byteLength > MAX_BODY_BYTES) {
        request.pause();
        fail(new RequestBodyTooLargeError());
        setImmediate(() => request.destroy());
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new InvalidJsonBodyError());
      }
    });
    request.on('error', fail);
  });
}

export async function routeApiRequest(request, response, { repository, logger = console } = {}) {
  const url = new URL(request.url ?? '/', 'http://localhost');

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, await repository.health());
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, await repository.loadState());
      return true;
    }

    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const payload = await readJsonBody(request);
      const state = validateStudyState(payload?.state);
      sendJson(response, 200, await repository.saveState(state));
      return true;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found' });
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof StudyStateValidationError) {
      sendJson(response, 400, { error: 'Invalid study state' });
      return true;
    }
    if (error instanceof RequestBodyTooLargeError || error instanceof InvalidJsonBodyError) {
      sendJson(response, 400, { error: error.message });
      return true;
    }

    logger.error('API request failed', {
      method: request.method,
      path: url.pathname,
      message: error.message,
    });
    sendJson(response, 500, { error: 'Persistence service failed' });
    return true;
  }
}
