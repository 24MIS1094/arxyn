create table if not exists public.queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  media_id text not null,
  title text not null,
  artist text,
  artwork_url text,
  position integer not null,
  requested_by uuid references public.profiles(id) on delete set null,
  source_type text not null default 'device_file',
  duration_ms bigint not null default 0,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create index if not exists queue_items_room_position_idx
  on public.queue_items(room_id, position);

create index if not exists queue_items_requested_by_idx
  on public.queue_items(requested_by);

alter table public.queue_items enable row level security;

drop policy if exists "managers edit queue" on public.queue_items;
drop policy if exists "members see queue" on public.queue_items;
drop policy if exists "hosts add songs to queue" on public.queue_items;
drop policy if exists "managers update queue" on public.queue_items;
drop policy if exists "managers delete queue" on public.queue_items;

create policy "members see queue"
on public.queue_items
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id = public.queue_items.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "hosts add songs to queue"
on public.queue_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.rooms r
    where r.id = public.queue_items.room_id
      and r.host_id = auth.uid()
  )
);

create policy "managers update queue"
on public.queue_items
for update
to authenticated
using (public.is_room_manager(public.queue_items.room_id))
with check (public.is_room_manager(public.queue_items.room_id));

create policy "managers delete queue"
on public.queue_items
for delete
to authenticated
using (public.is_room_manager(public.queue_items.room_id));