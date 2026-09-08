-- SAFE INSTANT ROLLBACK / KILL SWITCH.
-- Run this first if the experimental People agents cause any production issue.
-- It disables routing immediately without deleting Myno/People data or requiring a deploy.

update public.iris_experimental_features
set enabled = false,
    updated_at = now()
where feature_key = 'people_agents';
