// server/memory/sceneContext.js
// AUTH-BASED (magic link) — uses auth.uid() inside RPC

export async function getSceneContext(supabase, sceneKey = 'global') {
  const { data, error } = await supabase.rpc('get_scene_context', {
    p_scene_key: sceneKey
  });

  if (error) {
    console.error('[sceneContext] get_scene_context error', error);
    return null;
  }

  return data?.[0] ?? null;
}

export async function patchSceneContext(supabase, sceneKey = 'global', patch = {}) {
  const { error } = await supabase.rpc('patch_scene_context', {
    p_scene_key: sceneKey,
    p_patch: patch
  });

  if (error) {
    console.error('[sceneContext] patch_scene_context error', error);
  }
}

export function formatSceneContextBlock(sceneContext) {
  const ctx = sceneContext || {};

  const loc = [
    ctx.country ? `country=${ctx.country}` : 'country=?',
    ctx.city ? `city=${ctx.city}` : 'city=?',
    ctx.place ? `place=${ctx.place}` : 'place=?',
    ctx.room ? `room=${ctx.room}` : 'room=?'
  ].join(', ');

  return `

SCENE CONTEXT (working state):
- location: ${loc}
- interaction_mode: ${ctx.interaction_mode || 'idle'}
- last_subject: ${ctx.last_subject || '?'}
- last_engine: ${ctx.last_engine || '?'}
`.trimEnd();
}
