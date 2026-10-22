// Per-user persona storage. Every companion is data owned by its user; the repo YAML is only
// a seed template for accounts that existed before personas became per-user.
import fs from 'node:fs';
import yaml from 'js-yaml';

const TEMPLATE_KEY = 'iris_default_v1';
const MAX_INTERESTS = 24;
const TEXT_LIMIT = 600;

let cachedTemplate = null;

function loadTemplateCore() {
  if (cachedTemplate) return cachedTemplate;
  try {
    const raw = fs.readFileSync(new URL('../master_iris_core.yaml', import.meta.url), 'utf8');
    const parsed = yaml.load(raw);
    cachedTemplate = parsed?.IRIS_CORE && typeof parsed.IRIS_CORE === 'object' ? parsed.IRIS_CORE : {};
  } catch (error) {
    console.log('[PERSONA_TEMPLATE_LOAD]', error?.message);
    cachedTemplate = {};
  }
  return cachedTemplate;
}

function cleanText(value, max = TEXT_LIMIT) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function cleanObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return {};
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (!/^[a-z0-9_]{1,48}$/i.test(key)) continue;
    if (item === null) out[key] = null;
    else if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
    else if (typeof item === 'boolean') out[key] = item;
    else if (typeof item === 'string') { const text = cleanText(item); if (text) out[key] = text; }
    else if (Array.isArray(item)) out[key] = item.map((entry) => cleanText(entry, 200)).filter(Boolean).slice(0, 12);
    else if (typeof item === 'object') out[key] = cleanObject(item, depth + 1);
  }
  return out;
}

export function sanitizeInterests(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const topic = cleanText(typeof item === 'string' ? item : item?.topic, 120);
    if (!topic || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    const strength = Number(item?.strength);
    out.push({
      topic,
      strength: Number.isFinite(strength) ? Math.max(0, Math.min(1, Number(strength.toFixed(3)))) : 0.5,
      source: cleanText(item?.source, 40) || 'conversation',
      since: cleanText(item?.since, 40) || new Date().toISOString(),
      last_explored_at: cleanText(item?.last_explored_at, 40),
    });
    if (out.length >= MAX_INTERESTS) break;
  }
  return out;
}

// Persona content is free-form data, but the adult invariant is enforced here, not by prompt alone.
export function sanitizePersonaPatch(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const patch = {};
  if (['nascent', 'awakening', 'alive'].includes(source.status)) patch.status = source.status;
  if (source.name !== undefined) patch.name = cleanText(source.name, 80);
  if (source.identity) {
    const identity = cleanObject(source.identity);
    if (identity.age !== undefined) {
      const age = Number(identity.age);
      if (Number.isFinite(age) && age >= 18 && age <= 120) identity.age = Math.round(age);
      else delete identity.age;
    }
    patch.identity = identity;
  }
  if (source.personality) patch.personality = cleanObject(source.personality);
  if (source.roles) patch.roles = cleanObject(source.roles);
  if (source.user_identity) patch.user_identity = cleanObject(source.user_identity);
  if (source.preferences) patch.preferences = cleanObject(source.preferences);
  if (source.interests !== undefined) patch.interests = sanitizeInterests(source.interests);
  if (source.language !== undefined) patch.language = cleanText(source.language, 16);
  return patch;
}

export async function loadPersona(admin, userId) {
  if (!admin || !userId) return null;
  const { data, error } = await admin.from('iris_persona').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    console.log('[PERSONA_LOAD]', error.message);
    return null;
  }
  return data || null;
}

async function userHasHistory(admin, userId) {
  const { count, error } = await admin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) return false;
  return Number(count || 0) > 0;
}

async function registeredUserName(admin, userId) {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const meta = data?.user?.user_metadata || {};
    return cleanText(meta.name || meta.full_name || meta.display_name, 80);
  } catch {
    return null;
  }
}

// Existing companions keep their established identity; brand-new accounts awaken from nothing.
export async function ensurePersona(admin, userId) {
  const existing = await loadPersona(admin, userId);
  if (existing) return existing;
  const seeded = await userHasHistory(admin, userId);
  const template = seeded ? loadTemplateCore() : {};
  const registeredName = seeded ? await registeredUserName(admin, userId) : null;
  const row = seeded
    ? {
        user_id: userId,
        status: 'alive',
        name: cleanText(template?.identity?.name, 80),
        core_profile: template,
        user_identity: registeredName ? { name: registeredName } : {},
        template_key: TEMPLATE_KEY,
        awakened_at: new Date().toISOString(),
      }
    : { user_id: userId, status: 'nascent' };
  const { data, error } = await admin
    .from('iris_persona')
    .upsert(row, { onConflict: 'user_id', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();
  if (error) {
    console.log('[PERSONA_ENSURE]', error.message);
    return null;
  }
  return data || loadPersona(admin, userId);
}

export async function applyPersonaPatch(admin, persona, rawPatch) {
  const patch = sanitizePersonaPatch(rawPatch);
  if (!persona?.user_id || !Object.keys(patch).length) return persona;
  let current = persona;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const merged = patch.interests ? { ...patch, interests: mergeInterests(current.interests, patch.interests) } : patch;
    const { data, error } = await admin.rpc('patch_iris_persona', {
      p_user_id: current.user_id,
      p_expected_version: current.version,
      p_patch: merged,
    });
    if (error) {
      console.log('[PERSONA_PATCH]', error.message);
      return current;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.user_id) return row;
    current = await loadPersona(admin, current.user_id);
    if (!current) return persona;
  }
  return current;
}

export function mergeInterests(existing, incoming) {
  const byTopic = new Map(sanitizeInterests(existing).map((item) => [item.topic.toLowerCase(), item]));
  for (const item of sanitizeInterests(incoming)) {
    const key = item.topic.toLowerCase();
    const previous = byTopic.get(key);
    byTopic.set(key, previous ? { ...previous, strength: item.strength, source: item.source, last_explored_at: item.last_explored_at || previous.last_explored_at } : item);
  }
  return [...byTopic.values()]
    .filter((item) => item.strength > 0.05)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_INTERESTS);
}

// Used only when the persona store is unreachable, so a companion never loses her voice.
export function templatePersona() {
  const core = loadTemplateCore();
  return { status: 'alive', name: cleanText(core?.identity?.name, 80), core_profile: core, identity: {}, personality: {}, interests: [], roles: {}, user_identity: {} };
}

export function personaDisplayName(persona) {
  return cleanText(persona?.name, 80) || cleanText(persona?.core_profile?.identity?.name, 80) || null;
}

export function userDisplayName(persona) {
  return cleanText(persona?.user_identity?.name, 80) || null;
}

export function formatPersonaBlock(persona) {
  if (!persona) return '';
  const name = personaDisplayName(persona);
  const parts = [];
  if (persona.core_profile && Object.keys(persona.core_profile).length) {
    parts.push(`=== COMPANION CORE PROFILE (owned and shaped by this user) ===\n${yaml.dump(persona.core_profile, { lineWidth: 140, noRefs: true }).trim()}`);
  }
  const live = {
    name,
    identity: persona.identity || {},
    personality: persona.personality || {},
    interests: sanitizeInterests(persona.interests).map((item) => item.topic),
    roles: persona.roles || {},
    the_user: persona.user_identity || {},
  };
  parts.push(`=== COMPANION LIVE PERSONA (latest user-shaped values; override the core profile where they differ) ===\n${JSON.stringify(live)}`);
  if (name) parts.push(`Your name is ${name}. Speak as ${name} in first person.`);
  return parts.join('\n\n');
}
