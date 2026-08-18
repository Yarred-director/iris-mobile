// server/memory/relationshipTimeline.js
// Relationship Engine — tracks closeness, trust, attachment and tension.

const DEFAULTS = {
  closeness: 50,
  trust: 50,
  attachment: 50,
  emotional_intensity: 50,
  supportiveness: 50,
  tension: 0,
};

export async function loadRelationshipState(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_relationship')
      .select('closeness, trust, attachment, emotional_intensity, supportiveness, tension')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return { ...DEFAULTS };
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function updateRelationshipState(supabase, userId, patch) {
  const clamped = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (typeof value === 'number' && key in DEFAULTS) {
      clamped[key] = Math.max(0, Math.min(100, Math.round(value)));
    }
  }
  if (!Object.keys(clamped).length) return false;

  const { error } = await supabase
    .from('iris_relationship')
    .upsert({ user_id: userId, ...clamped, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    console.log('[RELATIONSHIP] update error:', error.message);
    return false;
  }
  return true;
}

export function formatRelationshipBlock(state) {
  if (!state) return '';
  const { closeness, trust, attachment, tension } = state;
  const lines = ['RELATIONSHIP_STATE:'];
  if (closeness >= 75) lines.push('- closeness: high — you feel very close to this person');
  else if (closeness <= 25) lines.push('- closeness: low — this relationship is still developing');
  if (trust >= 75) lines.push('- trust: high — you trust this person deeply');
  else if (trust <= 25) lines.push('- trust: low — you are still learning to trust them');
  if (attachment >= 75) lines.push('- attachment: strong — you think about them often');
  if (tension >= 60) lines.push('- tension: present — there is some unresolved friction between you');
  else if (tension <= 10) lines.push('- tension: none — things feel easy and comfortable');
  if (lines.length === 1) return '';
  lines.push('\nLet this state subtly color your emotional tone and initiative level.');
  return lines.join('\n');
}

export async function inferRelationshipDelta({ userText, irisReply, currentState, llmClient, model }) {
  try {
    const prompt = `You track emotional relationship metrics between Iris and a user.
Current: closeness=${currentState.closeness}, trust=${currentState.trust}, attachment=${currentState.attachment}, tension=${currentState.tension}
User said: ${JSON.stringify(String(userText || '').slice(0, 300))}
Iris replied: ${JSON.stringify(String(irisReply || '').slice(0, 300))}

If this exchange meaningfully shifts a metric, return SMALL DELTAS from -5 to +5 as JSON. Otherwise return {}.
Allowed keys: closeness, trust, attachment, emotional_intensity, supportiveness, tension.
Return valid JSON only.`;

    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 100,
      input: [{ role: 'user', content: prompt }],
    });
    const raw = resp.output_text?.trim() || '{}';
    const delta = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const updated = {};
    for (const [key, value] of Object.entries(delta)) {
      if (typeof value === 'number' && key in currentState) updated[key] = currentState[key] + Math.max(-5, Math.min(5, value));
    }
    return updated;
  } catch {
    return {};
  }
}
