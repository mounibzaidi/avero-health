-- The text layers of every stored guideline PDF, kept as a reusable knowledge base (fiche generation reads them; a
-- search will come later). One row per PDF page: pdftotext for every page (free), LlamaParse markdown only where it
-- ran, so a page is never paid for twice. Pages of an "internal use only" document stay staff-only: end users may
-- only ever see knowledge_pages, which keeps documents whose licence allows publication.
-- Replaces pdf_pages (created by 0004, never filled).

begin;

create extension if not exists vector with schema extensions;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  pdf_path text not null unique,                    -- in the "sources" bucket ("local/..." for a PDF ingested by a script)
  sha256 text not null unique,
  title text,
  licence_text text,
  licence_scope text not null default 'internal' check (licence_scope in ('internal', 'publish')),
  created_at timestamptz not null default now()
);

create table if not exists document_pages (
  document_id uuid not null references documents (id) on delete cascade,
  pdf_page int not null,
  printed_page int,
  raw_text text not null default '',                -- pdftotext -layout
  raw_columns text not null default '',             -- the same, two columns read left then right
  parsed_md text,                                   -- LlamaParse markdown; null where the page was not sent
  parser text not null default 'pdftotext',         -- pdftotext | llamaparse:<tier>
  has_table boolean not null default false,
  has_figure boolean not null default false,
  skipped boolean not null default false,           -- references, author lists, relationship-with-industry appendices
  section_heading text,
  parsed_at timestamptz,
  embedding extensions.vector(1024),                -- not filled yet
  primary key (document_id, pdf_page)
);

alter table fiche_drafts add column if not exists document_id uuid references documents (id) on delete set null;
drop table if exists pdf_pages;

alter table documents enable row level security;
alter table document_pages enable row level security;
do $$
declare t text;
begin
  foreach t in array array['documents', 'document_pages'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select using (public.is_staff())', t);
    execute format('drop policy if exists %1$s_admin_write on %1$s', t);
    execute format('create policy %1$s_admin_write on %1$s for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- What end users may ever be shown as knowledge pages: publishable documents only (read rules of the tables apply).
create or replace view knowledge_pages with (security_invoker = true) as
  select p.document_id, d.title, p.pdf_page, p.printed_page, p.section_heading, coalesce(p.parsed_md, p.raw_columns) as text
  from document_pages p join documents d on d.id = p.document_id
  where d.licence_scope = 'publish' and not p.skipped;

commit;

select (select count(*) from documents) as documents, (select count(*) from document_pages) as pages;
