const MAX_BODY_DESCRIPTION = 1400;
const MAX_TRAIT_VALUE = 320;
const BOOTSTRAP_USER_MESSAGE_LIMIT = 80;
const BOOTSTRAP_MESSAGE_CHARS = 420;

export const PHYSICAL_TRAIT_KEYS = Object.freeze([
  'height',
  'build',
  'legs',
  'waist',
  'hips',
  'bust',
  'skin',
  'freckles',
  'other',
]);

function cleanText(value, max = MAX_BODY_DESCRIPTION) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function containsMinorLikeDescription(value) {
  const text = String(value || '').toLowerCase();
  return /\b(?:minor|underage|child|kid|preteen|young teen|little girl|malolet|dieťa|dieta|dievčatko|dievcatko|školáčka|skolacka)\b/u.test(text);
}

function safeJsonExtract(text) {
  const raw = String(text || '').trim().replace(/```json|```/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); }
  catch { return null; }
}

export function normalizePhysicalTraits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of PHYSICAL_TRAIT_KEYS) {
    const cleaned = cleanText(value[key], MAX_TRAIT_VALUE);
    if (!cleaned || containsMinorLikeDescription(cleaned)) continue;
    result[key] = cleaned;
  }
  return result;
}

export function mergePhysicalTraits(current, patch) {
  return {
    ...normalizePhysicalTraits(current),
    ...normalizePhysicalTraits(patch),
  };
}

export function composePhysicalBodyDescription(traits, fallback = null) {
  const normalized = normalizePhysicalTraits(traits);
  const labels = {
    height: 'Height',
    build: 'Build',
    legs: 'Legs',
    waist: 'Waist',
    hips: 'Hips',
    bust: 'Bust',
    skin: 'Skin',
    freckles: 'Freckles',
    other: 'Other enduring traits',
  };
  const parts = PHYSICAL_TRAIT_KEYS
    .filter((key) => normalized[key])
    .map((key) => `${labels[key]}: ${normalized[key]}.`);
  return cleanText(parts.join(' ')) || cleanText(fallback);
}

function hydrateIdentity(row) {
  if (!row) return null;
  const traits = normalizePhysicalTraits(row.traits);
  return { ...row, traits, ...traits };
}

