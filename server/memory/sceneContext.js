// server/memory/sceneContext.js
// Scene Context Core wrappers + prompt block formatter

export async function getSceneContext(supabase, userId, sceneKey = 'global') {
  // Ak máš už auth.uid() RPC bez userId parametra,
  // môžeš userId ignorovať a volať len p_scene_key.
  // My spravíme kompatibilné: skúsime auth verziu, a keď failne, skúsime userId verziu.

  // 1) Auth-based RPC (recommended when magic link works)
  try {
    const { data, error } = await supabase.rpc('get_scene_context', {
      p_scene_key: sceneKey
    });

    if (!error) return data?.[0] ?? null;
  } catch (_) {}

  // 2) userId-based fallback RPC (ak máš funkcie s p_user_id)
  try {
    const { data, error } = await supabase.rpc('get_scene_context_uid', {
      p_user_id: String(userId),
      p_scene_key: sceneKey
    });

    if (error) {
      console.error('[sceneContext] get_scene_context_uid error', error);
      return null;
    }

    return data?.[0] ?? null;
  } catch (e) {
    console.error('[sceneContext] getSceneContext exception', e);
    return null;
  }
}

export async function patchSceneContext(
  supabase,
  userId,
  sceneKey = 'global',
  patch = {}
) {
  // 1) Auth-based RPC
  try {
    const { error } = await supabase.rpc('patch_scene_context', {
      p_scene_key: sceneKey,
      p_patch: patch
    });

    if (!error) return;
  } catch (_) {}

  // 2) userId-based fallback RPC
  try {
    const { error } = await supabase.rpc('patch_scene_context_uid', {
      p_user_id: String(userId),
      p_scene_key: sceneKey,
      p_patch: patch
    });

    if (error) console.error('[sceneContext] patch_scene_context_uid error', error);
  } catch (e) {
    console.error('[sceneContext] patchSceneContext exception', e);
  }
}

// ✅ THIS is what your index.js imports
export function formatSceneContextBlock(sceneContext) {
  const ctx = sceneContext || {};

  const loc = [
    ctx.country ? `country=${ctx.country}` : 'country=?',
    ctx.city ? `city=${ctx.city}` : 'city=?',
    ctx.place ? `place=${ctx.place}` : 'place=?',
    ctx.room ? `room=${ctx.room}` : 'room=?'
  ].join(', ');

  const mode = ctx.interaction_mode || 'idle';
  const subject = ctx.last_subject || '?';
  const lastEngine = ctx.last_engine || '?';

  return `

SCENE CONTEXT (working state):
- location: ${loc}
- interaction_mode: ${mode}
- last_subject: ${subject}
- last_engine: ${lastEngine}
`.trimEnd();
}
