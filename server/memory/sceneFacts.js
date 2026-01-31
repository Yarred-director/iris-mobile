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
