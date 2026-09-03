create or replace function public.is_room_member(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 
    from public.room_members 
    where room_id = target_room 
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_room_manager(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 
    from public.rooms 
    where id = target_room 
      and host_id = auth.uid()
  )
  or exists (
    select 1 
    from public.room_members 
    where room_id = target_room 
      and user_id = auth.uid() 
      and role = 'owner'
  );
$$;
