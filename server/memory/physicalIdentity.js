const MAX_BODY_DESCRIPTION = 1000;
const BOOTSTRAP_USER_MESSAGE_LIMIT = 80;
const BOOTSTRAP_MESSAGE_CHARS = 420;

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

export async function loadPhysicalIdentity(supabase, userId) {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('iris_physical_identity')
      .select('body_description, source, confidence, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.log('[PHYSICAL_IDENTITY_LOAD]', error.message);
      return null;
    }
    return data || null;
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

    const system = `You extract Iris's persistent physical body identity from explicit USER statements only.\n\nRULES:\n- Iris is always an adult; never output a minor, teen-like or childlike identity.\n- Use ONLY the supplied USER messages. There are no assistant messages or generated images in the evidence.\n- Extract enduring body traits only: height, build, body proportions, legs, waist, hips, bust/chest and similarly persistent physical traits.\n- Do NOT include clothes, colors, nails, hair, makeup, pose, scene, sexual acts, temporary styling or photography instructions.\n- A request that clearly repeats an already intended enduring trait may count as evidence, but ignore one-off temporary transformation requests when the wording does not establish Iris's normal body.\n- Merge repeated compatible evidence into one concise natural-language description.\n- Do not invent unspecified traits and do not infer body traits from beauty ideals.\n- If there is not enough explicit USER evidence, return null.\n\nReturn JSON only: {"body_description": string|null, "confidence": number}.`;

    const response = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 300,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: `USER-ONLY EVIDENCE:\n${evidence.map((item, index) => `${index + 1}. ${item}`).join('\n')}` },
      ],
    });
    const parsed = safeJsonExtract(response?.output_text);
    const bodyDescription = cleanText(parsed?.body_description);
    const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence || 0)));
    if (!bodyDescription || confidence < 0.78 || containsMinorLikeDescription(bodyDescription)) return currentPhysicalIdentity;

    const now = new Date().toISOString();
    const { error: upsertError } = await supabase.from('iris_physical_identity').upsert({
      user_id: userId,
      body_description: bodyDescription,
      source: 'bootstrap_user_history',
      confidence,
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (upsertError) {
      console.log('[PHYSICAL_IDENTITY_BOOTSTRAP_UPSERT]', upsertError.message);
      return currentPhysicalIdentity;
    }

    console.log('[PHYSICAL_IDENTITY_BOOTSTRAPPED]', { userId, confidence, descriptionChars: bodyDescription.length });
    return { body_description: bodyDescription, source: 'bootstrap_user_history', confidence, updated_at: now };
  } catch (error) {
    console.log('[PHYSICAL_IDENTITY_BOOTSTRAP]', error?.message || error);
    return currentPhysicalIdentity;
  }
}

export async function persistPhysicalIdentitySignal({ supabase, userId, intent, currentPhysicalIdentity = null }) {
  if (!supabase || !userId || !intent) return currentPhysicalIdentity;
  if (intent.physical_identity_change !== 'explicit') return currentPhysicalIdentity;
  const confidence = Math.max(0, Math.min(1, Number(intent.physical_identity_confidence || 0)));
  if (confidence < 0.75) return currentPhysicalIdentity;

  const bodyDescription = cleanText(intent?.physical_identity_patch?.body_description);
  if (!bodyDescription || containsMinorLikeDescription(bodyDescription)) return currentPhysicalIdentity;

  const now = new Date().toISOString();
  const { error } = await supabase.from('iris_physical_identity').upsert({
    user_id: userId,
    body_description: bodyDescription,
    source: 'explicit_user',
    confidence,
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) {
    console.log('[PHYSICAL_IDENTITY_UPSERT]', error.message);
    return currentPhysicalIdentity;
  }
  return { body_description: bodyDescription, source: 'explicit_user', confidence, updated_at: now };
}

export function formatPhysicalIdentityBlock(identity) {
  const body = cleanText(identity?.body_description);
  const lines = [
    'IRIS_PHYSICAL_IDENTITY (persistent, user-defined):',
    '- Iris is always an adult. Never depict or describe Iris as a minor or minor-like.',
  ];
  if (body) lines.push(`- body_description: ${body}`);
  else lines.push('- body_description: not yet explicitly established by the user; do not invent fixed body traits.');
  lines.push(
    'RULES:',
    '- Do not invent fixed body traits that the user has not explicitly established.',
    '- Specific enduring body traits come from explicit user-established identity memory, not from generated images or model invention.',
    '- Preserve established body traits across chat and generated photos until the user explicitly changes them.',
    '- Face reference images define facial identity; they do not define or override body proportions.',
    '- Do not recite this block unless the user directly asks about Iris\'s appearance.',
  );
  return lines.join('\n');
}

export function physicalIdentityHint(identity) {
  const body = cleanText(identity?.body_description);
  return body ? { body_description: body } : {};
}
