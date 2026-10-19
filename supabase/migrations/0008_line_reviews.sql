-- Each block of a fiche checked against its PDF by a reviewer, before publishing. `sig` is a hash of the block as it
-- was checked: once the block is edited, the hash differs and the block reads as not checked again.
begin;

create table if not exists line_reviews (
  subject_id text not null references subjects (id) on delete cascade,
  line_id text not null,
  sig text not null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz not null default now(),
  primary key (subject_id, line_id)
);
alter table line_reviews enable row level security;
drop policy if exists line_reviews_read on line_reviews;
create policy line_reviews_read on line_reviews for select using (public.is_staff());
drop policy if exists line_reviews_write on line_reviews;
create policy line_reviews_write on line_reviews for all using (public.is_staff()) with check (public.is_staff());

commit;

select count(*) from line_reviews;
