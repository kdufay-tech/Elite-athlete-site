-- ============================================================================
-- 20260908_profile_location.sql
--
-- The last unpersisted recruiting field.
--
-- 20260908_profile_recruiting_fields added high_school, graduation_year, gpa,
-- gpa_scale and hudl_link after finding saveProfile() silently dropped them.
-- `location` was flagged in that migration's notes and deliberately left out
-- rather than inventing schema mid-task.
--
-- It is not optional. The recruiting card renders profile.location, and so
-- does the outbound coach email - a real test send on 2026-09-08 carried
-- "Location: Atlanta GA" while the column did not exist, so the value lived
-- only in React state and vanished on reload. Same silent-drop defect, one
-- field later.
-- ============================================================================

alter table public.profiles add column if not exists location text;

comment on column public.profiles.location is
  'Athlete city/state for the recruiting card. Added 2026-09-08: the recruiting UI and the outbound coach email both render profile.location, but no column existed, so it was silently dropped on every save - the same defect as high_school/gpa/graduation_year/hudl_link in 20260908_profile_recruiting_fields.';
