// Pruebas rápidas contra la app publicada. Uso: npm run test:smoke [-- URL]
const U = (process.argv[2] || process.env.APP_URL || 'https://casitafeliz.diemo.dev').replace(/\/$/, '');
let failures = 0;
async function check(name, path, expect) {
  try {
    const r = await fetch(U + path, { redirect: 'manual' });
    const ok = await expect(r);
    console.log(`  ${ok ? '✅' : '❌'} ${name} (${r.status})`);
    if (!ok) failures++;
  } catch (e) { failures++; console.log(`  ❌ ${name}: ${e.message}`); }
}
console.log(`▶ ${U}`);
await check('página principal', '/', async (r) => r.status === 200 && (await r.text()).includes('Gastos de Casa'));
await check('estilos', '/css/styles.css', (r) => r.status === 200 && r.headers.get('content-type').includes('text/css'));
await check('app', '/js/app.js', (r) => r.status === 200 && r.headers.get('content-type').includes('javascript'));
await check('manifest PWA', '/manifest.webmanifest', (r) => r.status === 200);
await check('cabeceras de seguridad', '/', (r) => (r.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"));
await check('API protegida', '/api/data', (r) => r.status === 401);
await check('login redirige a Google', '/auth/login', (r) => r.status === 302 && (r.headers.get('location') || '').startsWith('https://accounts.google.com/'));
console.log(failures ? `❌ ${failures} fallidas` : '✅ Todo correcto');
process.exit(failures ? 1 : 0);
