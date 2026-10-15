-- Topic registry: for each topic, the issuing bodies a person chose to follow (never inferred), each with its
-- current guideline; the weekly check of those bodies for a newer version (an alert, never an automatic
-- replacement); and the guidelines replaced, so a fiche built from one of them can be flagged.
-- Run with: npm run db:sql -- supabase/migrations/0002_topic_registry.sql

create table if not exists topic_sources (
  id uuid primary key default gen_random_uuid(),
  topic_id text not null,                          -- shared/topics.yaml id
  body_id text not null,                           -- shared/guideline_bodies.yaml id
  check_method text not null check (check_method in ('pubmed', 'listing')),
  listing_url text,                                -- check_method = listing: the body's guideline page
  current_title text,
  current_year int,
  current_ref text,                                -- DOI or URL of the current guideline
  status text not null default 'à vérifier' check (status in ('actuelle', 'à vérifier')),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (topic_id, body_id)
);

-- A newer version found by the check: shown in the dashboard until a person decides.
create table if not exists guideline_alerts (
  id uuid primary key default gen_random_uuid(),
  topic_source_id uuid not null references topic_sources (id) on delete cascade,
  title text not null,
  year int,
  ref text not null,                               -- DOI or URL
  found_at timestamptz not null default now(),
  state text not null default 'nouvelle' check (state in ('nouvelle', 'remplacée', 'ignorée')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  unique (topic_source_id, ref)
);

-- The guidelines a person replaced: status "remplacée" (by which). A fiche whose source is here is to review.
create table if not exists guidelines_replaced (
  id uuid primary key default gen_random_uuid(),
  topic_source_id uuid not null references topic_sources (id) on delete cascade,
  title text,
  year int,
  ref text,
  replaced_by_title text not null,
  replaced_by_year int,
  replaced_by_ref text not null,
  replaced_at timestamptz not null default now(),
  replaced_by_user uuid references auth.users (id) on delete set null
);

-- When the registry was last checked (the dashboard runs the check when it is a week old).
create table if not exists registry_checks (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  ran_by uuid references auth.users (id) on delete set null,
  checked int not null default 0,
  alerts int not null default 0,
  errors text
);

alter table topic_sources enable row level security;
alter table guideline_alerts enable row level security;
alter table guidelines_replaced enable row level security;
alter table registry_checks enable row level security;

do $$
declare t text;
begin
  foreach t in array array['topic_sources', 'guideline_alerts', 'guidelines_replaced', 'registry_checks'] loop
    execute format('drop policy if exists %1$s_staff_read on %1$s', t);
    execute format('create policy %1$s_staff_read on %1$s for select using (public.is_staff())', t);
    execute format('drop policy if exists %1$s_admin_write on %1$s', t);
    execute format('create policy %1$s_admin_write on %1$s for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

select 'topic registry ready' as status;
