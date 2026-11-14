/* Archivos de la app incluidos dentro del Worker (sin subida aparte de "assets").
 * El contenido lo genera scripts/embed-static.mjs a partir de public/.
 */
import GENERATED from './static-files.generated.js';

const FILES = Object.fromEntries(Object.entries(GENERATED).map(([path, f]) => [
  path,
  [f.text !== undefined ? f.text : Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)), f.type],
]));

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const etags = new Map();
async function etagFor(path, body) {
  if (!etags.has(path)) {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
    etags.set(path, '"' + [...hash.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('') + '"');
  }
  return etags.get(path);
}

export async function serveStatic(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Método no permitido', { status: 405 });
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = FILES[path];
  if (!file) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const [body, type] = file;
  const etag = await etagFor(path, body);
  // Sin caché larga: el navegador revalida con ETag y recibe las nuevas versiones al momento.
  const headers = { 'content-type': type, etag, 'cache-control': 'no-cache', ...SECURITY_HEADERS };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
