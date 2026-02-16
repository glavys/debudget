alter table public.expenses enable row level security;
alter table public.car_expenses enable row level security;

drop policy if exists "expenses_select_own" on public.expenses;
drop policy if exists "expenses_insert_own" on public.expenses;
drop policy if exists "expenses_update_own" on public.expenses;
drop policy if exists "expenses_delete_own" on public.expenses;

drop policy if exists "car_select_own" on public.car_expenses;
drop policy if exists "car_insert_own" on public.car_expenses;
drop policy if exists "car_update_own" on public.car_expenses;
drop policy if exists "car_delete_own" on public.car_expenses;

create policy "expenses_select_own"
on public.expenses
for select
using (user_id = auth.uid());

create policy "expenses_insert_own"
on public.expenses
for insert
with check (user_id = auth.uid());

create policy "expenses_update_own"
on public.expenses
for update
using (user_id = auth.uid());

create policy "expenses_delete_own"
on public.expenses
for delete
using (user_id = auth.uid());

create policy "car_select_own"
on public.car_expenses
for select
using (user_id = auth.uid());

create policy "car_insert_own"
on public.car_expenses
for insert
with check (user_id = auth.uid());

create policy "car_update_own"
on public.car_expenses
for update
using (user_id = auth.uid());

create policy "car_delete_own"
on public.car_expenses
for delete
using (user_id = auth.uid());
