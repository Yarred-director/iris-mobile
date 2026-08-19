const APPEARANCE_FIELDS = new Set([
  'outfit',
  'footwear',
  'nails',
  'hair',
  'makeup',
  'accessories',
  'other_details',
]);

const PREFERENCE_CATEGORIES = new Set([
  'preferences',
  'visual_preferences',
  'appearance',
  'dislikes',
]);

function cleanString(value, max = 500) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

function normalizePreferenceKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  const slug = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  return slug ? `iris_visual.${slug}` : null;
}

export function sanitizeAppearancePatch(patch) {
  const clean = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clean;
  for (const [key, value] of Object.entries(patch)) {
    if (!APPEARANCE_FIELDS.has(key)) continue;
    const normalized = cleanString(value);
    if (normalized) clean[key] = normalized;
  }
  return clean;
}

export function sanitizeClearFields(fields) {
  if (!Array.isArray(fields)) return [];
  return [...new Set(fields.filter((field) => APPEARANCE_FIELDS.has(field)))];
}

export function mergeVisualState(currentState = {}, patch = {}, clearFields = []) {
  const next = {};
  if (currentState && typeof currentState === 'object' && !Array.isArray(currentState)) {
    for (const [key, value] of Object.entries(currentState)) {
      if (!APPEARANCE_FIELDS.has(key)) continue;
      const normalized = cleanString(value);
      if (normalized) next[key] = normalized;
    }
  }
  for (const key of sanitizeClearFields(clearFields)) delete next[key];
  Object.assign(next, sanitizeAppearancePatch(patch));
  return next;
}

export function selectPotentialVisualPreferences(profileFacts = [], limit = 24) {
  return (Array.isArray(profileFacts) ? profileFacts : [])
    .filter((fact) => PREFERENCE_CATEGORIES.has(String(fact?.category || '').toLowerCase()))
    .filter((fact) => fact?.fact_value != null)
    .slice(0, Math.max(1, Math.min(Number(limit) || 24, 40)))
    .map((fact) => ({
      category: String(fact.category || 'preferences'),
      fact_key: String(fact.fact_key || '').slice(0, 120),
      fact_value: String(fact.fact_value || '').slice(0, 500),
      confidence: Number(fact.confidence || 0),
    }));
}

export async function loadVisualState(supabase, userId, sceneKey = 'global') {
  if (!supabase || !userId) return { state: {}, source: 'none', confidence: 0, updated_at: null };
  try {
    const { data, error } = await supabase
      .from('iris_visual_state')
      .select('state, source, confidence, updated_at')
      .eq('user_id', userId)
      .eq('scene_key', sceneKey)
      .maybeSingle();
    if (error) {
      console.log('[VISUAL_STATE_LOAD_ERROR]', error.message);
      return { state: {}, source: 'none', confidence: 0, updated_at: null };
    }
    return {
      state: mergeVisualState(data?.state || {}),
      source: cleanString(data?.source, 80) || 'none',
      confidence: Math.max(0, Math.min(1, Number(data?.confidence || 0))),
      updated_at: data?.updated_at || null,
    };
  } catch (error) {
    console.log('[VISUAL_STATE_LOAD_ERROR]', error?.message);
    return { state: {}, source: 'none', confidence: 0, updated_at: null };
  }
}

async function persistVisualPreference(supabase, userId, preference) {
  const confidence = Math.max(0, Math.min(1, Number(preference?.confidence || 0)));
  if (confidence < 0.75) return false;
  const factKey = normalizePreferenceKey(preference?.fact_key);
  const factValue = cleanString(preference?.fact_value, 500);
  if (!factKey || !factValue) return false;

  const { error } = await supabase.from('user_profile').upsert({
    user_id: userId,
    category: 'visual_preferences',
    fact_key: factKey,
    fact_value: factValue,
    confidence,
    source: 'auto',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,fact_key' });
  if (error) {
    console.log('[VISUAL_PREF_UPSERT_ERROR]', factKey, error.message);
    return false;
  }
  return true;
}

export async function persistVisualSignals({ supabase, userId, sceneKey = 'global', intent, currentVisualState }) {
  if (!supabase || !userId || !intent) return currentVisualState || { state: {}, source: 'none', confidence: 0, updated_at: null };

  const preferenceJobs = (Array.isArray(intent.visual_preference_updates) ? intent.visual_preference_updates : [])
    .slice(0, 4)
    .map((preference) => persistVisualPreference(supabase, userId, preference));
  if (preferenceJobs.length) await Promise.allSettled(preferenceJobs);

  const patch = sanitizeAppearancePatch(intent.appearance_patch);
  const clearFields = sanitizeClearFields(intent.clear_appearance_fields);
  const visualChange = ['explicit', 'contextual'].includes(intent.visual_change) ? intent.visual_change : 'none';
  const hasStateChange = Object.keys(patch).length > 0 || clearFields.length > 0;
  if (!hasStateChange) return currentVisualState || { state: {}, source: 'none', confidence: 0, updated_at: null };

  const previous = currentVisualState?.state || {};
  const nextState = mergeVisualState(previous, patch, clearFields);
  const confidence = Math.max(0.5, Math.min(1, Number(intent.appearance_confidence || 0.75)));
  const now = new Date().toISOString();
  const source = visualChange === 'explicit' ? 'explicit_user' : 'contextual_inference';

  const { error } = await supabase.from('iris_visual_state').upsert({
    user_id: userId,
    scene_key: sceneKey,
    state: nextState,
    source,
    confidence,
    updated_at: now,
  }, { onConflict: 'user_id,scene_key' });
  if (error) {
    console.log('[VISUAL_STATE_UPSERT_ERROR]', error.message);
    return currentVisualState || { state: previous, source: 'none', confidence: 0, updated_at: null };
  }

  return { state: nextState, source, confidence, updated_at: now };
}

export function formatVisualStateBlock(visualState) {
  const state = visualState?.state || {};
  const lines = Object.entries(state)
    .filter(([key, value]) => APPEARANCE_FIELDS.has(key) && cleanString(value))
    .map(([key, value]) => `- ${key}: ${cleanString(value)}`);
  if (!lines.length) return '';

  return `VISUAL_STATE_INTERNAL:\n${lines.join('\n')}\nRULES:\n- This is Iris's current visual continuity state. Keep it consistent until an explicit user instruction or a strongly justified contextual transition changes it.\n- Do not silently replace the outfit or other visible details merely for variety.\n- Do not recite this block to the user. Mention appearance only when it is natural in the conversation.\n- User visual preferences in USER_PROFILE are soft personalization signals, not permanent outfit requirements.\n- When the server has contextually changed the appearance, Iris may naturally acknowledge the new look or ask for feedback, but should not explain the internal memory logic.`;
}

export function visualStateHint(visualState) {
  const state = mergeVisualState(visualState?.state || {});
  return Object.keys(state).length ? state : null;
}
