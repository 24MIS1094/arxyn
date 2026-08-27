create type public.audio_source_type as enum ('youtube', 'youtube_music', 'amazon_music', 'device_file', 'arxyn_library', 'future_service');

create table public.connected_services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider public.audio_source_type not null,
  provider_user_id text,
  access_token_reference text,
  refresh_token_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.audio_library (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  media_id text not null,
  source_type public.audio_source_type not null default 'arxyn_library',
  title text not null,
  artist text,
  artwork_url text,
  duration_ms bigint,
  storage_path text,
  created_at timestamptz not null default now(),
  unique (owner_id, media_id)
);

create table public.room_media (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  media_id text not null,
  source_type public.audio_source_type not null,
  title text not null,
  artist text,
  artwork_url text,
  duration_ms bigint,
  owner_id uuid not null references public.profiles(id),
  storage_path text,
  retention_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, media_id)
);

alter table public.connected_services enable row level security;
alter table public.audio_library enable row level security;
alter table public.room_media enable row level security;

create policy "users manage their connected services" on public.connected_services for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owners manage their audio library" on public.audio_library for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "room members read shared media" on public.room_media for select to authenticated using (public.is_room_member(room_id));
create policy "room members add authorized media" on public.room_media for insert to authenticated with check (public.is_room_member(room_id) and owner_id = auth.uid());
create policy "media owners or managers remove shared media" on public.room_media for delete to authenticated using (owner_id = auth.uid() or public.is_room_manager(room_id));

alter table public.queue_items add column if not exists source_type public.audio_source_type not null default 'arxyn_library';
alter table public.queue_items add column if not exists duration_ms bigint;
alter table public.queue_items add column if not exists status text not null default 'queued';
alter table public.queue_items add column if not exists added_at timestamptz not null default now();
create index room_media_room_created_idx on public.room_media(room_id, created_at);
create index connected_services_user_provider_idx on public.connected_services(user_id, provider);
