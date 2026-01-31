import { supabase } from '../config/supabase.js';

export async function getSceneFacts(userId, sceneKey) {
  const { data, error } = await supabase.rpc('get_scene_facts', {
    p_user_id: userId,
    p_scene_key: sceneKey,
  });

  if (error) {
    return [];
  }
  return data || [];
}
export async function upsertSceneFact(userId, sceneKey, factKey, factValue, opts = {}) {
  const {
    confidence = 1.0,
    valueType = 'text',
    source = 'user',
  } = opts;

  const { error } = await supabase.rpc('upsert_scene_fact', {
    p_user_id: userId,
    p_scene_key: sceneKey,
    p_fact_key: factKey,
    p_fact_value: factValue,
    p_confidence: confidence,
    p_value_type: valueType,
    p_source: source,
  });

  return !error;
}
