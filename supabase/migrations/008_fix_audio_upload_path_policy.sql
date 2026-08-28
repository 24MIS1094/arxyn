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
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.host_id = auth.uid()
  )
);

drop policy if exists "allow audio bucket reads for members" on storage.objects;

create policy "allow audio bucket reads for members"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'audio'
  and exists (
    select 1
    from public.room_members rm
    where rm.user_id = auth.uid()
      and rm.room_id::text = split_part(storage.objects.name, '/', 1)
  )
);