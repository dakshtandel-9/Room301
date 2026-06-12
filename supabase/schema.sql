create extension if not exists "pgcrypto";

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.room_users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) > 0),
  member_id uuid not null references public.room_members(id) on delete cascade,
  password_hash text not null,
  room_code text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null references public.room_members(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  participant_ids uuid[] not null,
  shares jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.room_members(id) on delete restrict,
  to_id uuid not null references public.room_members(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'verified')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);

alter table public.payments
  add column if not exists status text not null default 'pending'
  check (status in ('pending', 'verified'));

alter table public.payments
  add column if not exists verified_at timestamptz;

alter table public.room_members enable row level security;
alter table public.room_users enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;

drop policy if exists "Anyone can read room members" on public.room_members;
drop policy if exists "Anyone can add room members" on public.room_members;
drop policy if exists "Anyone can read room users" on public.room_users;
drop policy if exists "Anyone can add room users" on public.room_users;
drop policy if exists "Anyone can read expenses" on public.expenses;
drop policy if exists "Anyone can add expenses" on public.expenses;
drop policy if exists "Anyone can read payments" on public.payments;
drop policy if exists "Anyone can add payments" on public.payments;
drop policy if exists "Anyone can verify payments" on public.payments;

create policy "Anyone can read room members"
  on public.room_members for select
  using (true);

create policy "Anyone can add room members"
  on public.room_members for insert
  with check (true);

create policy "Anyone can read room users"
  on public.room_users for select
  using (true);

create policy "Anyone can add room users"
  on public.room_users for insert
  with check (true);

create policy "Anyone can read expenses"
  on public.expenses for select
  using (true);

create policy "Anyone can add expenses"
  on public.expenses for insert
  with check (true);

create policy "Anyone can read payments"
  on public.payments for select
  using (true);

create policy "Anyone can add payments"
  on public.payments for insert
  with check (true);

create policy "Anyone can verify payments"
  on public.payments for update
  using (true)
  with check (true);

create index if not exists expenses_created_at_idx
  on public.expenses (created_at desc);

create index if not exists payments_created_at_idx
  on public.payments (created_at desc);

create index if not exists room_users_name_idx
  on public.room_users (name);
