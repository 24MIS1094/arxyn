begin;
  -- Enable realtime for chat messages
  alter publication supabase_realtime add table public.room_messages;
  
  -- Enable realtime for song requests
  alter publication supabase_realtime add table public.song_requests;
commit;
