-- ============================================================================
-- Elite Athlete — BASELINE SCHEMA
-- Generated 2026-09-03 from live Supabase project mllqcjvvflieszmjipfs.
--
-- This is the retroactive baseline: the database existed for months before any
-- migration was ever committed. Everything below reflects production AS IT IS.
-- From here forward every DB change gets its own dated migration file so the
-- repo alone is sufficient to reconstruct the database.
--
-- Covers: 26 tables (all RLS-enabled), constraints, indexes, RLS policies,
--         3 views, 1 function. Auth/storage schemas are managed by Supabase.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────────

create table if not exists public.app_settings (
  key text not null,
  value text not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.benchmarks (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  date text not null,
  test text not null,
  value text,
  unit text default ''::text,
  notes text default ''::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.beta_codes (
  id uuid default gen_random_uuid() not null,
  code text not null,
  label text,
  plan text default 'beta_elite'::text,
  duration_days integer not null,
  max_uses integer,
  uses integer default 0,
  active boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists public.beta_feedback (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  email text,
  category text default 'general'::text not null,
  rating integer,
  message text not null,
  page text,
  created_at timestamp with time zone default now()
);

create table if not exists public.beta_invites (
  id uuid default gen_random_uuid() not null,
  email text not null,
  beta_type text default 'athlete'::text,
  token text not null,
  duration_days integer default 30,
  status text default 'pending'::text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  sent_at timestamp with time zone,
  accepted_at timestamp with time zone,
  accepted_by uuid,
  followup_sent_at timestamp with time zone,
  followup_count integer default 0,
  template text default 'generic'::text
);

create table if not exists public.calendar_events (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  event_date date not null,
  title text not null,
  event_type text default 'training'::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.check_ins (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  date date not null,
  recovery integer default 7,
  energy integer default 7,
  sleep numeric(4,1) default 8,
  soreness integer default 3,
  mood integer default 7,
  notes text default ''::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.coach_contacts (
  id uuid default gen_random_uuid() not null,
  email text,
  coach_name text,
  ad_name text,
  school text,
  sport text,
  level text,
  state text,
  region text,
  classification text,
  phone text,
  website text,
  source text,
  status text default 'active'::text not null,
  validated boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.coach_ops_drafts (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  channel text default 'email'::text not null,
  audience text,
  subject text,
  body text,
  meta jsonb default '{}'::jsonb not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  approved_at timestamp with time zone,
  sent_at timestamp with time zone,
  sent_result jsonb
);

create table if not exists public.coach_ops_runs (
  id uuid default gen_random_uuid() not null,
  run_type text default 'weekly'::text not null,
  status text default 'success'::text not null,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  detail jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.coach_ops_settings (
  id integer default 1 not null,
  mode text default 'manual'::text not null,
  auto_approve boolean default false not null,
  auto_send boolean default false not null,
  auto_kinds text[] default '{}'::text[] not null,
  daily_send_cap integer default 250 not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.coach_waitlist (
  id uuid default gen_random_uuid() not null,
  email text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.email_blasts (
  id uuid default gen_random_uuid() not null,
  blast_id text not null,
  email text not null,
  sent_at timestamp with time zone default now(),
  subject text
);

create table if not exists public.email_events (
  id uuid default gen_random_uuid() not null,
  email text,
  type text,
  bounce_type text,
  resend_id text,
  blast_id text,
  created_at timestamp with time zone default now(),
  raw jsonb
);

create table if not exists public.journal_entries (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  title text,
  text text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.kpi_snapshots (
  id uuid default gen_random_uuid() not null,
  week_start date not null,
  captured_at timestamp with time zone default now() not null,
  metrics jsonb default '{}'::jsonb not null,
  digest text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.nutrition_logs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  date text not null,
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  water numeric default 0,
  created_at timestamp with time zone default now()
);

create table if not exists public.profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  name text,
  weight text,
  height text,
  age text,
  sport text default 'football'::text,
  position text,
  goal text default 'Weight Maintenance'::text,
  updated_at timestamp with time zone default now(),
  target_weight numeric,
  ai_consent_at timestamp with time zone,
  level text,
  account_type text,
  onboarding_completed boolean default false not null
);

create table if not exists public.progress_notes (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  text text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.progress_photos (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  label text,
  date text,
  weight text,
  note text,
  storage_path text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_name text,
  status text default 'inactive'::text,
  current_period_end timestamp with time zone,
  updated_at timestamp with time zone default now(),
  billing_interval text default 'month'::text,
  beta_expires_at timestamp with time zone,
  reminder_7_sent boolean default false,
  reminder_3_sent boolean default false,
  reminder_0_sent boolean default false
);

create table if not exists public.support_inbound (
  id uuid default gen_random_uuid() not null,
  gmail_message_id text,
  thread_id text,
  from_email text,
  from_name text,
  subject text,
  snippet text,
  body text,
  received_at timestamp with time zone,
  classification text,
  handled boolean default false not null,
  created_at timestamp with time zone default now() not null,
  audience text
);

create table if not exists public.teams (
  id uuid default gen_random_uuid() not null,
  coach_id uuid not null,
  name text not null,
  sport text,
  join_code text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.team_members (
  id uuid default gen_random_uuid() not null,
  team_id uuid not null,
  coach_id uuid not null,
  athlete_id uuid not null,
  sport text,
  position text,
  status text default 'active'::text not null,
  joined_at timestamp with time zone default now() not null
);

create table if not exists public.weight_logs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  date text default CURRENT_DATE not null,
  weight numeric(6,2),
  body_fat numeric(5,2),
  created_at timestamp with time zone default now()
);

create table if not exists public.workout_logs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  date text,
  week text,
  exercise text,
  load text,
  rpe text default ''::text,
  notes text default ''::text,
  wk_type text default ''::text,
  wk_focus text default ''::text,
  sets integer default 0,
  total_vol numeric default 0,
  created_at timestamp with time zone default now()
);

-- ─────────────────────────────────────────────────────────────
-- PRIMARY KEYS
-- ─────────────────────────────────────────────────────────────
alter table public.app_settings       add constraint app_settings_pkey       primary key (key);
alter table public.benchmarks         add constraint benchmarks_pkey         primary key (id);
alter table public.beta_codes         add constraint beta_codes_pkey         primary key (id);
alter table public.beta_feedback      add constraint beta_feedback_pkey      primary key (id);
alter table public.beta_invites       add constraint beta_invites_pkey       primary key (id);
alter table public.calendar_events    add constraint calendar_events_pkey    primary key (id);
alter table public.check_ins          add constraint check_ins_pkey          primary key (id);
alter table public.coach_contacts     add constraint coach_contacts_pkey     primary key (id);
alter table public.coach_ops_drafts   add constraint coach_ops_drafts_pkey   primary key (id);
alter table public.coach_ops_runs     add constraint coach_ops_runs_pkey     primary key (id);
alter table public.coach_ops_settings add constraint coach_ops_settings_pkey primary key (id);
alter table public.coach_waitlist     add constraint coach_waitlist_pkey     primary key (id);
alter table public.email_blasts       add constraint email_blasts_pkey       primary key (id);
alter table public.email_events       add constraint email_events_pkey       primary key (id);
alter table public.journal_entries    add constraint journal_entries_pkey    primary key (id);
alter table public.kpi_snapshots      add constraint kpi_snapshots_pkey      primary key (id);
alter table public.nutrition_logs     add constraint nutrition_logs_pkey     primary key (id);
alter table public.profiles           add constraint profiles_pkey           primary key (id);
alter table public.progress_notes     add constraint progress_notes_pkey     primary key (id);
alter table public.progress_photos    add constraint progress_photos_pkey    primary key (id);
alter table public.subscriptions      add constraint subscriptions_pkey      primary key (id);
alter table public.support_inbound    add constraint coach_replies_pkey      primary key (id);
alter table public.team_members       add constraint team_members_pkey       primary key (id);
alter table public.teams              add constraint teams_pkey              primary key (id);
alter table public.weight_logs        add constraint weight_logs_pkey        primary key (id);
alter table public.workout_logs       add constraint workout_logs_pkey       primary key (id);

-- ─────────────────────────────────────────────────────────────
-- UNIQUE CONSTRAINTS
-- ─────────────────────────────────────────────────────────────
alter table public.beta_codes      add constraint beta_codes_code_key             unique (code);
alter table public.beta_invites    add constraint beta_invites_token_key          unique (token);
alter table public.check_ins       add constraint check_ins_user_id_date_key      unique (user_id, date);
alter table public.coach_contacts  add constraint coach_contacts_email_key        unique (email);
alter table public.coach_waitlist  add constraint coach_waitlist_email_key        unique (email);
alter table public.email_blasts    add constraint email_blasts_blast_id_email_key unique (blast_id, email);
alter table public.nutrition_logs  add constraint nutrition_logs_user_id_date_key unique (user_id, date);
alter table public.profiles        add constraint profiles_user_id_key            unique (user_id);
alter table public.subscriptions   add constraint subscriptions_user_id_key       unique (user_id);
alter table public.support_inbound add constraint coach_replies_gmail_message_id_key unique (gmail_message_id);
alter table public.team_members    add constraint team_members_team_id_athlete_id_key unique (team_id, athlete_id);
alter table public.teams           add constraint teams_join_code_key             unique (join_code);
alter table public.weight_logs     add constraint weight_logs_user_id_date_key    unique (user_id, date);

-- ─────────────────────────────────────────────────────────────
-- FOREIGN KEYS
-- ─────────────────────────────────────────────────────────────
alter table public.benchmarks      add constraint benchmarks_user_id_fkey      foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.beta_feedback   add constraint beta_feedback_user_id_fkey   foreign key (user_id)     references auth.users(id);
alter table public.beta_invites    add constraint beta_invites_accepted_by_fkey foreign key (accepted_by) references auth.users(id);
alter table public.calendar_events add constraint calendar_events_user_id_fkey foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.check_ins       add constraint check_ins_user_id_fkey       foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.journal_entries add constraint journal_entries_user_id_fkey foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.nutrition_logs  add constraint nutrition_logs_user_id_fkey  foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.profiles        add constraint profiles_user_id_fkey        foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.progress_notes  add constraint progress_notes_user_id_fkey  foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.progress_photos add constraint progress_photos_user_id_fkey foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.subscriptions   add constraint subscriptions_user_id_fkey   foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.team_members    add constraint team_members_athlete_id_fkey foreign key (athlete_id)  references auth.users(id) on delete cascade;
alter table public.team_members    add constraint team_members_coach_id_fkey   foreign key (coach_id)    references auth.users(id) on delete cascade;
alter table public.team_members    add constraint team_members_team_id_fkey    foreign key (team_id)     references public.teams(id) on delete cascade;
alter table public.teams           add constraint teams_coach_id_fkey          foreign key (coach_id)    references auth.users(id) on delete cascade;
alter table public.weight_logs     add constraint weight_logs_user_id_fkey     foreign key (user_id)     references auth.users(id) on delete cascade;
alter table public.workout_logs    add constraint workout_logs_user_id_fkey    foreign key (user_id)     references auth.users(id) on delete cascade;

-- ─────────────────────────────────────────────────────────────
-- CHECK CONSTRAINTS
-- ─────────────────────────────────────────────────────────────
alter table public.beta_feedback      add constraint beta_feedback_rating_check     check (rating >= 1 and rating <= 5);
alter table public.coach_contacts     add constraint coach_contacts_level_check     check (level = any (array['hs'::text,'college'::text,'pro'::text]));
alter table public.coach_ops_settings add constraint coach_ops_settings_mode        check (mode = any (array['manual'::text,'auto'::text]));
alter table public.coach_ops_settings add constraint coach_ops_settings_singleton   check (id = 1);
alter table public.profiles           add constraint profiles_level_check           check (level is null or level = any (array['hs'::text,'college'::text,'pro'::text]));

-- ─────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────
create index if not exists coach_contacts_seg          on public.coach_contacts   using btree (level, state, sport, status);
create index if not exists coach_ops_drafts_status_idx on public.coach_ops_drafts using btree (status, created_at desc);
create index if not exists coach_ops_runs_created_idx  on public.coach_ops_runs   using btree (created_at desc);
create index if not exists coach_replies_handled_idx   on public.support_inbound  using btree (handled, received_at desc);
create index if not exists coach_replies_received_idx  on public.support_inbound  using btree (received_at desc);
create index if not exists email_blasts_blast_id_idx   on public.email_blasts     using btree (blast_id);
create index if not exists email_blasts_email_idx      on public.email_blasts     using btree (email);
create index if not exists email_events_blast_idx      on public.email_events     using btree (blast_id);
create index if not exists email_events_email_idx      on public.email_events     using btree (email);
create index if not exists email_events_type_idx       on public.email_events     using btree (type);
create index if not exists kpi_snapshots_week_start_idx on public.kpi_snapshots   using btree (week_start desc);
create index if not exists team_members_athlete_idx    on public.team_members     using btree (athlete_id);
create index if not exists team_members_coach_idx      on public.team_members     using btree (coach_id);
create index if not exists teams_coach_idx             on public.teams            using btree (coach_id);
create index if not exists teams_join_code_idx         on public.teams            using btree (join_code);

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Every table has RLS ENABLED. Tables with NO policy below are
-- deliberately service-role-only (Netlify functions bypass RLS with
-- the service key): beta_codes, beta_invites, beta_feedback (select),
-- coach_contacts, coach_ops_*, email_blasts, email_events,
-- kpi_snapshots, support_inbound.
-- ─────────────────────────────────────────────────────────────
alter table public.app_settings       enable row level security;
alter table public.benchmarks         enable row level security;
alter table public.beta_codes         enable row level security;
alter table public.beta_feedback      enable row level security;
alter table public.beta_invites       enable row level security;
alter table public.calendar_events    enable row level security;
alter table public.check_ins          enable row level security;
alter table public.coach_contacts     enable row level security;
alter table public.coach_ops_drafts   enable row level security;
alter table public.coach_ops_runs     enable row level security;
alter table public.coach_ops_settings enable row level security;
alter table public.coach_waitlist     enable row level security;
alter table public.email_blasts       enable row level security;
alter table public.email_events       enable row level security;
alter table public.journal_entries    enable row level security;
alter table public.kpi_snapshots      enable row level security;
alter table public.nutrition_logs     enable row level security;
alter table public.profiles           enable row level security;
alter table public.progress_notes     enable row level security;
alter table public.progress_photos    enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.support_inbound    enable row level security;
alter table public.team_members       enable row level security;
alter table public.teams              enable row level security;
alter table public.weight_logs        enable row level security;
alter table public.workout_logs       enable row level security;

-- Per-user ownership (the core athlete data model)
create policy "own_profile"                  on public.profiles        for all    using (auth.uid() = user_id);
create policy "own_sub"                      on public.subscriptions   for all    using (auth.uid() = user_id);
create policy "own_journals"                 on public.journal_entries for all    using (auth.uid() = user_id);
create policy "own_notes"                    on public.progress_notes  for all    using (auth.uid() = user_id);
create policy "own_events"                   on public.calendar_events for all    using (auth.uid() = user_id);
create policy "Users manage own check_ins"      on public.check_ins       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own benchmarks"     on public.benchmarks      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own nutrition_logs" on public.nutrition_logs  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own weight_logs"    on public.weight_logs     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own workout_logs"   on public.workout_logs    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own photos"         on public.progress_photos for all using (user_id = auth.uid())  with check (user_id = auth.uid());
create policy "Users can submit feedback"       on public.beta_feedback   for insert with check (auth.uid() = user_id);

-- Read-only public config (only key present: beta_max_users)
create policy "public_read_app_settings" on public.app_settings for select using (true);

-- Explicit deny — waitlist writes go through the Netlify function
create policy "Service role only" on public.coach_waitlist for all using (false) with check (false);

-- Coach roster (Phase 0). Cross-user athlete reads do NOT use these policies —
-- they run server-side with the service role in netlify/functions/coach-roster.js.
create policy "teams_coach_all"    on public.teams        for all    using (coach_id  = auth.uid()) with check (coach_id = auth.uid());
create policy "tm_coach_select"    on public.team_members for select using (coach_id   = auth.uid());
create policy "tm_athlete_select"  on public.team_members for select using (athlete_id = auth.uid());
create policy "tm_athlete_insert"  on public.team_members for insert with check (athlete_id = auth.uid());
create policy "tm_athlete_delete"  on public.team_members for delete using (athlete_id = auth.uid());
create policy "tm_coach_delete"    on public.team_members for delete using (coach_id   = auth.uid());

-- NOTE: email_blasts previously carried a policy named "service_role_all"
-- defined `for all to public using (true)`, which exposed the entire outreach
-- recipient list to any caller holding the public anon key. Dropped 2026-09-03.
-- Do not recreate it. See 20260903_fix_email_blasts_rls.sql.

-- ─────────────────────────────────────────────────────────────
-- FUNCTIONS
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path to ''
as $function$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$function$;

-- ─────────────────────────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────────────────────────
create or replace view public.coach_contacts_folders as
  select coalesce(region,'(none)') as region,
         coalesce(state,'(none)')  as state,
         coalesce(level,'(none)')  as level,
         status,
         count(*)::integer as n
  from coach_contacts
  group by coalesce(region,'(none)'), coalesce(state,'(none)'), coalesce(level,'(none)'), status
  order by coalesce(region,'(none)'), coalesce(state,'(none)'), coalesce(level,'(none)'), status;

create or replace view public.human_engaged as
  select distinct lower(e.email) as email
  from email_events e
  join email_events d
    on d.resend_id = e.resend_id
   and d.type = any (array['email.delivered','email.sent'])
  where e.type = any (array['email.opened','email.clicked'])
    and e.resend_id is not null
    and e.created_at > (d.created_at + interval '01:00:00');

create or replace view public.tranche_metrics as
  with tranches as (
    select blast_id, min(sent_at) as sent_at, min(subject) as subject,
           count(distinct lower(email)) as recipients
    from email_blasts where blast_id like 'blast\_%' group by blast_id
  ), recips as (
    select distinct blast_id, lower(email) as email
    from email_blasts where blast_id like 'blast\_%'
  ), ev as (
    select lower(email) as email,
           max((type = 'email.delivered')::integer)  as delivered,
           max((type = 'email.opened')::integer)     as opened,
           max((type = 'email.bounced')::integer)    as bounced,
           max((type = 'email.complained')::integer) as complained
    from email_events group by lower(email)
  ), fu as (
    select lower(email) as email,
           max((blast_id = 'followup_d3')::integer) as d3,
           max((blast_id = 'followup_d5')::integer) as d5,
           max((blast_id = 'followup_d7')::integer) as d7
    from email_blasts
    where blast_id = any (array['followup_d3','followup_d5','followup_d7'])
    group by lower(email)
  ), unsub as (
    select distinct lower(email) as email from email_blasts where blast_id = 'unsubscribed'
  ), sp as (
    select r_1.blast_id, mode() within group (order by c.sport) as sport
    from recips r_1 join coach_contacts c on lower(c.email) = r_1.email
    group by r_1.blast_id
  )
  select t.blast_id, t.sent_at, t.subject, t.recipients, sp.sport,
    count(distinct case when ev.delivered  = 1 then r.email end) as delivered,
    count(distinct case when ev.opened     = 1 then r.email end) as opened,
    count(distinct case when ev.bounced    = 1 then r.email end) as bounced,
    count(distinct case when ev.complained = 1 then r.email end) as complained,
    count(distinct case when u.email is not null then r.email end) as unsubscribed,
    count(distinct case when fu.d3 = 1 then r.email end) as followup_d3,
    count(distinct case when fu.d5 = 1 then r.email end) as followup_d5,
    count(distinct case when fu.d7 = 1 then r.email end) as followup_d7
  from tranches t
  join recips r on r.blast_id = t.blast_id
  left join ev    on ev.email = r.email
  left join fu    on fu.email = r.email
  left join unsub u on u.email = r.email
  left join sp    on sp.blast_id = t.blast_id
  group by t.blast_id, t.sent_at, t.subject, t.recipients, sp.sport
  order by t.sent_at desc;
