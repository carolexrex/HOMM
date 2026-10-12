-- An installation created before submission IDs existed (schema as of commit 1362edc),
-- with a turn already played, to check that schema.sql migrates it in place.
create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  is_guest boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('hotseat', 'online')),
  map_id text not null,
  invite_code text unique,
  invite_expires_at timestamptz not null default (now() + interval '14 days'),
  current_player text not null check (current_player in ('sun', 'moon')),
  turn_number integer not null default 1,
  winner text check (winner in ('sun', 'moon')),
  state jsonb not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  side text not null check (side in ('sun', 'moon')),
  joined_at timestamptz not null default now(),
  unique (match_id, side),
  unique (match_id, user_id)
);

create table public.turns (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_side text not null check (player_side in ('sun', 'moon')),
  turn_number integer not null,
  actions jsonb not null,
  resulting_state jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, turn_number, player_side)
);

insert into public.users (id, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'Legacy Sun'),
  ('10000000-0000-4000-8000-000000000002', 'Legacy Moon');
insert into public.matches (id, mode, map_id, current_player, turn_number, state, created_by) values
  ('1a000000-0000-4000-8000-000000000001', 'online', 'meadow-line', 'moon', 2, '{"turnNumber": 2}', '10000000-0000-4000-8000-000000000001');
insert into public.match_players (match_id, user_id, side) values
  ('1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'sun'),
  ('1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'moon');
insert into public.turns (match_id, player_side, turn_number, actions, resulting_state) values
  ('1a000000-0000-4000-8000-000000000001', 'sun', 1, '[{"type": "end_turn"}]', '{"turnNumber": 2}');
