-- Reconstructed from the production catalog (IRIS_MEMORY) on 2026-10-22.
-- Reference snapshot for rebuilding a fresh environment. Do not run against production.

create extension if not exists vector;

create table if not exists public.avatars (
  id uuid not null default gen_random_uuid(),
  image_url text not null,
  variant text not null default 'default'::text,
  is_active boolean not null default false,
  created_at timestamptz default now(),
  constraint avatars_pkey primary key (id)
);

create table if not exists public.episodic_memory (
  id uuid not null default gen_random_uuid(),
  title text,
  narrative text,
  people text[],
  location text,
  emotional_tags text[],
  created_at timestamptz default now(),
  embedding vector(1536),
  memory_type text,
  memory_revision integer default 0,
  memory_note text,
  importance double precision default 0.5,
  updated_at timestamptz,
  last_recalled_at timestamptz,
  reinforcement_count integer not null default 0,
  user_id uuid,
  scene_key text default 'global'::text,
  emotional_weight smallint default 50,
  relationship_weight smallint default 50,
  confidence_score smallint default 75,
  decay_score smallint default 100,
  constraint episodic_memory_pkey primary key (id)
);

create table if not exists public.fact_schema (
  fact_key text not null,
  description text,
  value_type text not null default 'text'::text,
  allowed_values jsonb,
  confidence_default double precision default 0.9,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint fact_schema_pkey primary key (fact_key)
);

