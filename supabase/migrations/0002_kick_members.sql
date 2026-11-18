-- Soft-exclude members while preserving their reports and authored posts.
alter table public.profiles add column if not exists kicked_at timestamptz;
alter table public.profiles add column if not exists kicked_by uuid references auth.users(id) on delete set null;

-- Edge Functions use the server-only service_role key for account management.
grant select, insert, update, delete on table public.profiles to service_role;

create or replace function public.is_active_clan_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.kicked_at is null
  );
$$;
revoke all on function public.is_active_clan_member() from public;
grant execute on function public.is_active_clan_member() to authenticated, service_role;

-- Excluded accounts disappear from the public roster and its aggregate ratings.
create or replace function public.get_public_roster()
returns table(nickname text, role text, joined_on date, weekly_neurons bigint, monthly_neurons bigint, total_neurons bigint)
language sql stable security definer set search_path = ''
as $$
  select p.nickname, p.role, p.created_at::date as joined_on,
    coalesce(sum(r.neurons) filter (where r.report_date >= date_trunc('week', timezone('Europe/Kyiv', now())::date)::date), 0)::bigint as weekly_neurons,
    coalesce(sum(r.neurons) filter (where r.report_date >= date_trunc('month', timezone('Europe/Kyiv', now())::date)::date), 0)::bigint as monthly_neurons,
    coalesce(sum(r.neurons), 0)::bigint as total_neurons
  from public.profiles p
  left join public.daily_reports r on r.user_id = p.user_id
  where p.kicked_at is null
  group by p.user_id
  order by coalesce(sum(r.neurons), 0)::bigint desc, p.nickname asc;
$$;
revoke all on function public.get_public_roster() from public;
grant execute on function public.get_public_roster() to anon, authenticated;

-- Existing access tokens stop working for write actions as soon as kicked_at is set.
drop policy if exists "profile owner can edit nickname" on public.profiles;
create policy "profile owner can edit nickname" on public.profiles for update to authenticated
using (user_id = auth.uid() and (select public.is_active_clan_member()))
with check (user_id = auth.uid() and role = (select public.current_clan_role()) and (select public.is_active_clan_member()));

drop policy if exists "report own current day" on public.daily_reports;
create policy "report own current day" on public.daily_reports for insert to authenticated
with check (user_id = auth.uid()
  and report_date = (timezone('Europe/Kyiv', now()))::date
  and (select public.is_active_clan_member()));

drop policy if exists "staff create posts" on public.posts;
create policy "staff create posts" on public.posts for insert to authenticated
with check ((select public.current_clan_role()) in ('leader','deputy','developer')
  and author_id = auth.uid() and (select public.is_active_clan_member()));
drop policy if exists "staff update posts" on public.posts;
create policy "staff update posts" on public.posts for update to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer') and (select public.is_active_clan_member()))
with check ((select public.current_clan_role()) in ('leader','deputy','developer') and (select public.is_active_clan_member()));
drop policy if exists "staff delete posts" on public.posts;
create policy "staff delete posts" on public.posts for delete to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer') and (select public.is_active_clan_member()));

drop policy if exists "staff create polls" on public.polls;
create policy "staff create polls" on public.polls for insert to authenticated
with check ((select public.current_clan_role()) in ('leader','deputy','developer')
  and author_id = auth.uid() and (select public.is_active_clan_member()));
drop policy if exists "staff update polls" on public.polls;
create policy "staff update polls" on public.polls for update to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer') and (select public.is_active_clan_member()))
with check ((select public.current_clan_role()) in ('leader','deputy','developer') and (select public.is_active_clan_member()));
drop policy if exists "staff delete polls" on public.polls;
create policy "staff delete polls" on public.polls for delete to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer') and (select public.is_active_clan_member()));

drop policy if exists "staff add options" on public.poll_options;
create policy "staff add options" on public.poll_options for insert to authenticated
with check ((select public.current_clan_role()) in ('leader','deputy','developer')
  and (select public.is_active_clan_member()));
drop policy if exists "staff delete options" on public.poll_options;
create policy "staff delete options" on public.poll_options for delete to authenticated
using ((select public.current_clan_role()) in ('leader','deputy','developer')
  and (select public.is_active_clan_member()));

drop policy if exists "vote in open poll" on public.poll_votes;
create policy "vote in open poll" on public.poll_votes for insert to authenticated
with check (user_id = auth.uid() and (select public.is_active_clan_member()) and exists (
  select 1 from public.polls p join public.poll_options o on o.poll_id = p.id
  where p.id = poll_id and o.id = option_id and (p.closes_at is null or p.closes_at > now())
));
drop policy if exists "change own vote in open poll" on public.poll_votes;
create policy "change own vote in open poll" on public.poll_votes for update to authenticated
using (user_id = auth.uid() and (select public.is_active_clan_member()) and exists (
  select 1 from public.polls p where p.id = poll_id and (p.closes_at is null or p.closes_at > now())
))
with check (user_id = auth.uid() and (select public.is_active_clan_member()));
