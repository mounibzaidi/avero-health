-- Admins may overwrite a file in the sources bucket: a topic's last guideline search (_search/<topic>.json) is
-- replaced by the next one. Inserting and deleting were already admin only.
begin;

drop policy if exists sources_bucket_update on storage.objects;
create policy sources_bucket_update on storage.objects for update
  using (bucket_id = 'sources' and public.is_admin()) with check (bucket_id = 'sources' and public.is_admin());

commit;

select count(*) from pg_policies where policyname = 'sources_bucket_update';
