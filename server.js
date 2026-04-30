import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { routeApiRequest } from './server/api.js';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function safePath(urlPath, { root }) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  const candidate = normalize(join(root, decoded === '/' ? 'index.html' : decoded));
  if (!candidate.startsWith(root)) return null;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, 'index.html');
  return candidate;
}

export function createRequestHandler({ root = resolve('.') } = {}) {
  return async (request, response) => {
    const handledApi = await routeApiRequest(request, response);
    if (handledApi) return;

    const filePath = safePath(request.url ?? '/', { root });
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  };
}

const port = Number(process.env.PORT ?? 4173);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(createRequestHandler()).listen(port, () => {
    console.log(`Study system running at http://localhost:${port}`);
  });
}
