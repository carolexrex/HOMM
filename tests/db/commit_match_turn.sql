-- SQL integration tests for public.commit_match_turn_v2 and the turns migration.
-- Each block raises on failure; run via tests/db/run.sh.

-- Fixtures: a fresh match on turn 1 with two seated players and one outsider.
insert into public.users (id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'Sun'),
  ('20000000-0000-4000-8000-000000000002', 'Moon'),
  ('20000000-0000-4000-8000-000000000003', 'Stranger');
insert into public.matches (id, mode, map_id, current_player, turn_number, state, created_by) values
  ('2a000000-0000-4000-8000-000000000001', 'online', 'meadow-line', 'sun', 1, '{"turnNumber": 1}', '20000000-0000-4000-8000-000000000001');
insert into public.match_players (match_id, user_id, side) values
  ('2a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'sun'),
  ('2a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'moon');

-- Shorthand used by every case below. p_winner null means a normal end_turn.
create function pg_temp.submit(
  p_user text,
  p_submission text,
  p_expected integer,
  p_actions jsonb default '[{"type": "end_turn"}]',
  p_winner text default null,
  p_match text default '2a000000-0000-4000-8000-000000000001'
) returns record
language plpgsql
as $$
declare
  result record;
  seat text := case p_user when 'sun' then 'sun' when 'moon' then 'moon' else 'sun' end;
  next_player text := case when p_winner is not null then seat when seat = 'sun' then 'moon' else 'sun' end;
  next_turn integer := case when p_winner is not null then p_expected else p_expected + 1 end;
begin
  select * into result
  from public.commit_match_turn_v2(
    p_match::uuid,
    case p_user
      when 'sun' then '20000000-0000-4000-8000-000000000001'
      when 'moon' then '20000000-0000-4000-8000-000000000002'
      else '20000000-0000-4000-8000-000000000003'
    end::uuid,
    p_submission::uuid,
    p_expected,
    p_actions,
    jsonb_build_object('turnNumber', next_turn, 'by', p_submission),
    next_player,
    next_turn,
    p_winner
  );
  return result;
end;
$$;

create function pg_temp.expect(label text, actual text, expected text) returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok - %', label;
end;
$$;

grant execute on all functions in schema pg_temp to service_role;
set role service_role;

do $$
declare
  r record;
  m public.matches%rowtype;
begin
  -- Normal commit advances exactly one turn.
  select * into r from pg_temp.submit('sun', 'a0000000-0000-4000-8000-000000000001', 1) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('first submission commits', r.outcome, 'committed');
  perform pg_temp.expect('commit returns next turn', r.match_turn_number::text, '2');

  -- Immediate retry of the same submission does not advance again.
  select * into r from pg_temp.submit('sun', 'a0000000-0000-4000-8000-000000000001', 1) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('retry is a duplicate', r.outcome, 'duplicate');
  select * into m from public.matches where id = '2a000000-0000-4000-8000-000000000001';
  perform pg_temp.expect('retry leaves turn at 2', m.turn_number::text, '2');

  -- Moon plays turn 2; control returns to sun on turn 3.
  select * into r from pg_temp.submit('moon', 'b0000000-0000-4000-8000-000000000001', 2) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('moon commits turn 2', r.outcome, 'committed');

  -- An old turn-one request with a fresh ID arrives on turn three.
  select * into r from pg_temp.submit('sun', 'c0000000-0000-4000-8000-000000000001', 1) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('turn-one request on turn three is stale', r.outcome, 'stale');
  select * into m from public.matches where id = '2a000000-0000-4000-8000-000000000001';
  perform pg_temp.expect('stale request changes nothing', m.turn_number::text || '/' || m.current_player, '3/sun');

  -- Lost response: retrying the turn-one submission now confirms it and returns current state.
  select * into r from pg_temp.submit('sun', 'a0000000-0000-4000-8000-000000000001', 1) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('late retry of accepted turn is a duplicate', r.outcome, 'duplicate');
  perform pg_temp.expect('late retry returns current turn, not the stored snapshot', r.match_turn_number::text || '/' || (r.match_state->>'turnNumber'), '3/3');

  -- Same ID, different content.
  select * into r from pg_temp.submit('sun', 'a0000000-0000-4000-8000-000000000001', 1, '[{"type": "recruit", "kind": "militia"}, {"type": "end_turn"}]') as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('reused ID with different actions conflicts', r.outcome, 'submission_conflict');
  select * into r from pg_temp.submit('sun', 'a0000000-0000-4000-8000-000000000001', 3) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('reused ID with different version conflicts', r.outcome, 'submission_conflict');
  select * into r from pg_temp.submit('moon', 'a0000000-0000-4000-8000-000000000001', 1) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('another player cannot replay a submission ID', r.outcome, 'submission_conflict');

  -- jsonb equality ignores key order, matching the Edge Function's normalized comparison.
  select * into r from pg_temp.submit('moon', 'b0000000-0000-4000-8000-000000000001', 2, '[{"type": "end_turn"}]'::jsonb) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('moon retry with identical content is a duplicate', r.outcome, 'duplicate');

  -- Access and turn order.
  select * into r from pg_temp.submit('stranger', 'd0000000-0000-4000-8000-000000000001', 3) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('outsider is forbidden', r.outcome, 'forbidden');
  perform pg_temp.expect('forbidden leaks no state', coalesce(r.match_state::text, 'null'), 'null');
  select * into r from pg_temp.submit('sun', 'd0000000-0000-4000-8000-000000000002', 3, p_match => '2a000000-0000-4000-8000-0000000000ff') as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('unknown match is not found', r.outcome, 'not_found');
  select * into r from pg_temp.submit('moon', 'd0000000-0000-4000-8000-000000000003', 3) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('moon cannot play sun''s turn', r.outcome, 'not_your_turn');

  -- A resulting state that skips turns is refused even from the service role.
  begin
    perform public.commit_match_turn_v2(
      '2a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000004', 3, '[{"type": "end_turn"}]', '{}', 'moon', 5, null);
    raise exception 'FAIL turn skipping was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok - resulting turn must follow the expected turn';
  end;

  -- Terminal win: committed without advancing the turn, then the match is closed.
  select * into r from pg_temp.submit('sun', 'e0000000-0000-4000-8000-000000000001', 3, '[{"type": "attack", "attackerId": "a", "targetId": "b"}]', 'sun') as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('terminal win commits', r.outcome || '/' || r.match_winner || '/' || r.match_turn_number, 'committed/sun/3');
  select * into r from pg_temp.submit('sun', 'e0000000-0000-4000-8000-000000000001', 3, '[{"type": "attack", "attackerId": "a", "targetId": "b"}]', 'sun') as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('terminal win retry is a duplicate', r.outcome, 'duplicate');
  select * into r from pg_temp.submit('moon', 'e0000000-0000-4000-8000-000000000002', 3) as (outcome text, match_turn_number integer, match_current_player text, match_winner text, match_state jsonb);
  perform pg_temp.expect('submissions after a win are refused', r.outcome, 'finished');

  perform pg_temp.expect(
    'exactly three turns were written',
    (select count(*) from public.turns where match_id = '2a000000-0000-4000-8000-000000000001')::text,
    '3'
  );
end;
$$;

reset role;

-- Migration: legacy rows survive with null submission IDs, and the new columns/index exist.
do $$
begin
  perform pg_temp.expect(
    'legacy turn row kept with null submission id',
    (select count(*) from public.turns where match_id = '1a000000-0000-4000-8000-000000000001' and submission_id is null)::text,
    '1'
  );
  perform pg_temp.expect(
    'partial unique index on (match_id, submission_id) exists',
    (select count(*) from pg_indexes where indexname = 'turns_match_submission_idx')::text,
    '1'
  );
end;
$$;

-- A legacy match continues under the new function.
set role service_role;
do $$
declare
  r record;
begin
  select * into r from public.commit_match_turn_v2(
    '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    'f0000000-0000-4000-8000-000000000001', 2, '[{"type": "end_turn"}]', '{"turnNumber": 3}', 'sun', 3, null);
  perform pg_temp.expect('legacy match accepts a versioned commit', r.outcome, 'committed');
end;
$$;
reset role;

-- Clients cannot call the commit functions or write turns directly.
set role authenticated;
do $$
begin
  begin
    perform public.commit_match_turn_v2(
      '2a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-000000000002', 3, '[]', '{}', 'moon', 4, null);
    raise exception 'FAIL authenticated could execute commit_match_turn_v2';
  exception when insufficient_privilege then
    raise notice 'ok - authenticated cannot execute commit_match_turn_v2';
  end;
  begin
    insert into public.turns (match_id, player_side, turn_number, actions, resulting_state)
    values ('2a000000-0000-4000-8000-000000000001', 'sun', 99, '[]', '{}');
    raise exception 'FAIL authenticated could insert turns';
  exception when insufficient_privilege then
    raise notice 'ok - authenticated cannot insert turns';
  end;
end;
$$;
reset role;
