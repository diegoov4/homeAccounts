-- Esquema inicial. Los importes se guardan en céntimos (enteros) para evitar errores de redondeo.

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_contribution INTEGER NOT NULL DEFAULT 0, -- aportación fija mensual a la cuenta común (céntimos)
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT 'Otros',
  budget INTEGER NOT NULL DEFAULT 0, -- presupuesto mensual (céntimos), 0 = sin presupuesto
  sort INTEGER NOT NULL DEFAULT 0
);

-- Gastos. paid_by NULL = pagado desde la cuenta común; si tiene un miembro, lo pagó esa persona por su cuenta.
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL REFERENCES categories(id),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  paid_by TEXT REFERENCES members(id),
  reimbursed INTEGER NOT NULL DEFAULT 0, -- 1 = ya se le ha devuelto desde la cuenta común
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_paid_by ON expenses(paid_by);

-- Ingresos en la cuenta común. member_id NULL = otro ingreso (devolución, ayuda…).
CREATE TABLE incomes (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL CHECK (amount > 0),
  member_id TEXT REFERENCES members(id),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_incomes_date ON incomes(date);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
