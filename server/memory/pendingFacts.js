// server/memory/pendingFacts.js

export async function getPendingFact(supabaseClient, userId, sceneKey) {
  const { data, error } = await supabaseClient
    .from('pending_scene_facts')
    .select('fact_key')
    .eq('user_id', userId)
    .eq('scene_key', sceneKey)
    .limit(1);

  if (error) return null;
  return data?.[0]?.fact_key || null;
}

export async function setPendingFact(supabaseClient, userId, sceneKey, factKey) {
  const { error } = await supabaseClient
    .from('pending_scene_facts')
    .upsert({ user_id: userId, scene_key: sceneKey, fact_key: factKey }, { onConflict: 'user_id,scene_key' });

  return !error;
}

export async function clearPendingFact(supabaseClient, userId, sceneKey) {
  const { error } = await supabaseClient
    .from('pending_scene_facts')
    .delete()
    .eq('user_id', userId)
    .eq('scene_key', sceneKey);

  return !error;
}
