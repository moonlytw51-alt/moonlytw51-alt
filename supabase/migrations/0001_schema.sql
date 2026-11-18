-- Roles live in app_metadata (server-controlled) and a mirrored profiles column.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_id text not null unique check (player_id ~ '^[a-z0-9_]{3,24}$'),
  nickname text not null check (char_length(nickname) between 2 and 32),
  role text not null default 'member' check (role in ('member','deputy','leader','developer')),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  neurons integer not null check (neurons >= 0),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique(user_id, report_date)
);
create index if not exists daily_reports_date_idx on public.daily_reports(report_date);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id),
  author_name text not null check (char_length(author_name) between 2 and 32),
  author_role text not null check (author_role in ('deputy','leader','developer')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id),
  question text not null check (char_length(question) between 1 and 240),
  closes_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  unique(poll_id, label),
  unique(poll_id, id)
);
create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(poll_id, user_id),
  foreign key (poll_id, option_id) references public.poll_options(poll_id, id) on delete cascade
);

create or replace function public.current_clan_role()
returns text language sql stable security invoker set search_path = ''
as $$ select coalesce(auth.jwt()->'app_metadata'->>'role', 'member'); $$;

alter table public.profiles enable row level security;
alter table public.daily_reports enable row level security;
alter table public.posts enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

revoke all on public.profiles, public.daily_reports, public.posts, public.polls, public.poll_options, public.poll_votes from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;
grant select, insert on public.daily_reports to authenticated;
grant select on public.posts, public.polls, public.poll_options to anon, authenticated;
grant insert, update, delete on public.posts, public.polls, public.poll_options to authenticated;
grant select, insert, update on public.poll_votes to authenticated;

create policy "read own profile or staff" on public.profiles for select to authenticated
using (user_id = auth.uid() or (select public.current_clan_role()) in ('leader','deputy','developer'));
create policy "profile owner can edit nickname" on public.profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid() and role = (select public.current_clan_role()));

create policy "read own reports or staff" on public.daily_reports for select to authenticated
using (user_id = auth.uid() or (select public.current_clan_role()) in ('leader','deputy','developer'));
create policy "report own current day" on public.daily_reports for insert to authenticated
with check (user_id = auth.uid() and report_date = (timezone('Europe/Kyiv', now()))::date);

create policy "posts public read" on public.posts for select to anon, authenticated using (true);
create policy "staff create posts" on public.posts for insert to authenticated
with check ((select public.current_clan_role()) in ('leader','deputy','developer') and author_id = auth.uid());
create policy "staff update posts" on public.posts for update to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer'))
with check ((select public.current_clan_role()) in ('leader','deputy','developer'));
create policy "staff delete posts" on public.posts for delete to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer'));

create policy "polls public read" on public.polls for select to anon, authenticated using (true);
create policy "staff create polls" on public.polls for insert to authenticated
with check ((select public.current_clan_role()) in ('leader','deputy','developer') and author_id = auth.uid());
create policy "staff update polls" on public.polls for update to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer'))
with check ((select public.current_clan_role()) in ('leader','deputy','developer'));
create policy "staff delete polls" on public.polls for delete to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer'));

create policy "options public read" on public.poll_options for select to anon, authenticated using (true);
create policy "staff add options" on public.poll_options for insert to authenticated
with check ((select public.current_clan_role()) in ('leader','deputy','developer'));
create policy "staff delete options" on public.poll_options for delete to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer'));

create policy "own vote read" on public.poll_votes for select to authenticated
using (user_id = auth.uid() or (select public.current_clan_role()) in ('leader','deputy','developer'));
create policy "vote in open poll" on public.poll_votes for insert to authenticated
with check (user_id = auth.uid() and exists (
  select 1 from public.polls p join public.poll_options o on o.poll_id = p.id
  where p.id = poll_id and o.id = option_id and (p.closes_at is null or p.closes_at > now())
));
create policy "change own vote in open poll" on public.poll_votes for update to authenticated
using (user_id = auth.uid() and exists (select 1 from public.polls p where p.id = poll_id and (p.closes_at is null or p.closes_at > now())))
with check (user_id = auth.uid());

-- Safe public roster: no login IDs, report notes, or individual report rows leave this function.
create or replace function public.get_public_roster()
returns table(nickname text, role text, joined_on date, weekly_neurons bigint, monthly_neurons bigint, total_neurons bigint)
language sql stable security definer set search_path = ''
as $$
  select p.nickname, p.role, p.created_at::date,
    coalesce(sum(r.neurons) filter (where r.report_date >= date_trunc('week', timezone('Europe/Kyiv', now())::date)::date), 0)::bigint,
    coalesce(sum(r.neurons) filter (where r.report_date >= date_trunc('month', timezone('Europe/Kyiv', now())::date)::date), 0)::bigint,
    coalesce(sum(r.neurons), 0)::bigint
  from public.profiles p left join public.daily_reports r on r.user_id = p.user_id
  group by p.user_id order by total_neurons desc, p.nickname asc;
$$;
revoke all on function public.get_public_roster() from public;
grant execute on function public.get_public_roster() to anon, authenticated;

-- Public vote totals are aggregated without exposing voter identities.
create or replace function public.get_public_polls()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'question', p.question, 'closes_at', p.closes_at, 'created_at', p.created_at,
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'votes',
      (select count(*) from public.poll_votes v where v.option_id = o.id)) order by o.label)
      from public.poll_options o where o.poll_id = p.id), '[]'::jsonb)
  ) order by p.created_at desc), '[]'::jsonb)
  from public.polls p;
$$;
revoke all on function public.get_public_polls() from public;
grant execute on function public.get_public_polls() to anon, authenticated;
