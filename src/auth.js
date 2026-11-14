/* Inicio de sesión con Google (OpenID Connect, flujo "authorization code" + PKCE).
 *
 * - /auth/login     → redirige a Google
 * - /auth/callback  → Google vuelve aquí; se crea la sesión (cookie HttpOnly) y se vuelve a la app
 * - /auth/logout    → (POST) cierra la sesión
 *
 * Solo pueden entrar los emails de ALLOWED_EMAILS (secreto, separados por comas)
 * o los que tenga asignados algún miembro de la familia en la app.
 * Las sesiones se guardan en D1 (tabla sessions) como hash SHA-256 del token.
 */

const SESSION_COOKIE = '__Host-gc_session';
const OAUTH_COOKIE = '__Host-gc_oauth';
const SESSION_DAYS = 30;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// ---------------------------------------------------------------- utilidades
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

function parseCookies(request) {
  const out = {};
  (request.headers.get('cookie') || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 302, headers });
}

function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new Error('id_token no válido');
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

function config(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el Worker');
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    // Las URLs solo se cambian en pruebas locales (servidor de Google simulado).
    authUrl: env.GOOGLE_AUTH_URL || GOOGLE_AUTH_URL,
    tokenUrl: env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL,
  };
}

/** ¿Está este email en la lista fija ALLOWED_EMAILS? */
export function inAllowList(env, email) {
  const e = normEmail(email);
  return Boolean(e) && String(env.ALLOWED_EMAILS || '').split(',').map(normEmail).includes(e);
}

/** ¿Puede entrar este email? (lista fija o email de algún miembro) */
export async function isAllowed(env, email) {
  const e = normEmail(email);
  if (!e) return false;
  if (inAllowList(env, e)) return true;
  const row = await env.DB.prepare('SELECT 1 FROM members WHERE lower(email) = ?1').bind(e).first();
  return Boolean(row);
}

/** Devuelve el usuario de la sesión actual o null. */
export async function getSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare('SELECT email, name, picture FROM sessions WHERE id = ?1 AND expires_at > ?2')
    .bind(await sha256(token), Date.now()).first();
  if (!row) return null;
  // si se le ha quitado el acceso, la sesión deja de valer
  if (!(await isAllowed(env, row.email))) return null;
  return row;
}

// ---------------------------------------------------------------- rutas /auth/*
export async function handleAuth(request, env, url) {
  const loginError = (code, extra = '') => redirect(`/?login_error=${code}${extra}`, [cookie(OAUTH_COOKIE, '', 0)]);

  if (url.pathname === '/auth/login' && request.method === 'GET') {
    const cfg = config(env);
    const state = randomToken(16);
    const nonce = randomToken(16);
    const verifier = randomToken(48);
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: `${url.origin}/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await sha256(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return redirect(`${cfg.authUrl}?${params}`, [cookie(OAUTH_COOKIE, `${state}.${nonce}.${verifier}`, 600)]);
  }

  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const cfg = config(env);
    const [state, nonce, verifier] = (parseCookies(request)[OAUTH_COOKIE] || '').split('.');
    if (url.searchParams.get('error')) return loginError('cancelled');
    if (!state || url.searchParams.get('state') !== state) return loginError('state');

    let claims;
    try {
      const res = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: url.searchParams.get('code') || '',
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: `${url.origin}/auth/callback`,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      });
      if (!res.ok) throw new Error(`token ${res.status}`);
      const tokens = await res.json();
      // El id_token llega directamente de Google por TLS, así que basta con validar sus campos.
      claims = decodeJwtPayload(tokens.id_token);
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('iss');
      if (!aud.includes(cfg.clientId)) throw new Error('aud');
      if (!(claims.exp * 1000 > Date.now())) throw new Error('exp');
      if (claims.nonce !== nonce) throw new Error('nonce');
      if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('email_verified');
    } catch (err) {
      console.error('Error en el login con Google:', err && err.message);
      return loginError('failed');
    }

    const email = normEmail(claims.email);
    if (!(await isAllowed(env, email))) return loginError('not_allowed', `&email=${encodeURIComponent(email)}`);

    const token = randomToken(32);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
      env.DB.prepare('INSERT INTO sessions (id, email, name, picture, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(await sha256(token), email, String(claims.name || '').slice(0, 100), String(claims.picture || '').slice(0, 500), now, now + SESSION_DAYS * 864e5),
    ]);
    return redirect('/', [cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400), cookie(OAUTH_COOKIE, '', 0)]);
  }

  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(await sha256(token)).run();
    const headers = new Headers({ 'content-type': 'application/json', 'set-cookie': cookie(SESSION_COOKIE, '', 0) });
    return new Response('{"ok":true}', { headers });
  }

  return new Response('No encontrado', { status: 404 });
}
