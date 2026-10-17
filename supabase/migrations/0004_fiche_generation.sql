-- Fiche generation from a guideline PDF (services/api/app/fichegen/): drafts in the fiche-protocole format, the PDF's
-- text layers, the per-line pipeline metadata (never stored in the fiche) and the cost of every API call.
-- Additive only: no existing table changes.

begin;

create table if not exists fiche_drafts (
  id uuid primary key default gen_random_uuid(),
  topic_id text not null check (topic_id ~ '^[a-z0-9-]+$'),
  content jsonb,                                   -- the fiche, fiche-protocole format (validated before saving)
  status text not null default 'draft' check (status in ('draft', 'review', 'published')),
  licence_scope text not null check (licence_scope in ('internal', 'publish')),
  form jsonb not null,                             -- the upload form (title, template, audience, source, licence)
  pdf_path text not null,                          -- in the "sources" bucket
  pdf_sha text not null,
  page_offset int,                                 -- printed page = PDF page + page_offset
  offset_detected boolean not null default false,
  stage text not null default 'uploaded',          -- uploaded | ingesting | needs_offset | ready | routing | generating | checking | done | error
  stage_detail text,
  error text,
  options jsonb not null default '{}'::jsonb,      -- model, batch
  reviewer text,
  reviewed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pdf_pages (
  pdf_sha text not null,
  pdf_page int not null,
  printed_page int,
  raw_layout text not null default '',             -- pdftotext -layout
  raw_columns text not null default '',            -- the same, two columns split at the gutter, left then right
  parsed text not null default '',                 -- LlamaParse markdown
  parsed_figures text[] not null default '{}',     -- parsed blocks that come from a figure or image
  primary key (pdf_sha, pdf_page)
);

create table if not exists fiche_line_meta (
  draft_id uuid not null references fiche_drafts (id) on delete cascade,
  element_id text not null,                        -- the fiche element's id, or "dropped-n" for a dropped line
  section text,
  quote_status text check (quote_status in ('pdf', 'parsed', 'failed')),
  from_figure boolean not null default false,
  retries int not null default 0,
  model text,
  dropped boolean not null default false,
  dropped_line jsonb,                              -- the line as generated, for the reviewer
  reason text,
  primary key (draft_id, element_id)
);

create table if not exists generation_calls (
  id bigserial primary key,
  draft_id uuid references fiche_drafts (id) on delete cascade,
  stage text not null,                             -- routing | section | retry
  section text,
  model text not null,
  batch boolean not null default false,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists generation_calls_draft on generation_calls (draft_id);

alter table fiche_drafts enable row level security;
alter table pdf_pages enable row level security;
alter table fiche_line_meta enable row level security;
alter table generation_calls enable row level security;
do $$
declare t text;
begin
  foreach t in array array['fiche_drafts', 'pdf_pages', 'fiche_line_meta', 'generation_calls'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select using (public.is_staff())', t);
    execute format('drop policy if exists %1$s_admin_write on %1$s', t);
    execute format('create policy %1$s_admin_write on %1$s for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

commit;

select count(*) from fiche_drafts;
