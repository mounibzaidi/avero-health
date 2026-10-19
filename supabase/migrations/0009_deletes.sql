-- Deleting from the dashboard (admins): a fiche's unpublished versions (a published version is never deleted on its
-- own; deleting the whole fiche, its subject, removes every version), and the stored source PDFs.
begin;

drop policy if exists fiche_versions_admin_delete_draft on fiche_versions;
create policy fiche_versions_admin_delete_draft on fiche_versions for delete using (public.is_admin() and published_at is null);

drop policy if exists sources_bucket_delete on storage.objects;
create policy sources_bucket_delete on storage.objects for delete using (bucket_id = 'sources' and public.is_admin());

commit;

select count(*) from pg_policies where policyname in ('fiche_versions_admin_delete_draft', 'sources_bucket_delete');