async function resolveStructuredTraits({ currentIdentity, proposedBody, latestUserText, llmClient, model }) {
  const currentTraits = normalizePhysicalTraits(currentIdentity?.traits);
  if (!llmClient || !model) return currentTraits;
  try {
    const response = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 500,
      input: [
        {
          role: 'system',
          content: `You maintain Iris's persistent structured adult body identity. This is data normalization, not conversation.\n\nRULES:\n- Iris is always a clearly adult woman. Never create minor-like traits.\n- LATEST_USER_TEXT is the only authority for changing an existing trait.\n- CURRENT_IDENTITY is authoritative for established traits that the latest user message does not change.\n- PROPOSED_MERGED_DESCRIPTION is an upstream extraction from the user's explicit statements; use it as supporting evidence, but never drop an existing trait merely because prose omitted it.\n- Return the FULL resolved structured trait state after this update.\n- Never infer clothing, hair, makeup, pose, activity, sexual acts, nationality, face, or beauty ideals as body traits.\n- Do not invent unspecified body traits.\n- Use only these keys: height, build, legs, waist, hips, bust, skin, freckles, other.\n- Each value is a concise natural-language string or null.\n\nReturn JSON only: {"traits":{"height":string|null,"build":string|null,"legs":string|null,"waist":string|null,"hips":string|null,"bust":string|null,"skin":string|null,"freckles":string|null,"other":string|null}}.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            CURRENT_IDENTITY: {
              body_description: cleanText(currentIdentity?.body_description),
              traits: currentTraits,
            },
            LATEST_USER_TEXT: cleanText(latestUserText, 1200),
            PROPOSED_MERGED_DESCRIPTION: cleanText(proposedBody),
          }),
        },
      ],
    });
    const parsed = safeJsonExtract(response?.output_text);
    const resolved = normalizePhysicalTraits(parsed?.traits);
    return Object.keys(resolved).length ? resolved : currentTraits;
  } catch (error) {
    console.log('[PHYSICAL_IDENTITY_STRUCTURED_MERGE]', error?.code || error?.message || error);
    return currentTraits;
  }
}

export async function loadPhysicalIdentity(supabase, userId) {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('iris_physical_identity')
      .select('body_description, traits, source, confidence, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.log('[PHYSICAL_IDENTITY_LOAD]', error.message);
      return null;
    }
    return hydrateIdentity(data);
  } catch (error) {
    console.log('[PHYSICAL_IDENTITY_LOAD]', error?.message);
    return null;
  }
}

export async function bootstrapPhysicalIdentityFromUserHistory({
  supabase,
  userId,
  currentPhysicalIdentity = null,
  latestUserText = '',
  llmClient,
  model,
}) {
  if (!supabase || !userId || !llmClient || !model) return currentPhysicalIdentity;
  if (cleanText(currentPhysicalIdentity?.body_description)) return currentPhysicalIdentity;

  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('content, created_at')
      .eq('user_id', userId)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(BOOTSTRAP_USER_MESSAGE_LIMIT);
    if (error) {
      console.log('[PHYSICAL_IDENTITY_BOOTSTRAP_HISTORY]', error.message);
      return currentPhysicalIdentity;
    }

    const evidence = [];
    const latest = cleanText(latestUserText, BOOTSTRAP_MESSAGE_CHARS);
    if (latest) evidence.push(latest);
    for (const row of (data || []).reverse()) {
      const text = cleanText(row?.content, BOOTSTRAP_MESSAGE_CHARS);
      if (text && !evidence.includes(text)) evidence.push(text);
    }
    if (!evidence.length) return currentPhysicalIdentity;

    const system = `You extract Iris's persistent physical body identity from explicit USER statements only.\n\nRULES:\n- Iris is always an adult; never output a minor, teen-like or childlike identity.\n- Use ONLY the supplied USER messages. There are no assistant messages or generated images in the evidence.\n- Extract enduring body traits only: height, build, legs, waist, hips, bust/chest, skin/freckles when explicitly stated, and similarly persistent physical traits.\n- Do NOT include clothes, colors, nails, hair, makeup, pose, scene, sexual acts, temporary styling or photography instructions.\n- A request that clearly repeats an already intended enduring trait may count as evidence, but ignore one-off temporary transformation requests when the wording does not establish Iris's normal body.\n- Merge repeated compatible evidence into one concise natural-language description.\n- Do not invent unspecified traits and do not infer body traits from beauty ideals.\n- If there is not enough explicit USER evidence, return null.\n- traits must contain only explicitly supported enduring values using keys height, build, legs, waist, hips, bust, skin, freckles, other.\n\nReturn JSON only: {"body_description":string|null,"traits":{"height":string|null,"build":string|null,"legs":string|null,"waist":string|null,"hips":string|null,"bust":string|null,"skin":string|null,"freckles":string|null,"other":string|null},"confidence":number}.`;

    const response = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 500,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: `USER-ONLY EVIDENCE:\n${evidence.map((item, index) => `${index + 1}. ${item}`).join('\n')}` },
      ],
    });
    const parsed = safeJsonExtract(response?.output_text);
    const traits = normalizePhysicalTraits(parsed?.traits);
    const bodyDescription = composePhysicalBodyDescription(traits, parsed?.body_description);
    const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence || 0)));
    if (!bodyDescription || confidence < 0.78 || containsMinorLikeDescription(bodyDescription)) return currentPhysicalIdentity;

    const now = new Date().toISOString();
    const { error: upsertError } = await supabase.from('iris_physical_identity').upsert({
      user_id: userId,
      body_description: bodyDescription,
      traits,
      source: 'bootstrap_user_history',
      confidence,
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (upsertError) {
      console.log('[PHYSICAL_IDENTITY_BOOTSTRAP_UPSERT]', upsertError.message);
      return currentPhysicalIdentity;
    }

    console.log('[PHYSICAL_IDENTITY_BOOTSTRAPPED]', { userId, confidence, descriptionChars: bodyDescription.length, traitCount: Object.keys(traits).length });
    return hydrateIdentity({ body_description: bodyDescription, traits, source: 'bootstrap_user_history', confidence, updated_at: now });
  } catch (error) {
    console.log('[PHYSICAL_IDENTITY_BOOTSTRAP]', error?.message || error);
    return currentPhysicalIdentity;
  }
}

export async function persistPhysicalIdentitySignal({
  supabase,
  userId,
  intent,
  currentPhysicalIdentity = null,
  latestUserText = '',
  llmClient = null,
  model = null,
}) {
  if (!supabase || !userId || !intent) return currentPhysicalIdentity;
  if (intent.physical_identity_change !== 'explicit') return currentPhysicalIdentity;
  const confidence = Math.max(0, Math.min(1, Number(intent.physical_identity_confidence || 0)));
  if (confidence < 0.75) return currentPhysicalIdentity;

  const proposedBody = cleanText(intent?.physical_identity_patch?.body_description);
  if (!proposedBody || containsMinorLikeDescription(proposedBody)) return currentPhysicalIdentity;

  const currentTraits = normalizePhysicalTraits(currentPhysicalIdentity?.traits);
  const structuredTraits = await resolveStructuredTraits({
    currentIdentity: currentPhysicalIdentity,
    proposedBody,
    latestUserText,
    llmClient,
    model,
  });
  const traits = Object.keys(structuredTraits).length ? structuredTraits : currentTraits;
  const bodyDescription = composePhysicalBodyDescription(traits, proposedBody);
  if (!bodyDescription || containsMinorLikeDescription(bodyDescription)) return currentPhysicalIdentity;

  const now = new Date().toISOString();
  const { error } = await supabase.from('iris_physical_identity').upsert({
    user_id: userId,
    body_description: bodyDescription,
    traits,
    source: 'explicit_user',
    confidence,
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) {
    console.log('[PHYSICAL_IDENTITY_UPSERT]', error.message);
    return currentPhysicalIdentity;
  }
  return hydrateIdentity({ body_description: bodyDescription, traits, source: 'explicit_user', confidence, updated_at: now });
}

export function formatPhysicalIdentityBlock(identity) {
  const body = cleanText(identity?.body_description);
  const traits = normalizePhysicalTraits(identity?.traits || identity);
  const lines = [
    'IRIS_PHYSICAL_IDENTITY (persistent, user-defined):',
    '- Iris is always an adult. Never depict or describe Iris as a minor or minor-like.',
  ];
  if (body) lines.push(`- body_description: ${body}`);
  else lines.push('- body_description: not yet explicitly established by the user; do not invent fixed body traits.');
  if (Object.keys(traits).length) lines.push(`- structured_traits: ${JSON.stringify(traits)}`);
  lines.push(
    'RULES:',
    '- Do not invent fixed body traits that the user has not explicitly established.',
    '- Specific enduring body traits come from explicit user-established identity memory, not from generated images or model invention.',
    '- Preserve established body traits across chat and generated photos until the user explicitly changes them.',
    '- Treat structured_traits as field-level canonical anchors. A change to one body field must not erase unrelated established fields.',
    '- Face reference images define facial identity; they do not define or override body proportions.',
    '- Do not recite this block unless the user directly asks about Iris\'s appearance.',
  );
  return lines.join('\n');
}

export function physicalIdentityHint(identity) {
  const body = cleanText(identity?.body_description);
  const traits = normalizePhysicalTraits(identity?.traits || identity);
  return body ? { body_description: body, ...traits } : { ...traits };
}
