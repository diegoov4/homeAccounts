-- Datos iniciales: categorías por defecto y ajustes.
INSERT INTO categories (id, name, icon, color, grp, sort) VALUES
  ('hipoteca', 'Casa / Hipoteca', '🏠', '#64748b', 'Hogar', 1),
  ('luz', 'Luz', '💡', '#eab308', 'Hogar', 2),
  ('agua', 'Agua', '💧', '#0ea5e9', 'Hogar', 3),
  ('gas', 'Gas / Calefacción', '🔥', '#f97316', 'Hogar', 4),
  ('internet', 'Internet y móvil', '📶', '#8b5cf6', 'Hogar', 5),
  ('seguros', 'Seguros', '🛡️', '#0f766e', 'Hogar', 6),
  ('super', 'Supermercado', '🛒', '#16a34a', 'Alimentación', 7),
  ('cenas', 'Cenas fuera', '🍽️', '#e11d48', 'Alimentación', 8),
  ('colegio', 'Colegio', '🎒', '#2563eb', 'Niños', 9),
  ('ninos', 'Gastos niños', '🧸', '#f59e0b', 'Niños', 10),
  ('extraescolares', 'Extraescolares', '⚽', '#65a30d', 'Niños', 11),
  ('transporte', 'Coche y transporte', '🚗', '#14b8a6', 'Transporte', 12),
  ('salud', 'Salud', '💊', '#ec4899', 'Personal', 13),
  ('ropa', 'Ropa', '👕', '#c026d3', 'Personal', 14),
  ('ocio', 'Ocio y viajes', '🎬', '#7c3aed', 'Personal', 15),
  ('mascotas', 'Mascotas', '🐾', '#a16207', 'Otros', 16),
  ('otros', 'Otros', '📦', '#78716c', 'Otros', 17);

INSERT INTO settings (key, value) VALUES ('currency', 'EUR'), ('initial_balance', '0');
