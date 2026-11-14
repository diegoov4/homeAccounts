-- Inicio de sesión con Google: sesiones y email de cada miembro.

-- Sesiones activas. id = hash SHA-256 del token que guarda la cookie.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Email de Google de cada miembro: le da acceso a la app y permite saber "quién soy".
ALTER TABLE members ADD COLUMN email TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_members_email ON members(lower(email)) WHERE email <> '';
