// server/memory/sceneFacts.js

export async function getSceneFacts(supabaseClient, userId, sceneKey) {
  const { data, error } = await supabaseClient.rpc('get_scene_facts', {
    p_user_id: userId,
    p_scene_key: sceneKey,
  });

  if (error) return [];
  return data || [];
}

export async function upsertSceneFact(supabaseClient, userId, sceneKey, factKey, factValue) {
  const { error } = await supabaseClient.rpc('upsert_scene_fact', {
    p_user_id: userId,
    p_scene_key: sceneKey,
    p_fact_key: factKey,
    p_fact_value: factValue,
  });

  return !error;
}
