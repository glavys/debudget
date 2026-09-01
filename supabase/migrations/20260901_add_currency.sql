-- ══════════════════════════════════════════════════════
-- Migration: валюта расходов
--
-- 1. amount → numeric(14,2): в долларах бывают центы,
--    integer их бы срезал
-- 2. currency: 'RUB' | 'USD', все старые записи — рубли
-- 3. индекс под выборку "валюта + дата"
--
-- Скрипт идемпотентный: можно запускать повторно.
-- ══════════════════════════════════════════════════════

-- Шаг 1. Дробные суммы
ALTER TABLE expenses
  ALTER COLUMN amount TYPE numeric(14, 2);

-- Шаг 2. Колонка валюты
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RUB';

UPDATE expenses SET currency = 'RUB' WHERE currency IS NULL OR currency = '';

DO $$
BEGIN
  ALTER TABLE expenses
    ADD CONSTRAINT expenses_currency_check CHECK (currency IN ('RUB', 'USD'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Шаг 3. Индекс
CREATE INDEX IF NOT EXISTS expenses_currency_date_idx
  ON expenses (currency, expense_date DESC);
