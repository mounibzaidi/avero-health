-- Time spent editing a draft in the dashboard (manual "select-to-add" and review), in seconds: counted while the
-- editor is visible and the reviewer active, to compare the manual route with the automatic generation.
alter table fiche_drafts add column if not exists edit_seconds integer not null default 0;
alter table fiche_drafts add column if not exists mode text not null default 'auto' check (mode in ('auto', 'manual'));
