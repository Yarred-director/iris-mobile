alter table public.iris_profiles
  alter column image_provider set default 'openai_gpt_image_2';

comment on column public.iris_profiles.image_provider is
  'Server-authoritative Fal image provider selection. Product key openai_gpt_image_2 maps to OpenAI GPT Image 2.5 Sunburst.';
