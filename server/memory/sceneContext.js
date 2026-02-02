// server/memory/sceneContext.js
// AUTH-BASED (magic link) — uses auth.uid() inside RPC

const ALLOWED_PATCH_KEYS = new Set([
  // existing SCC fields your backend already uses
  'interaction_mode',
  'last_subject',
  'last_engine',
  'last_engine_reply',
  'place',
  'country',
  'city',
  'room',

  // NEW canonical fields (after your SQL alter)
  'location_country',
  'location_city',
  'time_of_day'
]);

function sanitizePatch(patch = {}) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALLOWED_PATCH_KEYS.has(k)) continue;
    // allow null to explicitly clear a value if your RPC supports it
    out[k] = v;
  }
  return out;
}

function getCtx(ctx) {
  const c = ctx || {};
  // prefer new canonical fields, fallback to old ones
  const locationCountry = c.location_country ?? c.country ?? null;
  const locationCity = c.location_city ?? c.city ?? null;

  return {
    ...c,
    _resolved: {
      location_country: locationCountry,
      location_city: locationCity
    }
  };
}

export async function getSceneContext(supabase, sceneKey = 'global') {
  const { data, error } = await supabase.rpc('get_scene_context', {
    p_scene_key: sceneKey
  });

  if (error) {
    console.error('[sceneContext] get_scene_context error', error);
    return null;
  }

  const row = data?.[0] ?? null;
  return row ? getCtx(row) : null;
}

export async function patchSceneContext(supabase, sceneKey = 'global', patch = {}) {
  const safe = sanitizePatch(patch);

  // Avoid noisy RPC calls when patch is empty
  if (!safe || Object.keys(safe).length === 0) return;

  const { error } = await supabase.rpc('patch_scene_context', {
    p_scene_key: sceneKey,
    p_patch: safe
  });

  if (error) {
    console.error('[sceneContext] patch_scene_context error', error);
  }
}

// This is the “working state” debug block (fine to keep)
export function formatSceneContextBlock(sceneContext) {
  const ctx = getCtx(sceneContext || {});
  const r = ctx._resolved || {};

  const loc = [
    r.location_country ? `country=${r.location_country}` : 'country=?',
    r.location_city ? `city=${r.location_city}` : 'city=?',
    ctx.place ? `place=${ctx.place}` : 'place=?',
    ctx.room ? `room=${ctx.room}` : 'room=?'
  ].join(', ');

  return `

SCENE CONTEXT (working state):
- location: ${loc}
- time_of_day: ${ctx.time_of_day || '?'}
- interaction_mode: ${ctx.interaction_mode || 'idle'}
- last_subject: ${ctx.last_subject || '?'}
- last_engine: ${ctx.last_engine || '?'}
`.trimEnd();
}

// This is the HARD FACTS block that the model must not invent
export function formatHardSceneContextBlock(sceneContext) {
  const ctx = getCtx(sceneContext || {});
  const r = ctx._resolved || {};

  const lines = [];

  if (r.location_country) lines.push(`- location_country: ${r.location_country}`);
  if (r.location_city) lines.push(`- location_city: ${r.location_city}`);
  if (ctx.room) lines.push(`- room: ${ctx.room}`);
  if (ctx.time_of_day) lines.push(`- time_of_day: ${ctx.time_of_day}`);

  if (lines.length === 0) return '';

  return `

HARD SCENE CONTEXT (do not invent; do not override):
${lines.join('\n')}

STRICT FACT GUARD:
- You may only state location_country/location_city/room/time_of_day if explicitly present above.
- If missing, say you don't know and ask the user to provide it.
- Do not guess.
`.trimEnd();
}
