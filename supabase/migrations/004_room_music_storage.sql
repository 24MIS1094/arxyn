create extension if not exists pgcrypto;

create table if not exists public.room_audio_files (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  title text not null,
  artist text,
  file_name text not null,
  storage_path text not null,
  file_url text,
  size_bytes bigint not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_playback_session (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  current_track_id uuid,
  media_id text,
  title text,
  artist text,
  artwork_url text,
  is_playing boolean not null default false,
  position_ms bigint not null default 0,
  started_at timestamptz,
  server_timestamp timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_audio_files_room_idx on public.room_audio_files(room_id, created_at);
create index if not exists room_playback_session_updated_idx on public.room_playback_session(room_id, updated_at);

alter table public.room_audio_files enable row level security;
alter table public.room_playback_session enable row level security;

create policy "members can read room audio metadata" on public.room_audio_files
for select to authenticated
using (
  exists (
    select 1 from public.room_members rm
    where rm.room_id = public.room_audio_files.room_id and rm.user_id = auth.uid()
  )
);

create policy "hosts can manage room audio metadata" on public.room_audio_files
for all to authenticated
using (
  exists (
    select 1 from public.rooms r
    where r.id = public.room_audio_files.room_id and r.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.rooms r
    where r.id = public.room_audio_files.room_id and r.owner_id = auth.uid()
  )
);

create policy "room members can read playback state" on public.room_playback_session
for select to authenticated
using (
  exists (
    select 1 from public.room_members rm
    where rm.room_id = public.room_playback_session.room_id and rm.user_id = auth.uid()
  )
);

create policy "room hosts can update playback state" on public.room_playback_session
for all to authenticated
using (
  exists (
    select 1 from public.rooms r
    where r.id = public.room_playback_session.room_id and r.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.rooms r
    where r.id = public.room_playback_session.room_id and r.owner_id = auth.uid()
  )
);

create or replace function public.ensure_room_audio_bucket()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into storage.buckets (id, name, public)
  values ('room-audio', 'room-audio', true)
  on conflict (id) do nothing;
end;
$$;

create or replace function public.set_room_playback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists room_playback_set_updated_at on public.room_playback_session;
create trigger room_playback_set_updated_at
before update on public.room_playback_session
for each row
execute function public.set_room_playback_updated_at();

create or replace function public.room_queue_item_position_guard()
returns trigger
language plpgsql
as $$
begin
  if new.position is null or new.position < 1 then
    new.position = 1;
  end if;
  return new;
end;
$$;

drop trigger if exists room_queue_items_position_guard on public.queue_items;
create trigger room_queue_items_position_guard
before insert or update on public.queue_items
for each row
execute function public.room_queue_item_position_guard();

create policy "allow room-audio bucket reads for members" on storage.objects
for select to authenticated
using (
  bucket_id = 'room-audio' and
  exists (
    select 1
    from public.room_members rm
    where rm.user_id = auth.uid()
      and rm.room_id::text = split_part(storage.objects.name, '/', 2)
  )
);
