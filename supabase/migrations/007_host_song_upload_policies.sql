drop policy if exists "managers edit queue" on public.queue_items;
drop policy if exists "hosts add songs to queue" on public.queue_items;
drop policy if exists "managers update queue" on public.queue_items;
drop policy if exists "managers delete queue" on public.queue_items;

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

drop policy if exists "members see queue" on public.queue_items;

create policy "members see queue"
on public.queue_items
for select
to authenticated
using (
  public.is_room_member(public.queue_items.room_id)
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

drop policy if exists "hosts upload room audio" on storage.objects;

create policy "hosts upload room audio"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'audio'
  and exists (
    select 1
    from public.rooms r
    where r.id::text = split_part(storage.objects.name, '/', 2)
      and r.host_id = auth.uid()
  )
);