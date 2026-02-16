-- ══════════════════════════════════════════════════════
-- Migration: Merge car_expenses into expenses
--
-- Existing mirrored records in expenses have:
--   category = 'Машина', note = car subcategory (e.g. 'Топливо')
--
-- Strategy:
-- 1. Update mirrored records: set category = note (the car subcategory), clear note
-- 2. Catch any "Машина" leftovers without note
-- 3. Safety net: insert any car_expenses not yet mirrored
-- ══════════════════════════════════════════════════════

-- Step 1: Existing mirrors — promote subcategory to category
UPDATE expenses
SET category = note,
    note = NULL
WHERE category = 'Машина'
  AND note IS NOT NULL
  AND note != '';

-- Step 2: Any "Машина" without subcategory → rename to "Авто"
UPDATE expenses
SET category = 'Авто'
WHERE category = 'Машина';

-- Step 3: Safety net — insert car_expenses that were never mirrored
INSERT INTO expenses (expense_date, amount, category, note, user_id, created_at)
SELECT
  ce.expense_date,
  ce.amount,
  ce.category,
  ce.description,
  ce.user_id,
  ce.created_at
FROM car_expenses ce
WHERE NOT EXISTS (
  SELECT 1 FROM expenses e
  WHERE e.expense_date = ce.expense_date
    AND e.amount = ce.amount
    AND e.category = ce.category
);
