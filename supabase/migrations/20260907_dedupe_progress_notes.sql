-- ============================================================================
-- 20260907_dedupe_progress_notes.sql
--
-- Remove duplicate progress_notes created by a defective autosave.
--
-- CAUSE (fixed in the same commit)
--   saveProgressNote() INSERTed unconditionally - no id, no upsert - and the
--   debounced autosave in App.jsx listed `authUser` as a dependency. That object
--   is re-set on every auth event, including the hourly TOKEN_REFRESHED, so the
--   effect re-armed and wrote the same text again. Reloading put the note back
--   into state and re-armed it once more.
--
-- SCALE
--   3,054 rows containing 18 real notes and exactly TWO distinct texts:
--     "testing testing testing"  2,645 rows  17 Mar -> 07 Sep
--     "Chk, this out"              409 rows  20 Apr -> 04 Aug
--   99.4% duplication. The most recent duplicate was written minutes before
--   this migration.
--
-- WHAT THIS DOES
--   Keeps the EARLIEST row per (user_id, text) - the original the athlete
--   actually wrote - and deletes the rest. No text is lost: every surviving
--   note retains its original created_at.
--
-- NOT DONE (deliberately)
--   No unique index on (user_id, text). Two genuinely separate notes may share
--   wording, and a constraint would reject the second. The code fix is the
--   correct guard, not the schema.
-- ============================================================================

begin;

create temp table _pn_keep on commit drop as
select distinct on (user_id, text) id
from public.progress_notes
order by user_id, text, created_at asc;

delete from public.progress_notes
where id not in (select id from _pn_keep);

commit;

-- Expected on 2026-09-07: 3054 -> 18 rows, 3036 deleted.
-- Verify:
--   select count(*) from progress_notes;
--   select count(*) - count(distinct (user_id, text)) as remaining_dupes from progress_notes;
