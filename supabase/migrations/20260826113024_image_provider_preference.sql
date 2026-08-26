alter table public.iris_profiles
  add column if not exists image_provider text not null default 'kling_o3';

update public.iris_profiles
set image_provider = 'kling_o3'
where image_provider not in ('openai_gpt_image_2', 'grok_imagine_2', 'kling_o3');

alter table public.iris_profiles
  drop constraint if exists iris_profiles_image_provider_check;

alter table public.iris_profiles
  add constraint iris_profiles_image_provider_check
  check (image_provider in ('openai_gpt_image_2', 'grok_imagine_2', 'kling_o3'));

comment on column public.iris_profiles.image_provider is
  'User-selected Fal image engine for Iris photos.';
