create or replace function public.join_room(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.rooms
    where id = p_room_id
  ) then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (p_room_id, auth.uid(), 'member')
  on conflict (room_id, user_id) do nothing;

  return true;
end;
$$;

revoke all on function public.join_room(uuid) from public;
grant execute on function public.join_room(uuid) to authenticated;