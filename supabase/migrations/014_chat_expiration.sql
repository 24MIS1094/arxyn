begin;
  
  -- Create a function to delete expired messages
  create or replace function public.cleanup_expired_room_messages()
  returns trigger
  language plpgsql
  security definer
  as $$
  begin
    delete from public.room_messages where created_at < now() - interval '1 hour';
    return new;
  end;
  $$;

  -- Drop existing trigger if it exists
  drop trigger if exists cleanup_room_messages_trigger on public.room_messages;

  -- Create trigger to run cleanup on every new message insert
  create trigger cleanup_room_messages_trigger
  after insert on public.room_messages
  execute function public.cleanup_expired_room_messages();

commit;
