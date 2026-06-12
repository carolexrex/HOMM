create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  is_guest boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  device_fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('hotseat', 'online')),
  map_id text not null,
  invite_code text unique,
  current_player text not null check (current_player in ('sun', 'moon')),
  turn_number integer not null default 1,
  winner text check (winner in ('sun', 'moon')),
  state jsonb not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  side text not null check (side in ('sun', 'moon')),
  joined_at timestamptz not null default now(),
  unique (match_id, side),
  unique (match_id, user_id)
);

create table if not exists public.turns (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_side text not null check (player_side in ('sun', 'moon')),
  turn_number integer not null,
  actions jsonb not null,
  resulting_state jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, turn_number, player_side)
);

create table if not exists public.cosmetics (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  category text not null,
  title text not null,
  price_cents integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  supporter_pass_sku text references public.cosmetics(sku),
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cosmetic_id uuid not null references public.cosmetics(id) on delete cascade,
  provider text not null,
  provider_ref text not null,
  purchased_at timestamptz not null default now(),
  unique (provider, provider_ref)
);

create index if not exists matches_invite_code_idx on public.matches(invite_code);
create index if not exists matches_updated_at_idx on public.matches(updated_at desc);
create index if not exists match_players_user_idx on public.match_players(user_id, joined_at desc);
create index if not exists match_players_match_idx on public.match_players(match_id);
create index if not exists turns_match_turn_idx on public.turns(match_id, turn_number desc);
create index if not exists devices_user_idx on public.devices(user_id);
create index if not exists purchases_user_idx on public.purchases(user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists matches_touch_updated_at on public.matches;
create trigger matches_touch_updated_at
before update on public.matches
for each row
execute function public.touch_updated_at();

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
before update on public.users
for each row
execute function public.touch_updated_at();

alter table if exists public.users enable row level security;
alter table if exists public.matches enable row level security;
alter table if exists public.match_players enable row level security;
alter table if exists public.turns enable row level security;

drop policy if exists users_select_self on public.users;
create policy users_select_self
on public.users
for select
to authenticated
using (auth.uid() is not null and auth.uid() = id);

drop policy if exists users_insert_self on public.users;
create policy users_insert_self
on public.users
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = id);

drop policy if exists users_update_self on public.users;
create policy users_update_self
on public.users
for update
to authenticated
using (auth.uid() is not null and auth.uid() = id)
with check (auth.uid() is not null and auth.uid() = id);

drop policy if exists matches_select_participant on public.matches;
create policy matches_select_participant
on public.matches
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.match_players
    where match_players.match_id = matches.id
      and match_players.user_id = auth.uid()
  )
);

drop policy if exists matches_insert_creator on public.matches;
create policy matches_insert_creator
on public.matches
for insert
to authenticated
with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists match_players_select_own on public.match_players;
create policy match_players_select_own
on public.match_players
for select
to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists match_players_insert_self on public.match_players;
create policy match_players_insert_self
on public.match_players
for insert
to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists turns_select_participant on public.turns;
create policy turns_select_participant
on public.turns
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.match_players
    where match_players.match_id = turns.match_id
      and match_players.user_id = auth.uid()
  )
);

drop policy if exists turns_insert_participant on public.turns;
create policy turns_insert_participant
on public.turns
for insert
to authenticated
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.match_players
    where match_players.match_id = turns.match_id
      and match_players.user_id = auth.uid()
      and match_players.side = turns.player_side
  )
);

create or replace function public.create_online_match(
  p_created_by uuid,
  p_map_id text,
  p_invite_code text,
  p_current_player text,
  p_turn_number integer,
  p_winner text,
  p_state jsonb
)
returns table (
  id uuid,
  invite_code text,
  state jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  created record;
begin
  insert into public.matches (
    mode,
    map_id,
    invite_code,
    current_player,
    turn_number,
    winner,
    state,
    created_by
  )
  values (
    'online',
    p_map_id,
    p_invite_code,
    p_current_player,
    p_turn_number,
    p_winner,
    p_state,
    p_created_by
  )
  returning matches.id, matches.invite_code, matches.state
  into created;

  insert into public.match_players (
    match_id,
    user_id,
    side
  )
  values (
    created.id,
    p_created_by,
    'sun'
  );

  id := created.id;
  invite_code := created.invite_code;
  state := created.state;
  return next;
end;
$$;

create or replace function public.join_online_match(
  p_invite_code text,
  p_user_id uuid
)
returns table (
  id uuid,
  invite_code text,
  side text,
  state jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row record;
  existing_side text;
begin
  select matches.id, matches.invite_code, matches.state
  into match_row
  from public.matches
  where matches.invite_code = p_invite_code
  for update;

  if not found then
    raise exception 'Match not found.';
  end if;

  select match_players.side
  into existing_side
  from public.match_players
  where match_players.match_id = match_row.id
    and match_players.user_id = p_user_id;

  if found then
    id := match_row.id;
    invite_code := match_row.invite_code;
    side := existing_side;
    state := match_row.state;
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.match_players
    where match_players.match_id = match_row.id
      and match_players.side = 'moon'
  ) then
    raise exception 'Match is already full.';
  end if;

  insert into public.match_players (
    match_id,
    user_id,
    side
  )
  values (
    match_row.id,
    p_user_id,
    'moon'
  );

  id := match_row.id;
  invite_code := match_row.invite_code;
  side := 'moon';
  state := match_row.state;
  return next;
end;
$$;

revoke all on function public.create_online_match(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.create_online_match(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  jsonb
) to service_role;

revoke all on function public.join_online_match(
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.join_online_match(
  text,
  uuid
) to service_role;

create or replace function public.commit_match_turn(
  p_match_id uuid,
  p_player_side text,
  p_turn_number integer,
  p_actions jsonb,
  p_resulting_state jsonb,
  p_next_current_player text,
  p_next_turn_number integer,
  p_winner text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.turns (
    match_id,
    player_side,
    turn_number,
    actions,
    resulting_state
  )
  values (
    p_match_id,
    p_player_side,
    p_turn_number,
    p_actions,
    p_resulting_state
  );

  update public.matches
  set
    current_player = p_next_current_player,
    turn_number = p_next_turn_number,
    winner = p_winner,
    state = p_resulting_state
  where id = p_match_id
    and current_player = p_player_side
    and turn_number = p_turn_number
    and winner is null;

  if not found then
    raise exception 'Match changed before turn commit.';
  end if;
end;
$$;

revoke all on function public.commit_match_turn(
  uuid,
  text,
  integer,
  jsonb,
  jsonb,
  text,
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.commit_match_turn(
  uuid,
  text,
  integer,
  jsonb,
  jsonb,
  text,
  integer,
  text
) to service_role;
