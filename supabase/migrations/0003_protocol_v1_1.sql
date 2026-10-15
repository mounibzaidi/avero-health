-- Protocol Schema v1.1 (docs/protocol_schema_v1.1.md) is the only fiche format.
-- The fiches of the old numbered schema are deleted, not converted: the owner rewrites the fiches.

begin;

-- ─── Old-format fiches out ──────────────────────────────────────────────────────────────────
-- Subjects cascade to their versions.
delete from subjects s
  where not exists (select 1 from fiche_versions v where v.subject_id = s.id and v.content->>'schema_version' = '1.1.0');
delete from fiche_versions where content->>'schema_version' is distinct from '1.1.0';

-- ─── Only v1.1 content from now on ──────────────────────────────────────────────────────────
alter table fiche_versions drop constraint if exists fiche_versions_content_check;
alter table fiche_versions add constraint fiche_versions_content_check
  check (content->>'schema_version' = '1.1.0' and content->'meta'->>'id' = subject_id);

-- ─── The stored PDF of each source, for the quote check ─────────────────────────────────────
-- Kept outside the fiche: a v1.1 Source has no file field. source_id = Source.id (shared by every fiche citing it).
create table if not exists source_pdfs (
  source_id text primary key,
  pdf_path text not null,                     -- path in the "sources" Storage bucket
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table source_pdfs enable row level security;
drop policy if exists source_pdfs_read on source_pdfs;
create policy source_pdfs_read on source_pdfs for select using (public.is_staff());
drop policy if exists source_pdfs_admin_write on source_pdfs;
create policy source_pdfs_admin_write on source_pdfs for all using (public.is_admin()) with check (public.is_admin());

commit;

select (select count(*) from subjects) as subjects, (select count(*) from fiche_versions) as versions;
