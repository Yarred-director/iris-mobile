const MAX_BODY_DESCRIPTION = 1000;

function cleanText(value, max = MAX_BODY_DESCRIPTION) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function containsMinorLikeDescription(value) {
  const text = String(value || '').toLowerCase();
  return /\b(?:minor|underage|child|kid|preteen|young teen|little girl|malolet|dieťa|dieta|dievčatko|dievcatko|školáčka|skolacka)\b/u.test(text);
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
