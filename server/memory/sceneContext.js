// server/memory/sceneContext.js
// DB-driven SCC access. No hardcoded places/people/facts.

function safeJsonParse(val, fallback) {
  try {
    if (val == null) return fallback;
    if (typeof val === 'object') return val; // already object
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// only allow fields that exist in your SCC model (avoid patch poisoning)
const ALLOWED_PATCH_KEYS = new Set([
  'location_city',
  'location_country',
  'place',
  'room',
  'time_of_day',
  'interaction_mode',
  'last_subject',
  'last_engine',
  'last_engine_reply',
  'bridge_buffer',
  'engine_lock_count', // ✅ NEW: allow engine lock persistence
]);

function sanitizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;

  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_PATCH_KEYS.has(k)) continue;
    if (v === undefined) continue;

    // normalize strings (trim)
    if (typeof v === 'string') out[k] = v.trim();
    else out[k] = v;
  }

  return out;
}

function resolveContext(sceneContext) {
  const city = sceneContext?.location_city || '';
  const country = sceneContext?.location_country || '';
  return {
    ...sceneContext,
    _resolved: { city, country },
  };
}

/**
 * Try RPC first (preferred), fallback to direct table access.
 * This works with your user-scoped Supabase client and RLS.
 */
export async function getSceneContext(supabaseClient, sceneKey = 'global') {
  // 1) RPC path
  {
    const { data, error } = await supabaseClient.rpc('get_scene_context', {
      p_scene_key: sceneKey,
    });

    if (!error && data) {
      // Some RPC return array, some return object
      const row = Array.isArray(data) ? data[0] : data;
      return resolveContext(row || null);
    }
  }

  // 2) Fallback: direct table read
  const { data, error } = await supabaseClient
    .from('scene_context')
    .select('*')
    .eq('scene_key', sceneKey)
    .limit(1);

  if (error) return resolveContext(null);
  const row = data?.[0] || null;

  // If missing, create it (RLS should allow insert for authenticated)
  if (!row) {
    const { data: created, error: insErr } = await supabaseClient
      .from('scene_context')
      .insert({ scene_key: sceneKey })
      .select('*')
      .limit(1);

    if (insErr) return resolveContext(null);
    return resolveContext(created?.[0] || null);
  }

  return resolveContext(row);
}

export async function patchSceneContext(
  supabaseClient,
  sceneKey = 'global',
  patch = {}
) {
  const cleanPatch = sanitizePatch(patch);
  if (!Object.keys(cleanPatch).length) return false;

  // 1) RPC path (preferred)
  {
    const { error } = await supabaseClient.rpc('patch_scene_context', {
      p_scene_key: sceneKey,
      p_patch: cleanPatch,
    });

    if (!error) return true;
  }

  // 2) Fallback: direct update (upsert-like)
  // Ensure row exists
  const current = await getSceneContext(supabaseClient, sceneKey);
  if (!current) {
    const { error: insErr } = await supabaseClient
      .from('scene_context')
      .insert({ scene_key: sceneKey, ...cleanPatch });

    return !insErr;
  }

  const { error } = await supabaseClient
    .from('scene_context')
    .update(cleanPatch)
    .eq('scene_key', sceneKey);

  return !error;
}

/**
 * Internal context block (NOT for repeating to user)
 */
export function formatSceneContextBlock(sceneContext) {
  if (!sceneContext) return '';

  const r = sceneContext._resolved || {};
  return `
SCENE_CONTEXT_INTERNAL:
city=${r.city || ''}
country=${r.country || ''}
place=${sceneContext.place || ''}
room=${sceneContext.room || ''}
time_of_day=${sceneContext.time_of_day || ''}
last_subject=${sceneContext.last_subject || ''}
RULE:
- This block is internal context. Do NOT repeat it to the user unless asked.
`.trimEnd();
}

/**
 * Hard truth context (model must not contradict)
 */
export function formatHardSceneContextBlock(sceneContext) {
  if (!sceneContext) return '';

  const r = sceneContext._resolved || {};
  const lines = [];

  if (r.country) lines.push(`- country: ${r.country}`);
  if (r.city) lines.push(`- city: ${r.city}`);
  if (sceneContext.place) lines.push(`- place: ${sceneContext.place}`);
  if (sceneContext.room) lines.push(`- room: ${sceneContext.room}`);
  if (sceneContext.time_of_day)
    lines.push(`- time_of_day: ${sceneContext.time_of_day}`);

  if (!lines.length) return '';

  return `
HARD_CONTEXT:
${lines.join('\n')}
RULES:
- Never contradict HARD_CONTEXT.
- Do NOT mention location/time every reply. Mention only if user asks or it matters naturally.
`.trimEnd();
}