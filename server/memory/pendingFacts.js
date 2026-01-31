import { supabase } from '../config/supabase.js';

export async function getPendingFact(userId, sceneKey) {
  const { data, error } = await supabase
    .from('pending_scene_facts')
    .select('fact_key')
    .eq('user_id', userId)
    .eq('scene_key', sceneKey)
    .limit(1);

  if (error) return null;
  return data?.[0]?.fact_key || null;
}

export async function setPendingFact(userId, sceneKey, factKey) {
  const { error } = await supabase
    .from('pending_scene_facts')
    .upsert(
      { user_id: userId, scene_key: sceneKey, fact_key: factKey },
      { onConflict: 'user_id,scene_key' }
    );

  return !error;
}

export async function clearPendingFact(userId, sceneKey) {
  const { error } = await supabase
    .from('pending_scene_facts')
    .delete()
    .eq('user_id', userId)
    .eq('scene_key', sceneKey);

  return !error;
}
