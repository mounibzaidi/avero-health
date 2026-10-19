-- Open reading (for the judges): anyone, signed in or not, can read what staff read (drafts, block checks, sources
-- and their PDFs, the registry). Writes are unchanged: staff/admin only.
begin;

drop policy if exists fiche_versions_read on fiche_versions;
create policy fiche_versions_read on fiche_versions for select using (true);
drop policy if exists source_pdfs_read on source_pdfs;
create policy source_pdfs_read on source_pdfs for select using (true);
drop policy if exists line_reviews_read on line_reviews;
create policy line_reviews_read on line_reviews for select using (true);
drop policy if exists sources_bucket_read on storage.objects;
create policy sources_bucket_read on storage.objects for select using (bucket_id = 'sources');

do $$
declare t text;
begin
  foreach t in array array['topic_sources', 'guideline_alerts', 'guidelines_replaced', 'registry_checks'] loop
    execute format('drop policy if exists %1$s_staff_read on %1$s', t);
    execute format('create policy %1$s_staff_read on %1$s for select using (true)', t);
  end loop;
end $$;
grant select on fiche_versions, source_pdfs, line_reviews, topic_sources, guideline_alerts, guidelines_replaced, registry_checks to anon;

commit;

select count(*) from pg_policies where policyname = 'fiche_versions_read' and qual = 'true';
