-- One:2:Us backend upgrade
-- Safe migration for an already existing project.

create extension if not exists pgcrypto;

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(sender_id, receiver_id),
  check (sender_id <> receiver_id)
);

alter table public.events add column if not exists latitude double precision;
alter table public.events add column if not exists longitude double precision;
alter table public.events add column if not exists image_url text;

create table if not exists public.live_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m integer,
  visibility text not null default 'matches' check (visibility in ('matches','friends')),
  precise boolean not null default false,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.likes enable row level security;
alter table public.live_locations enable row level security;

-- Recreate policies idempotently.
drop policy if exists "users read likes involving them" on public.likes;
create policy "users read likes involving them" on public.likes for select to authenticated using (auth.uid() in (sender_id,receiver_id));
drop policy if exists "users insert own likes" on public.likes;
create policy "users insert own likes" on public.likes for insert to authenticated with check (auth.uid()=sender_id);

drop policy if exists "participants read matches" on public.matches;
create policy "participants read matches" on public.matches for select to authenticated using (auth.uid() in (user_a,user_b));
drop policy if exists "participants read messages" on public.messages;
create policy "participants read messages" on public.messages for select to authenticated using (exists (select 1 from public.matches m where m.id=match_id and m.status='active' and auth.uid() in (m.user_a,m.user_b)));
drop policy if exists "participants send messages" on public.messages;
create policy "participants send messages" on public.messages for insert to authenticated with check (auth.uid()=sender_id and exists (select 1 from public.matches m where m.id=match_id and m.status='active' and auth.uid() in (m.user_a,m.user_b)));

drop policy if exists "users manage own live location" on public.live_locations;
create policy "users manage own live location" on public.live_locations for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "matched users can read live locations" on public.live_locations;
create policy "matched users can read live locations" on public.live_locations for select to authenticated using (
  expires_at > now() and exists (
    select 1 from public.matches m
    where m.status='active'
      and ((m.user_a=auth.uid() and m.user_b=live_locations.user_id) or (m.user_b=auth.uid() and m.user_a=live_locations.user_id))
  )
);

-- One paid like, automatic reciprocal match.
create or replace function public.send_like(target_user uuid)
returns table(matched boolean, match_id uuid, credits_left integer)
language plpgsql security definer set search_path=public as $$
declare
  me uuid := auth.uid();
  my_credits integer;
  reciprocal boolean;
  a uuid;
  b uuid;
  mid uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if target_user is null or target_user=me then raise exception 'Invalid target'; end if;
  if not exists(select 1 from profiles where id=target_user) then raise exception 'Profile not found'; end if;

  if exists(select 1 from likes where sender_id=me and receiver_id=target_user) then
    select credits into my_credits from profiles where id=me;
  else
    select credits into my_credits from profiles where id=me for update;
    if coalesce(my_credits,0) < 1 then raise exception 'Not enough credits'; end if;
    update profiles set credits=credits-1, updated_at=now() where id=me;
    insert into likes(sender_id,receiver_id) values(me,target_user);
    insert into credit_transactions(user_id,amount,reason) values(me,-1,'like');
    my_credits := my_credits - 1;
  end if;

  select exists(select 1 from likes where sender_id=target_user and receiver_id=me) into reciprocal;
  if reciprocal then
    a := least(me,target_user); b := greatest(me,target_user);
    insert into matches(user_a,user_b,status) values(a,b,'active')
    on conflict(user_a,user_b) do update set status='active'
    returning id into mid;
    return query select true, mid, my_credits;
  end if;
  return query select false, null::uuid, my_credits;
end; $$;
grant execute on function public.send_like(uuid) to authenticated;

-- Realtime for persistent chat and matches.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null; end $$;

-- Ensure Stripe credit transactions are idempotent.
do $$ begin
  alter table public.credit_transactions add constraint credit_transactions_stripe_session_unique unique (stripe_checkout_session_id);
exception when duplicate_object then null; end $$;
