// Genera src/static-files.generated.js con todos los archivos de public/ embebidos.
// Wrangler lo ejecuta automáticamente antes de `deploy` y `dev` (ver [build] en wrangler.toml).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};
const BINARY = new Set(['.png', '.ico']);

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const entries = walk(PUBLIC).filter((f) => TYPES[extname(f)]).sort().map((f) => {
  const ext = extname(f);
  const path = '/' + relative(PUBLIC, f).split('\\').join('/');
  const buf = readFileSync(f);
  return `  ${JSON.stringify(path)}: { type: ${JSON.stringify(TYPES[ext])}, ${BINARY.has(ext) ? `base64: ${JSON.stringify(buf.toString('base64'))}` : `text: ${JSON.stringify(buf.toString('utf8'))}`} },`;
});
writeFileSync(join(ROOT, 'src/static-files.generated.js'), `// Archivo generado por scripts/embed-static.mjs. No editar.\nexport default {\n${entries.join('\n')}\n};\n`);
console.log(`Embebidos ${entries.length} archivos de public/`);
