-- Coverage check of a generated fiche (services/api/app/fichegen/coverage.py): how many recommendation and dose rows
-- of the guideline the draft covers, and the rows still not covered, shown to the reviewer as "Non couvert".
-- {rows, rec_rows, dose_rows, matched, excluded, harm_rows, harm_in_8, pct, pct_before, harm_moved,
--  uncovered: [{kind, page, text, cor, loe}]}

alter table fiche_drafts add column if not exists coverage jsonb;
