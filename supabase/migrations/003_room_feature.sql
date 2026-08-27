create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  capacity integer not null default 10 check (capacity between 1 and 10000),
  privacy text not null default 'private' check (privacy in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  locked_at timestamptz
);

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists rooms_owner_idx on public.rooms(owner_id);
create index if not exists rooms_code_idx on public.rooms(code);
create index if not exists room_members_room_idx on public.room_members(room_id);
create index if not exists room_members_user_idx on public.room_members(user_id);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rooms_set_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();

create or replace function public.add_room_owner_membership()
returns trigger
language plpgsql
as $$
begin
  insert into public.room_members (room_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (room_id, user_id) do nothing;
  return new;
end;
$$;

create trigger rooms_add_owner_membership
after insert on public.rooms
for each row
execute function public.add_room_owner_membership();

create policy "authenticated users can read visible rooms"
on public.rooms
for select to authenticated
using (
  privacy = 'public'
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.room_members rm
    where rm.room_id = public.rooms.id
      and rm.user_id = auth.uid()
  )
);

create policy "authenticated users can create rooms"
on public.rooms
for insert to authenticated
with check (owner_id = auth.uid());

create policy "room owners can update their rooms"
on public.rooms
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "room owners can delete their rooms"
on public.rooms
for delete to authenticated
using (owner_id = auth.uid());

create policy "members can view room membership"
on public.room_members
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.rooms r
    where r.id = public.room_members.room_id
      and (
        r.owner_id = auth.uid()
        or r.privacy = 'public'
      )
  )
);

create policy "authenticated users can join visible rooms"
on public.room_members
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.rooms r
    where r.id = public.room_members.room_id
      and (
        r.owner_id = auth.uid()
        or r.privacy = 'public'
        or exists (
          select 1
          from public.room_members rm
          where rm.room_id = r.id and rm.user_id = auth.uid()
        )
      )
  )
);

create policy "room owners can remove members"
on public.room_members
for delete to authenticated
using (
  exists (
    select 1
    from public.rooms r
    where r.id = public.room_members.room_id
      and r.owner_id = auth.uid()
  )
);
