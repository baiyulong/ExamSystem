import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { routeApiRequest } from './server/api.js';
import { createDatabaseStateRepository } from './server/database.js';

const root = resolve('.');
const port = Number(process.env.PORT ?? 4173);
const repository = createDatabaseStateRepository();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = normalize(join(root, decoded === '/' ? 'index.html' : decoded));
  if (!candidate.startsWith(root)) return null;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, 'index.html');
  return candidate;
}

createServer(async (request, response) => {
  const handledApi = await routeApiRequest(request, response, { repository });
  if (handledApi) return;

  const filePath = safePath(request.url ?? '/');
  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Study system running at http://localhost:${port}`);
});
