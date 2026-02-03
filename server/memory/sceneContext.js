// server/memory/sceneContext.js

const ALLOWED_PATCH_KEYS = new Set([
  'interaction_mode',
  'last_subject',
  'last_engine',
  'last_engine_reply',
  'place',
  'room',
  'time_of_day',
  'location_city',
  'location_country',
  'bridge_buffer'
]);

// ✅ For now: we run a single stable scene context.
// Later you can add more keys here (e.g. 'dubai_trip') and allow them intentionally.
const ALLOWED_SCENE_KEYS = new Set(['global']);

function normalizeSceneKey(sceneKey) {
  const key = (sceneKey || 'global').toString().trim().toLowerCase();

  // Hard clamp to prevent scene_key pollution from user text.
  if (ALLOWED_SCENE_KEYS.has(key)) return key;

  return 'global';
}

function sanitizePatch(patch = {}) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_PATCH_KEYS.has(k)) continue;

    // basic sanitize for strings (avoid huge blobs)
    if (typeof v === 'string') out[k] = v.trim().slice(0, 200);
    else out[k] = v;
  }
  return out;
}

function resolve(ctx = {}) {
  return {
    ...ctx,
    _resolved: {
      city: ctx.location_city ?? ctx.city ?? null,
      country: ctx.location_country ?? ctx.country ?? null
    }
  };
}

export async function getSceneContext(supabase, sceneKey = 'global') {
  const key = normalizeSceneKey(sceneKey);
  const { data } = await supabase.rpc('get_scene_context', { p_scene_key: key });
  if (!data?.[0]) return null;
  return resolve(data[0]);
}

export async function patchSceneContext(supabase, sceneKey = 'global', patch = {}) {
  const key = normalizeSceneKey(sceneKey);
  const safe = sanitizePatch(patch);
  if (!Object.keys(safe).length) return;

  await supabase.rpc('patch_scene_context', {
    p_scene_key: key,
    p_patch: safe
  });
}

export function formatSceneContextBlock(sceneContext) {
  if (!sceneContext) return '';

  const r = sceneContext._resolved || {};

  return `

SCENE CONTEXT:
city=${r.city || '?'}
place=${sceneContext.place || '?'}
room=${sceneContext.room || '?'}
time_of_day=${sceneContext.time_of_day || '?'}
last_subject=${sceneContext.last_subject || '?'}
`.trimEnd();
}

export function formatHardSceneContextBlock(sceneContext) {
  if (!sceneContext) return '';

  const r = sceneContext._resolved || {};
  const lines = [];

  if (r.city) lines.push(`- city: ${r.city}`);
  if (sceneContext.place) lines.push(`- place: ${sceneContext.place}`);
  if (sceneContext.room) lines.push(`- room: ${sceneContext.room}`);
  if (sceneContext.time_of_day) lines.push(`- time_of_day: ${sceneContext.time_of_day}`);

  if (!lines.length) return '';

  return `

HARD CONTEXT:
${lines.join('\n')}

RULE:
Never contradict HARD CONTEXT.
If missing, ask user.
`.trimEnd();
}
