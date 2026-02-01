// server/memory/sceneContext.js

export async function getSceneContext(supabase, sceneKey = 'global') {
  const { data, error } = await supabase.rpc(
    'get_scene_context',
    { p_scene_key: sceneKey }
  );

  if (error) {
    console.error('[sceneContext] get error', error);
    return null;
  }

  return data?.[0] ?? null;
}

export async function patchSceneContext(
  supabase,
  sceneKey = 'global',
  patch = {}
) {
  const { error } = await supabase.rpc(
    'patch_scene_context',
    {
      p_scene_key: sceneKey,
      p_patch: patch
    }
  );

  if (error) {
    console.error('[sceneContext] patch error', error);
  }
}
