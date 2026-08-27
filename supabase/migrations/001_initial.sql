create extension if not exists pgcrypto;

create type public.room_privacy as enum ('public', 'private', 'invite_only');
create type public.join_policy as enum ('code', 'approval');
create type public.room_role as enum ('owner', 'moderator', 'controller', 'member', 'guest');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'played', 'removed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  image_url text,
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  capacity integer not null check (capacity between 1 and 10000),
  privacy public.room_privacy not null default 'public',
  join_policy public.join_policy not null default 'code',
  password_hash text,
  music_control text not null default 'host_only' check (music_control in ('host_only', 'request_approval', 'shared')),
  song_requests_enabled boolean not null default true,
  voting_enabled boolean not null default true,
  chat_enabled boolean not null default true,
  guest_joining_enabled boolean not null default true,
  auto_lock_when_full boolean not null default false,
  expires_at timestamptz,
  locked_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  guest_name text,
  role public.room_role not null default 'member',
  approved_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id),
  check (user_id is not null or guest_name is not null)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  platform text not null,
  device_sync_offset_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.room_devices (
  room_id uuid not null references public.rooms(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  connection_state text not null default 'connecting',
  last_seen timestamptz,
  measured_latency_ms integer,
  measured_jitter_ms integer,
  playback_drift_ms integer,
  buffer_health numeric,
  joined_at timestamptz not null default now(),
  primary key (room_id, device_id)
);

create table public.room_permissions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  can_control boolean not null default false,
  can_moderate boolean not null default false,
  granted_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.playback_state (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  media_id text,
  title text,
  artist text,
  artwork_url text,
  is_playing boolean not null default false,
  position_ms bigint not null default 0,
  server_timestamp timestamptz not null default now(),
  playback_rate numeric not null default 1 check (playback_rate > 0 and playback_rate <= 2),
  sequence_number bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table public.queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  media_id text not null,
  title text not null,
  artist text,
  artwork_url text,
  requested_by uuid references public.profiles(id),
  position integer not null,
  created_at timestamptz not null default now()
);

create table public.song_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  media_id text not null,
  title text not null,
  artist text,
  artwork_url text,
  requested_by uuid references public.profiles(id),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.song_votes (
  request_id uuid not null references public.song_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  reply_to uuid references public.room_messages(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.room_reactions (
  message_id uuid not null references public.room_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('heart', 'fire', 'party', 'clap', 'love', 'hundred')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction)
);

create table public.room_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.room_analytics (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  peak_connected integer not null default 0,
  total_participants integer not null default 0,
  session_duration_seconds integer not null default 0,
  songs_played integer not null default 0,
  requests_count integer not null default 0,
  votes_count integer not null default 0,
  reconnection_events integer not null default 0,
  average_latency_ms numeric,
  synchronization_health text,
  updated_at timestamptz not null default now()
);

create index rooms_owner_idx on public.rooms(owner_id);
create index room_members_user_idx on public.room_members(user_id);
create index room_devices_seen_idx on public.room_devices(room_id, last_seen);
create index queue_items_room_position_idx on public.queue_items(room_id, position);
create index requests_room_status_idx on public.song_requests(room_id, status, created_at);
create index messages_room_created_idx on public.room_messages(room_id, created_at);
create index events_room_created_idx on public.room_events(room_id, created_at);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.devices enable row level security;
alter table public.room_devices enable row level security;
alter table public.room_permissions enable row level security;
alter table public.playback_state enable row level security;
alter table public.queue_items enable row level security;
alter table public.song_requests enable row level security;
alter table public.song_votes enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_reactions enable row level security;
alter table public.room_events enable row level security;
alter table public.room_analytics enable row level security;

create or replace function public.is_room_member(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = target_room and user_id = auth.uid() and left_at is null);
$$;

create or replace function public.is_room_manager(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = target_room and user_id = auth.uid() and role in ('owner', 'moderator'));
$$;

create policy "profiles are visible to signed in users" on public.profiles for select to authenticated using (true);
create policy "users update their profile" on public.profiles for update to authenticated using (id = auth.uid());
create policy "rooms visible to members or public" on public.rooms for select to authenticated using (privacy = 'public' or owner_id = auth.uid() or public.is_room_member(id));
create policy "users create rooms" on public.rooms for insert to authenticated with check (owner_id = auth.uid());
create policy "owners update rooms" on public.rooms for update to authenticated using (owner_id = auth.uid());
create policy "members see membership" on public.room_members for select to authenticated using (user_id = auth.uid() or public.is_room_member(room_id));
create policy "users join rooms" on public.room_members for insert to authenticated with check (user_id = auth.uid());
create policy "members leave rooms" on public.room_members for update to authenticated using (user_id = auth.uid() or public.is_room_manager(room_id));
create policy "members see playback" on public.playback_state for select to authenticated using (public.is_room_member(room_id));
create policy "managers control playback" on public.playback_state for all to authenticated using (public.is_room_manager(room_id));
create policy "members see queue" on public.queue_items for select to authenticated using (public.is_room_member(room_id));
create policy "managers edit queue" on public.queue_items for all to authenticated using (public.is_room_manager(room_id));
create policy "members create requests" on public.song_requests for insert to authenticated with check (public.is_room_member(room_id) and requested_by = auth.uid());
create policy "members see requests" on public.song_requests for select to authenticated using (public.is_room_member(room_id));
create policy "managers update requests" on public.song_requests for update to authenticated using (public.is_room_manager(room_id));
create policy "members vote once" on public.song_votes for insert to authenticated with check (user_id = auth.uid() and public.is_room_member((select room_id from public.song_requests where id = request_id)));
create policy "members see votes" on public.song_votes for select to authenticated using (public.is_room_member((select room_id from public.song_requests where id = request_id)));
create policy "members read chat" on public.room_messages for select to authenticated using (public.is_room_member(room_id));
create policy "members send chat" on public.room_messages for insert to authenticated with check (public.is_room_member(room_id) and user_id = auth.uid());
create policy "authors or moderators delete chat" on public.room_messages for update to authenticated using (user_id = auth.uid() or public.is_room_manager(room_id));
create policy "members read analytics" on public.room_analytics for select to authenticated using (exists (select 1 from public.rooms where id = room_id and owner_id = auth.uid()));
