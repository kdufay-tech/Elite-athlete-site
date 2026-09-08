-- ============================================================================
-- 20260908_profile_recruiting_fields.sql
--
-- Persist the Recruiting Profile fields. They were never stored ANYWHERE.
--
-- THE BUG
--   src/App.jsx builds a Recruiting Details form (Elite tier) with High School,
--   Graduation Year, GPA and a Hudl/film link, and a completeness checklist
--   that ticks as they are filled. saveProfile() in src/lib/supabase.js maps a
--   fixed allow-list to DB columns:
--     name, weight, height, age, sport, position, goal, level, target_weight
--   and public.profiles has no column for any recruiting field. So every one
--   of them was silently DROPPED on save and lived only in React state.
--   Reload, sign out, or switch device and the athlete's recruiting profile
--   was empty again - and the checklist had been telling them it was complete.
--   The Sep-4 resetUserState() fix makes this bite harder, because account
--   switch now correctly clears state.
--
--   Nobody noticed because the PDF and the mailto: body are both built from
--   the in-memory object, in the same session the athlete typed it.
--
-- TYPES ARE text ON PURPOSE
--   The form fields are free text ("3.8", "2026", "West High School"). A
--   numeric column would reject partial input mid-typing and lose the value
--   rather than storing it - the exact failure this migration exists to fix.
--   Validation belongs in the UI, not in a column type that silently discards.
-- ============================================================================

alter table public.profiles add column if not exists high_school     text;
alter table public.profiles add column if not exists graduation_year text;
alter table public.profiles add column if not exists gpa             text;
alter table public.profiles add column if not exists gpa_scale       text;
alter table public.profiles add column if not exists hudl_link       text;

comment on column public.profiles.hudl_link is
  'Athlete-supplied film/highlight URL shown on the recruiting card and in a share. Free text - never rendered as a link target without escaping.';
