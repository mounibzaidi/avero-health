-- Avero: fiches stored in the numbered schema (packages/schema) as versioned jsonb snapshots,
-- the staff who edit and publish them, and the private bucket of source PDFs.
-- For a new, empty project. Run in the Supabase SQL editor, or psql against the database URL.

-- Safety: stop before changing anything when the project already holds other tables.
do $$
declare found text;
begin
  select string_agg(table_name, ', ') into found from information_schema.tables
    where table_schema = 'public' and table_name not in ('staff', 'subjects', 'fiche_versions', 'published_fiches');
  if found is not null then
    raise exception 'This migration is for a new project; public already has: %', found;
  end if;
end $$;

-- ─── Staff ───────────────────────────────────────────────────────────────────────────────────
-- Who may use the dashboard: admins edit and publish, relecteurs review. Doctors need no account.
create table if not exists staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'relecteur')),
  name text not null default '',
  service text not null default '',
  created_at timestamptz not null default now()
);
alter table staff enable row level security;

-- SECURITY DEFINER so policies on other tables can ask "is this user staff" without reading staff through its own RLS.
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public
as $$ select role from staff where user_id = auth.uid() $$;
create or replace function public.is_staff() returns boolean
language sql stable as $$ select public.staff_role() is not null $$;
create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.staff_role() = 'admin' $$;

drop policy if exists staff_read on staff;
create policy staff_read on staff for select using (public.is_staff());

-- ─── Subjects: one fiche per subject ─────────────────────────────────────────────────────────
-- id = the fiche's id in the app ("stroke", "acs"...).
create table if not exists subjects (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  title text not null,
  template text not null check (template in ('urgence', 'pathologie')),
  specialite text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Fiche versions: every save is a new snapshot, never edited afterwards ──────────────────
create table if not exists fiche_versions (
  id uuid primary key default gen_random_uuid(),
  subject_id text not null references subjects (id) on delete cascade,
  version int not null check (version > 0),                -- 1, 2, 3... per subject, every save
  content jsonb not null check (content->>'kind' = 'fiche'), -- a Fiche (packages/schema), validated before save
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,                                  -- set once, when this version is published
  published_by uuid references auth.users (id) on delete set null,
  unique (subject_id, version)
);
create index if not exists fiche_versions_subject_idx on fiche_versions (subject_id, version desc);

-- A snapshot's content never changes; only its publication can be recorded (once).
create or replace function public.fiche_versions_frozen() returns trigger
language plpgsql as $$
begin
  if new.content is distinct from old.content or new.subject_id <> old.subject_id or new.version <> old.version then
    raise exception 'fiche_versions: a saved version cannot be changed; save a new version';
  end if;
  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'fiche_versions: a publication cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists fiche_versions_frozen on fiche_versions;
create trigger fiche_versions_frozen before update on fiche_versions
  for each row execute procedure public.fiche_versions_frozen();

-- ─── RLS ─────────────────────────────────────────────────────────────────────────────────────
-- Published fiches are public (the app has no sign-in for doctors). Drafts: staff. Admins save and publish.
alter table subjects enable row level security;
alter table fiche_versions enable row level security;

drop policy if exists subjects_read on subjects;
create policy subjects_read on subjects for select using (true);
drop policy if exists subjects_admin_write on subjects;
create policy subjects_admin_write on subjects for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists fiche_versions_read on fiche_versions;
create policy fiche_versions_read on fiche_versions for select using (published_at is not null or public.is_staff());
drop policy if exists fiche_versions_admin_insert on fiche_versions;
create policy fiche_versions_admin_insert on fiche_versions for insert with check (public.is_admin());
drop policy if exists fiche_versions_admin_publish on fiche_versions;
create policy fiche_versions_admin_publish on fiche_versions for update using (public.is_admin()) with check (public.is_admin());

-- ─── The app's index: latest published version per subject ──────────────────────────────────
create or replace view published_fiches with (security_invoker = true) as
  select distinct on (fv.subject_id)
    fv.subject_id, fv.version, fv.published_at, fv.content
  from fiche_versions fv
  where fv.published_at is not null
  order by fv.subject_id, fv.version desc;
grant select on published_fiches to anon, authenticated;

-- ─── Source PDFs: private bucket, staff read, admins write ──────────────────────────────────
insert into storage.buckets (id, name, public) values ('sources', 'sources', false)
  on conflict (id) do nothing;
drop policy if exists sources_bucket_read on storage.objects;
create policy sources_bucket_read on storage.objects for select using (bucket_id = 'sources' and public.is_staff());
drop policy if exists sources_bucket_write on storage.objects;
create policy sources_bucket_write on storage.objects for insert with check (bucket_id = 'sources' and public.is_admin());
drop policy if exists sources_bucket_delete on storage.objects;
create policy sources_bucket_delete on storage.objects for delete using (bucket_id = 'sources' and public.is_admin());
