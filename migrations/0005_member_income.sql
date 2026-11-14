-- Ingresos netos mensuales de cada miembro: para aportar todos el mismo % de lo que cobran.
ALTER TABLE members ADD COLUMN monthly_income INTEGER NOT NULL DEFAULT 0;