create table if not exists public.iris_profiles (
  user_id uuid not null,
  reference_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_interaction_at timestamptz,
  relationship_started_at timestamptz default now(),
  last_photo_sent_at timestamptz,
  last_emotional_event_at timestamptz,
  last_autonomous_message_at timestamptz,
  user_timezone text default 'UTC'::text,
  current_session_started_at timestamptz,
  previous_session_ended_at timestamptz,
  session_gap_seconds bigint,
  reference_image_bucket text,
  reference_image_path text,
  proactivity_enabled boolean not null default true,
  proactivity_quiet_hours jsonb not null default '{"end": "08:00", "start": "22:30"}'::jsonb,
  image_provider text not null default 'openai_gpt_image_2'::text,
  constraint iris_profiles_image_provider_check check (image_provider = any (array['openai_gpt_image_2'::text, 'grok_imagine_2'::text, 'kling_o3'::text])),
  constraint iris_profiles_pkey primary key (user_id),
  constraint iris_profiles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table if not exists public.iris_internal_state (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  mood text default 'neutral'::text,
  energy smallint default 70,
  curiosity smallint default 70,
  attachment smallint default 50,
  focus text default 'open'::text,
  carryover text,
  updated_at timestamptz default now(),
  current_thoughts text,
  desires text,
  unresolved text,
  self_reflection text,
  proactive_topic text,
  last_reflection_at timestamptz,
  constraint iris_internal_state_pkey primary key (id),
  constraint iris_internal_state_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table if not exists public.iris_personality_evolution (
  user_id uuid not null,
  communication_style jsonb default '{}'::jsonb,
  developed_interests text[] default '{}'::text[],
  quirks jsonb default '[]'::jsonb,
  "values" jsonb default '[]'::jsonb,
  user_dynamic jsonb default '{}'::jsonb,
  adopted_phrases text[] default '{}'::text[],
  learned_from_user text,
  evolved_self_summary text,
  last_evolution_at timestamptz,
  evolution_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  trait_state jsonb not null default '{"warmth": 0.76, "sarcasm": 0.46, "patience": 0.66, "curiosity": 0.80, "playfulness": 0.68, "romanticism": 0.52, "independence": 0.66, "assertiveness": 0.66, "protectiveness": 0.56, "competitiveness": 0.42}'::jsonb,
  trait_evidence jsonb not null default '{}'::jsonb,
  constraint iris_personality_evolution_pkey primary key (user_id),
  constraint iris_personality_evolution_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table if not exists public.iris_relationship (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  closeness smallint default 50,
  trust smallint default 50,
  attachment smallint default 50,
  emotional_intensity smallint default 50,
  supportiveness smallint default 50,
  tension smallint default 0,
  updated_at timestamptz default now(),
  constraint attachment_range check (attachment between 0 and 100),
  constraint closeness_range check (closeness between 0 and 100),
  constraint tension_range check (tension between 0 and 100),
  constraint trust_range check (trust between 0 and 100),
  constraint iris_relationship_pkey primary key (id),
  constraint iris_relationship_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table if not exists public.iris_self_model (
  user_id uuid not null,
  reflection text,
  existential_note text,
  last_insight text,
  updated_at timestamptz default now(),
  mood jsonb not null default '{}'::jsonb,
  drives jsonb not null default '{"novelty": 0.58, "curiosity": 0.78, "competence": 0.68, "connection": 0.70, "playfulness": 0.66, "independence": 0.62, "self_consistency": 0.75, "protect_relationship": 0.72}'::jsonb,
  beliefs jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  active_goals jsonb not null default '[]'::jsonb,
  current_concerns jsonb not null default '[]'::jsonb,
  relationship_model jsonb not null default '{}'::jsonb,
  narrative_identity text,
  last_reflection_at timestamptz,
  last_cognition_at timestamptz,
  last_proactive_at timestamptz,
  cognition_version integer not null default 2,
  reflection_revision bigint not null default 0,
  last_reflection_commit_id uuid,
  stable_narrative_identity text,
  stable_identity_evidence jsonb not null default '[]'::jsonb,
  constraint iris_self_model_pkey primary key (user_id),
  constraint iris_self_model_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table if not exists public.pending_scene_facts (
  id uuid not null default gen_random_uuid(),
  user_id text not null,
  scene_key text not null,
  fact_key text not null,
  created_at timestamptz not null default now(),
  constraint pending_scene_facts_pkey primary key (id),
  constraint pending_scene_facts_user_id_scene_key_key unique (user_id, scene_key)
);

create table if not exists public.push_tokens (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  expo_push_token text not null,
  device_id text,
  platform text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint push_tokens_pkey primary key (id)
);

create table if not exists public.relationships (
  id uuid not null default gen_random_uuid(),
  name text,
  role text,
  emotional_profile jsonb,
  created_at timestamptz default now(),
  constraint relationships_name_key unique (name),
  constraint relationships_pkey primary key (id)
);

create table if not exists public.reminders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  due_at timestamptz not null,
  title text,
  body text not null,
  status text not null default 'pending'::text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint reminders_pkey primary key (id),
  constraint reminders_status_check check (status = any (array['pending'::text, 'sent'::text, 'cancelled'::text, 'failed'::text]))
);

create table if not exists public.scene_context (
  user_id text not null,
  scene_key text not null default 'global'::text,
  country text,
  city text,
  place text,
  room text,
  interaction_mode text,
  last_subject text,
  last_engine text,
  last_engine_reply text,
  bridge_buffer jsonb,
  updated_at timestamptz not null default now(),
  location_country text,
  location_city text,
  time_of_day text,
  timezone text,
  engine_lock_count integer not null default 0,
  session_gap_anchor timestamptz,
  constraint scene_context_pk primary key (user_id, scene_key)
);

create table if not exists public.scene_facts (
  id uuid not null default gen_random_uuid(),
  user_id text not null,
  scene_key text not null,
  fact_key text not null,
  fact_value text not null,
  value_type text not null default 'text'::text,
  confidence double precision not null default 1.0,
  source text default 'user'::text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  scope text default 'global'::text,
  constraint scene_facts_pkey primary key (id),
  constraint scene_facts_user_id_scene_key_fact_key_key unique (user_id, scene_key, fact_key)
);

create table if not exists public.semantic_memory (
  id uuid not null default gen_random_uuid(),
  concept text,
  description text,
  created_at timestamptz default now(),
  embedding vector(1536),
  constraint semantic_memory_pkey primary key (id)
);

create table if not exists public.shared_experiences (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  scene_key text not null default 'global'::text,
  location text,
  country text,
  city text,
  summary text not null,
  full_narrative text,
  actions text[],
  emotional_tone text,
  intensity text default 'soft'::text,
  iris_emotion text,
  iris_notes text,
  importance double precision default 0.9,
  recall_count integer default 0,
  last_recalled_at timestamptz,
  embedding vector(1536),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint shared_experiences_pkey primary key (id),
  constraint shared_experiences_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table if not exists public.ui_config (
  id uuid not null default gen_random_uuid(),
  key text not null,
  image_url text not null,
  "overlay" real default 0,
  blur integer default 0,
  created_at timestamptz default now(),
  constraint ui_config_key_key unique (key),
  constraint ui_config_pkey primary key (id)
);

create table if not exists public.user_profile (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  category text not null,
  fact_key text not null,
  fact_value text not null,
  confidence double precision default 0.8,
  source text default 'auto'::text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint user_profile_pkey primary key (id),
  constraint user_profile_user_id_fact_key_key unique (user_id, fact_key),
  constraint user_profile_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

-- Row level security as configured in production.
alter table public.episodic_memory enable row level security;
alter table public.user_profile enable row level security;
alter table public.shared_experiences enable row level security;
alter table public.scene_facts enable row level security;
alter table public.pending_scene_facts enable row level security;
alter table public.scene_context enable row level security;
alter table public.avatars enable row level security;
alter table public.ui_config enable row level security;
alter table public.semantic_memory enable row level security;
alter table public.relationships enable row level security;
alter table public.fact_schema enable row level security;
alter table public.reminders enable row level security;
alter table public.push_tokens enable row level security;
alter table public.iris_profiles enable row level security;
alter table public.iris_relationship enable row level security;
alter table public.iris_internal_state enable row level security;
alter table public.iris_personality_evolution enable row level security;
alter table public.iris_self_model enable row level security;
