-- Run after the backend/frontend signed-media release is deployed.
begin;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id in ('iris-photos', 'iris-ref', 'iris-temp');

drop policy if exists "Iris photos are publicly readable" on storage.objects;
drop policy if exists "Users can upload their own iris photos" on storage.objects;
drop policy if exists "Users can update their own iris photos" on storage.objects;

drop policy if exists iris_photos_select_own on storage.objects;
create policy iris_photos_select_own on storage.objects for select to authenticated
using (bucket_id = 'iris-photos' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists iris_photos_insert_own on storage.objects;
create policy iris_photos_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'iris-photos' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists iris_photos_update_own on storage.objects;
create policy iris_photos_update_own on storage.objects for update to authenticated
using (bucket_id = 'iris-photos' and (storage.foldername(name))[2] = auth.uid()::text)
with check (bucket_id = 'iris-photos' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists iris_photos_delete_own on storage.objects;
create policy iris_photos_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'iris-photos' and (storage.foldername(name))[2] = auth.uid()::text);

commit;
