-- One:2:Us secure chat photo storage
-- Run once in Supabase SQL Editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path format: <match_id>/<sender_user_id>/<uuid>.<ext>

drop policy if exists "chat media participants can read" on storage.objects;
create policy "chat media participants can read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'chat-media'
  and exists (
    select 1
    from public.matches m
    where m.id::text = split_part(name, '/', 1)
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
      and coalesce(m.status, 'active') = 'active'
  )
);

drop policy if exists "chat media sender can upload" on storage.objects;
create policy "chat media sender can upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and split_part(name, '/', 2) = auth.uid()::text
  and exists (
    select 1
    from public.matches m
    where m.id::text = split_part(name, '/', 1)
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
      and coalesce(m.status, 'active') = 'active'
  )
);

drop policy if exists "chat media sender can delete own upload" on storage.objects;
create policy "chat media sender can delete own upload"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'chat-media'
  and split_part(name, '/', 2) = auth.uid()::text
);
