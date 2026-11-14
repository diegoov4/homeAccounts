-- Retiradas personales: dinero que sale de la cuenta común para un miembro (p. ej. su parte
-- personal de la nómina). No es gasto de la familia; resta de lo que aporta esa persona.
ALTER TABLE incomes ADD COLUMN kind TEXT NOT NULL DEFAULT 'income' CHECK (kind IN ('income', 'withdrawal'));
