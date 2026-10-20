-- A source's PDF belongs to one fiche: the link is (fiche, source), no longer the source alone. Before, two fiches
-- citing the same source id shared one PDF, so an upload or a removal on one fiche showed on the other. Every link in
-- place is kept, copied to each fiche whose latest version cites that source; a link no fiche cites is dropped.
-- Deleting a fiche drops its links.
begin;

alter table source_pdfs drop constraint if exists source_pdfs_pkey;
alter table source_pdfs add column if not exists subject_id text references subjects (id) on delete cascade;

insert into source_pdfs (subject_id, source_id, pdf_path, updated_at, updated_by)
select distinct on (latest.subject_id, sp.source_id) latest.subject_id, sp.source_id, sp.pdf_path, sp.updated_at, sp.updated_by
from source_pdfs sp
join (
  select distinct on (subject_id) subject_id, content from fiche_versions order by subject_id, version desc
) latest on exists (select 1 from jsonb_array_elements(latest.content -> 'sources') s where s ->> 'id' = sp.source_id)
where sp.subject_id is null;

delete from source_pdfs where subject_id is null;
alter table source_pdfs alter column subject_id set not null;
alter table source_pdfs add primary key (subject_id, source_id);

commit;

select subject_id, source_id, pdf_path from source_pdfs order by subject_id, source_id;
