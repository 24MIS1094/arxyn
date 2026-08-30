ALTER TABLE public.room_members ADD COLUMN IF NOT EXISTS video_access BOOLEAN DEFAULT FALSE;
CREATE POLICY "room owners can update video_access" ON public.room_members FOR UPDATE TO authenticated USING ( exists ( select 1 from public.rooms r where r.id = public.room_members.room_id and r.owner_id = auth.uid() ) );
