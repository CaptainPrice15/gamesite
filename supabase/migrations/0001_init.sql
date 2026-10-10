-- ============================================================================
-- Arcade — 0001_init.sql
-- Schema, RLS, RPCs and realtime authorization (plan.md §6)
--
-- Roles used:
--   anon / authenticated : browser clients (anonymous sign-in → authenticated)
--   service_role         : only Vercel /api/* functions (service key, bypasses RLS)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 2 and 20),
  elo           integer not null default 1200 check (elo between 0 and 4000),
  is_anonymous  boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Clients may only ever change their display name — never elo.
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.profiles to authenticated;
grant insert on public.profiles to authenticated;

-- Auto-create a profile on first sign-in (anonymous or otherwise).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, is_anonymous)
  values (
    new.id,
    'Player' || substr(md5(new.id::text), 1, 4),
    coalesce(new.is_anonymous, false)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Set/refresh the display name from the client (validated).
create or replace function public.ensure_profile(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_display_name is not null then
    if p_display_name !~ '^[A-Za-z0-9 _-]{2,20}$' then
      raise exception 'invalid display name';
    end if;
    insert into public.profiles (user_id, display_name, is_anonymous)
    values (v_uid, p_display_name, coalesce((auth.jwt()->>'is_anonymous')::boolean, false))
    on conflict (user_id) do update set display_name = excluded.display_name;
  end if;

  select * into v_row from public.profiles where user_id = v_uid;
  if not found then
    insert into public.profiles (user_id, display_name, is_anonymous)
    values (v_uid, 'Player' || substr(md5(v_uid::text), 1, 4), true)
    on conflict (user_id) do nothing;
    select * into v_row from public.profiles where user_id = v_uid;
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.ensure_profile(text) to authenticated;

-- ---------------------------------------------------------------------------
-- scores  (clients can read, only /api/submitScore inserts)
-- ---------------------------------------------------------------------------
create table if not exists public.scores (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  game_id      text not null,
  score        bigint not null check (score >= 0),
  duration_ms  integer not null check (duration_ms > 0),
  created_at   timestamptz not null default now()
);

create index if not exists scores_game_score_idx
  on public.scores (game_id, score desc, created_at);
create index if not exists scores_user_game_idx
  on public.scores (user_id, game_id, score desc);

alter table public.scores enable row level security;

drop policy if exists "scores are readable" on public.scores;
create policy "scores are readable"
  on public.scores for select to authenticated
  using (true);
-- no INSERT / UPDATE / UPDATE policy → clients can never write scores

revoke insert, update, delete on public.scores from anon, authenticated;

-- ---------------------------------------------------------------------------
-- match_queue  (own-row insert/delete/select; matching happens inside enqueue)
-- ---------------------------------------------------------------------------
create table if not exists public.match_queue (
  user_id    uuid not null references auth.users (id) on delete cascade,
  game_id    text not null,
  elo        integer not null default 1200,
  mode       text not null default 'ranked'
             check (mode in ('ranked', 'casual')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz
);

create index if not exists match_queue_lookup_idx
  on public.match_queue (game_id, mode, joined_at)
  where left_at is null;
create index if not exists match_queue_user_idx
  on public.match_queue (user_id, joined_at desc);

alter table public.match_queue enable row level security;

drop policy if exists "queue: read own" on public.match_queue;
create policy "queue: read own"
  on public.match_queue for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "queue: insert own" on public.match_queue;
create policy "queue: insert own"
  on public.match_queue for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "queue: delete own" on public.match_queue;
create policy "queue: delete own"
  on public.match_queue for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id             uuid primary key default gen_random_uuid(),
  room_code      text not null unique,
  game_id        text not null,
  mode           text not null default 'ranked'
                 check (mode in ('ranked', 'casual', 'friend')),
  p1             uuid not null references auth.users (id) on delete cascade,
  p2             uuid references auth.users (id) on delete cascade,
  status         text not null default 'active'
                 check (status in ('pending', 'active', 'finished', 'void')),
  result         jsonb,
  p1_elo_before  integer,
  p1_elo_after   integer,
  p2_elo_before  integer,
  p2_elo_after   integer,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists matches_p2_idx on public.matches (p2, created_at desc);
create index if not exists matches_p1_idx on public.matches (p1, created_at desc);

alter table public.matches enable row level security;

drop policy if exists "matches: members read" on public.matches;
create policy "matches: members read"
  on public.matches for select to authenticated
  using (p1 = auth.uid() or p2 = auth.uid());

-- inserts / updates only ever happen through security-definer RPCs

-- ---------------------------------------------------------------------------
-- match_reports — consensus reports for /api/reportMatch (service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.match_reports (
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  winner     uuid,
  score      integer not null default 0 check (score >= 0),
  is_void    boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists match_reports_match_idx on public.match_reports (match_id, created_at);

alter table public.match_reports enable row level security;

-- RLS enabled with no policies: clients can never read or write reports;
-- only /api/reportMatch touches this table through the service-role key.

-- ---------------------------------------------------------------------------
-- ttt_games  (server-authoritative tic-tac-toe)
-- ---------------------------------------------------------------------------
create table if not exists public.ttt_games (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid references public.matches (id) on delete cascade,
  room_code  text not null unique,
  p1         uuid not null references auth.users (id) on delete cascade,
  p2         uuid references auth.users (id) on delete cascade,
  board      integer[] not null default array[0,0,0,0,0,0,0,0,0],
  turn       uuid,
  status     text not null default 'waiting'
             check (status in ('waiting', 'active', 'finished')),
  winner     uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ttt_games_match_idx on public.ttt_games (match_id);

alter table public.ttt_games enable row level security;

drop policy if exists "ttt: members read" on public.ttt_games;
create policy "ttt: members read"
  on public.ttt_games for select to authenticated
  using (p1 = auth.uid() or p2 = auth.uid());

-- ---------------------------------------------------------------------------
-- room codes — Crockford base32 minus I L O U 0 1  (30^6 ≈ 729M combos)
-- ---------------------------------------------------------------------------
create or replace function public.gen_room_code()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text := '';
begin
  for i in 1..6 loop
    v_code := v_code || substr(
      v_alphabet,
      1 + floor(random() * length(v_alphabet))::int,
      1
    );
  end loop;
  return v_code;
end;
$$;

create or replace function public.unique_room_code()
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  loop
    v_code := public.gen_room_code();
    exit when not exists (select 1 from public.matches where room_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- matchmaking: enqueue / dequeue
-- ---------------------------------------------------------------------------
create or replace function public.enqueue(p_game_id text, p_mode text default 'ranked')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_elo       integer;
  v_opponent  record;
  v_match_id  uuid;
  v_code      text;
  v_is_p1     boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_game_id is null or p_game_id !~ '^[a-z0-9_-]{1,24}$' then
    raise exception 'invalid game id';
  end if;
  if p_mode is null or p_mode not in ('ranked', 'casual') then
    raise exception 'invalid mode';
  end if;

  -- profiles are created by trigger; fall back to default elo
  select coalesce(elo, 1200) into v_elo from public.profiles where user_id = v_uid;
  if v_elo is null then
    v_elo := 1200;
  end if;

  -- dodge cooldown: repeatedly entering and abandoning the queue
  if (
    select count(*) from public.match_queue
    where user_id = v_uid
      and left_at is not null
      and left_at > now() - interval '10 minutes'
  ) >= 3 then
    return jsonb_build_object('matched', false, 'cooldown_sec', 60);
  end if;

  -- prune my active row, my stale history, and globally stale queue entries
  delete from public.match_queue
    where user_id = v_uid and left_at is null;
  delete from public.match_queue
    where left_at is not null and left_at < now() - interval '10 minutes';
  delete from public.match_queue
    where left_at is null and joined_at < now() - interval '120 seconds';

  -- best opponent inside an expanding elo window (race-free with SKIP LOCKED)
  select q.user_id, q.elo into v_opponent
  from public.match_queue q
  where q.game_id = p_game_id
    and q.mode = p_mode
    and q.left_at is null
    and q.user_id <> v_uid
    and abs(q.elo - v_elo) <= least(
      300,
      50 + floor(extract(epoch from (now() - q.joined_at))) * 5
    )
  order by abs(q.elo - v_elo), q.joined_at
  for update of q skip locked
  limit 1;

  if v_opponent.user_id is null then
    insert into public.match_queue (user_id, game_id, elo, mode)
    values (v_uid, p_game_id, v_elo, p_mode);
    return jsonb_build_object('matched', false);
  end if;

  -- pop the opponent and create the match
  delete from public.match_queue where user_id = v_opponent.user_id and game_id = p_game_id;

  v_code := public.unique_room_code();
  v_is_p1 := random() < 0.5;

  insert into public.matches (room_code, game_id, mode, p1, p2, status, p1_elo_before, p2_elo_before)
  values (
    v_code,
    p_game_id,
    p_mode,
    case when v_is_p1 then v_uid else v_opponent.user_id end,
    case when v_is_p1 then v_opponent.user_id else v_uid end,
    'active',
    case when v_is_p1 then v_elo else v_opponent.elo end,
    case when v_is_p1 then v_opponent.elo else v_elo end
  )
  returning id into v_match_id;

  -- best-effort push to whoever is already waiting (client also polls)
  begin
    perform realtime.send(
      jsonb_build_object(
        'game_id', p_game_id,
        'match_id', v_match_id,
        'room_code', v_code
      ),
      'matched',
      'user:' || v_opponent.user_id::text,
      true
    );
  exception when others then null;
  end;

  return jsonb_build_object(
    'matched', true,
    'match_id', v_match_id,
    'room_code', v_code,
    'opponent', v_opponent.user_id
  );
end;
$$;

grant execute on function public.enqueue(text, text) to authenticated;

create or replace function public.dequeue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  update public.match_queue
    set left_at = now()
    where user_id = v_uid and left_at is null;
end;
$$;

grant execute on function public.dequeue() to authenticated;

-- ---------------------------------------------------------------------------
-- rooms (online vs friend): create_room / join_room
-- ---------------------------------------------------------------------------
create or replace function public.create_room(p_game_id text, p_mode text default 'friend')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_elo  integer;
  v_code text;
  v_id   uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_game_id is null or p_game_id !~ '^[a-z0-9_-]{1,24}$' then
    raise exception 'invalid game id';
  end if;
  if p_mode not in ('friend', 'casual') then p_mode := 'friend'; end if;

  select coalesce(elo, 1200) into v_elo from public.profiles where user_id = v_uid;
  if v_elo is null then v_elo := 1200; end if;

  v_code := public.unique_room_code();
  insert into public.matches (room_code, game_id, mode, p1, status, p1_elo_before)
  values (v_code, p_game_id, p_mode, v_uid, 'pending', v_elo)
  returning id into v_id;

  return jsonb_build_object('match_id', v_id, 'room_code', v_code, 'game_id', p_game_id);
end;
$$;

grant execute on function public.create_room(text, text) to authenticated;

create or replace function public.join_room(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_m    public.matches%rowtype;
  v_elo  integer;
  v_ttt  public.ttt_games%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_room_code is null or length(p_room_code) <> 6 then
    raise exception 'invalid room code';
  end if;

  select * into v_m from public.matches
    where room_code = upper(p_room_code)
    for update;

  if not found then raise exception 'room not found'; end if;
  if v_m.p1 = v_uid then
    return jsonb_build_object('match_id', v_m.id, 'room_code', v_m.room_code,
                              'game_id', v_m.game_id, 'already_joined', true);
  end if;
  if v_m.p2 is not null and v_m.p2 <> v_uid then
    raise exception 'room full';
  end if;

  select coalesce(elo, 1200) into v_elo from public.profiles where user_id = v_uid;
  if v_elo is null then v_elo := 1200; end if;

  update public.matches
    set p2 = v_uid,
        status = 'active',
        p2_elo_before = v_elo
    where id = v_m.id;

  -- unblock a waiting tic-tac-toe game attached to this room
  select * into v_ttt from public.ttt_games where match_id = v_m.id for update;
  if found then
    update public.ttt_games
      set p2 = v_uid, status = 'active', turn = p1, updated_at = now()
      where id = v_ttt.id;
  end if;

  return jsonb_build_object(
    'match_id', v_m.id,
    'room_code', v_m.room_code,
    'game_id', v_m.game_id,
    'opponent', v_m.p1,
    'started', true
  );
end;
$$;

grant execute on function public.join_room(text) to authenticated;

-- ---------------------------------------------------------------------------
-- tic-tac-toe: create game / make move (fully server-authoritative)
-- ---------------------------------------------------------------------------
create or replace function public.ttt_create(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_m    public.matches%rowtype;
  v_id   uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into v_m from public.matches where id = p_match_id for update;
  if not found then raise exception 'match not found'; end if;
  if v_uid not in (v_m.p1, v_m.p2) then raise exception 'not a member'; end if;
  if v_m.p2 is null then raise exception 'opponent has not joined'; end if;

  if exists (select 1 from public.ttt_games where match_id = v_m.id) then
    select id into v_id from public.ttt_games where match_id = v_m.id;
    return jsonb_build_object('game_id', v_id, 'room_code', v_m.room_code, 'p1', v_m.p1, 'p2', v_m.p2);
  end if;

  insert into public.ttt_games (match_id, room_code, p1, p2, status, turn)
  values (v_m.id, v_m.room_code, v_m.p1, v_m.p2, 'active', v_m.p1)
  returning id into v_id;

  return jsonb_build_object('game_id', v_id, 'room_code', v_m.room_code, 'p1', v_m.p1, 'p2', v_m.p2);
end;
$$;

grant execute on function public.ttt_create(uuid) to authenticated;

create or replace function public.ttt_move(p_game_id uuid, p_cell integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_g     public.ttt_games%rowtype;
  v_board integer[];
  v_mark  integer;
  v_lines integer[] := array[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]];
  v_ln    integer[];
  v_winner uuid := null;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_cell is null or p_cell < 0 or p_cell > 8 then raise exception 'bad cell'; end if;

  select * into v_g from public.ttt_games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if v_uid not in (v_g.p1, v_g.p2) then raise exception 'not a member'; end if;
  if v_g.status <> 'active' then raise exception 'game not active'; end if;
  if v_g.turn is distinct from v_uid then raise exception 'not your turn'; end if;

  v_board := v_g.board;
  if v_board[p_cell + 1] <> 0 then raise exception 'cell taken'; end if;

  v_mark := case when v_uid = v_g.p1 then 1 else 2 end;
  v_board[p_cell + 1] := v_mark;

  foreach v_ln in array v_lines loop
    if v_board[v_ln[1]] = v_mark
       and v_board[v_ln[2]] = v_mark
       and v_board[v_ln[3]] = v_mark then
      v_winner := v_uid;
      exit;
    end if;
  end loop;

  if v_winner is not null then
    v_g.status := 'finished';
    v_g.winner := v_winner;
    v_g.turn := null;
  elsif not (0 = any (v_board)) then
    v_g.status := 'finished';   -- draw (winner stays null)
    v_g.turn := null;
  else
    v_g.turn := case when v_uid = v_g.p1 then v_g.p2 else v_g.p1 end;
  end if;

  update public.ttt_games
    set board = v_board, turn = v_g.turn, status = v_g.status,
        winner = v_g.winner, updated_at = now()
    where id = v_g.id;

  return jsonb_build_object(
    'id', v_g.id,
    'board', to_jsonb(v_board),
    'turn', coalesce(v_g.turn::text, ''),
    'status', v_g.status,
    'winner', coalesce(v_g.winner::text, '')
  );
end;
$$;

grant execute on function public.ttt_move(uuid, integer) to authenticated;

-- broadcast every board change to subscribers of topic:{game_id}
create or replace function public.ttt_broadcast_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'topic:' || coalesce(new.id, old.id)::text,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    new,
    old
  );
  return null;
end;
$$;

drop trigger if exists ttt_broadcast_trigger on public.ttt_games;
create trigger ttt_broadcast_trigger
  after insert or update on public.ttt_games
  for each row execute function public.ttt_broadcast_changes();

-- ---------------------------------------------------------------------------
-- finish_match — ELO (K=32). REVOKEd from clients: only /api/reportMatch.
-- result jsonb: { "winner": "<uuid|null>", "p1_score": n, "p2_score": n, "void": bool }
-- ---------------------------------------------------------------------------
create or replace function public.finish_match(p_match_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m         public.matches%rowtype;
  v_winner    uuid;
  v_void      boolean := coalesce((p_result->>'void')::boolean, false);
  v_ra        integer;
  v_rb        integer;
  v_ea        numeric;
  v_sa        numeric;
  v_da        integer;
begin
  select * into v_m from public.matches where id = p_match_id for update;
  if not found then raise exception 'match not found'; end if;
  if v_m.status in ('finished', 'void') then
    return jsonb_build_object('status', v_m.status, 'already_final', true);
  end if;
  if v_m.p2 is null then raise exception 'no opponent'; end if;

  if v_void then
    update public.matches
      set status = 'void', result = p_result, finished_at = now()
      where id = v_m.id;
    return jsonb_build_object('status', 'void');
  end if;

  v_winner := nullif(p_result->>'winner', '')::uuid;
  if v_winner is not null and v_winner not in (v_m.p1, v_m.p2) then
    raise exception 'winner is not a player';
  end if;

  update public.matches
    set status = 'finished', result = p_result, finished_at = now()
    where id = v_m.id;

  if v_m.mode <> 'ranked' then
    return jsonb_build_object('status', 'finished', 'ranked', false);
  end if;

  v_ra := coalesce(v_m.p1_elo_before, 1200);
  v_rb := coalesce(v_m.p2_elo_before, 1200);
  v_ea := 1.0 / (1.0 + power(10::numeric, (v_rb - v_ra)::numeric / 400.0));
  v_sa := case when v_winner = v_m.p1 then 1.0
               when v_winner = v_m.p2 then 0.0
               else 0.5 end;
  v_da := round(32.0 * (v_sa - v_ea))::integer;

  update public.matches
    set p1_elo_after = v_ra + v_da,
        p2_elo_after = v_rb - v_da
    where id = v_m.id;

  update public.profiles set elo = greatest(0, least(4000, v_ra + v_da)) where user_id = v_m.p1;
  update public.profiles set elo = greatest(0, least(4000, v_rb - v_da)) where user_id = v_m.p2;

  return jsonb_build_object(
    'status', 'finished',
    'ranked', true,
    'p1_elo_after', v_ra + v_da,
    'p2_elo_after', v_rb - v_da
  );
end;
$$;

revoke execute on function public.finish_match(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_match(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- leaderboard(game_id, n)
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(p_game_id text, p_limit integer default 10)
returns table (
  rank         bigint,
  user_id      uuid,
  display_name text,
  score        bigint,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    row_number() over (order by b.score desc, b.created_at) as rank,
    b.user_id,
    b.display_name,
    b.score,
    b.created_at
  from (
    select distinct on (s.user_id)
      s.user_id, s.score, s.created_at, coalesce(p.display_name, 'Player') as display_name
    from public.scores s
    left join public.profiles p on p.user_id = s.user_id
    where s.game_id = p_game_id
    order by s.user_id, s.score desc, s.created_at
  ) b
  order by b.score desc, b.created_at
  limit least(coalesce(p_limit, 10), 100);
$$;

grant execute on function public.leaderboard(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- realtime authorization (private channels) — plan §6 "Realtime authorization"
-- ---------------------------------------------------------------------------
drop policy if exists "room members receive" on realtime.messages;
create policy "room members receive"
  on realtime.messages for select to authenticated
  using (
    extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.matches m
      where (m.p1 = auth.uid() or m.p2 = auth.uid())
        and (select realtime.topic()) = 'room:' || m.room_code
    )
  );

drop policy if exists "room members send" on realtime.messages;
create policy "room members send"
  on realtime.messages for insert to authenticated
  with check (
    extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.matches m
      where (m.p1 = auth.uid() or m.p2 = auth.uid())
        and (select realtime.topic()) = 'room:' || m.room_code
    )
  );

drop policy if exists "ttt members receive" on realtime.messages;
create policy "ttt members receive"
  on realtime.messages for select to authenticated
  using (
    extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.ttt_games g
      where (g.p1 = auth.uid() or g.p2 = auth.uid())
        and (select realtime.topic()) = 'topic:' || g.id::text
    )
  );

drop policy if exists "ttt members send" on realtime.messages;
create policy "ttt members send"
  on realtime.messages for insert to authenticated
  with check (
    extension = 'broadcast'
    and exists (
      select 1 from public.ttt_games g
      where (g.p1 = auth.uid() or g.p2 = auth.uid())
        and (select realtime.topic()) = 'topic:' || g.id::text
    )
  );

drop policy if exists "own user topic receive" on realtime.messages;
create policy "own user topic receive"
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || auth.uid()::text
  );

drop policy if exists "global online presence" on realtime.messages;
create policy "global online presence"
  on realtime.messages for select to authenticated
  using (extension = 'presence' and (select realtime.topic()) = 'global:online');

drop policy if exists "global online presence send" on realtime.messages;
create policy "global online presence send"
  on realtime.messages for insert to authenticated
  with check (extension = 'presence' and (select realtime.topic()) = 'global:online');
