// server/memory/sceneFacts.js

export async function getSceneFacts(supabaseClient, userId, sceneKey, scope = 'global') {
  const { data, error } = await supabaseClient.rpc('get_scene_facts', {
    p_user_id: userId,
    p_scene_key: sceneKey,
    p_scope: scope,
  });

  if (error) return [];
  return data || [];
}

export async function upsertSceneFact(
  supabaseClient,
  userId,
  sceneKey,
  scope,
  factKey,
  factValue,
  valueType = 'text',
  confidence = 0.9,
  source = 'user'
) {
  const { error } = await supabaseClient.rpc('upsert_scene_fact', {
    p_user_id: userId,
    p_scene_key: sceneKey,
    p_scope: scope,
    p_fact_key: factKey,
    p_fact_value: factValue,
    p_value_type: valueType,
    p_confidence: confidence,
    p_source: source,
  });

  return !error;
}
