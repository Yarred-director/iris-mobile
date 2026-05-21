// server/memory/relationshipTimeline.js
// Relationship Engine — Priority 6 of Iris Governance Engine
// Tracks closeness, trust, attachment, tension and injects into prompt

const DEFAULTS = {
  closeness: 50,
  trust: 50,
  attachment: 50,
  emotional_intensity: 50,
  supportiveness: 50,
  tension: 0,
};

/**
 * Loads relationship state for a user from DB.
 * Returns defaults if no row exists yet.
 */
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

/**
 * Updates relationship metrics.
 * Only updates provided fields, rest stay unchanged.
 *
 * @param {object} supabase
 * @param {string} userId
 * @param {Partial<typeof DEFAULTS>} patch
 */
export async function updateRelationshipState(supabase, userId, patch) {
  try {
    // Clamp all numeric values to 0-100
    const clamped = {};
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number') {
        clamped[k] = Math.max(0, Math.min(100, Math.round(v)));
      }
    }

    await supabase
      .from('iris_relationship')
      .upsert(
        { user_id: userId, ...clamped, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
  } catch (e) {
    console.log('[RELATIONSHIP] update error:', e?.message);
  }
}

/**
 * Formats relationship state as a system prompt block.
 */
export function formatRelationshipBlock(state) {
  if (!state) return '';

  const { closeness, trust, attachment, tension } = state;

  // Only inject meaningful context — avoid noise for midrange values
  const lines = ['RELATIONSHIP_STATE:'];

  if (closeness >= 75)      lines.push('- closeness: high — you feel very close to this person');
  else if (closeness <= 25) lines.push('- closeness: low — this relationship is still developing');

  if (trust >= 75)          lines.push('- trust: high — you trust this person deeply');
  else if (trust <= 25)     lines.push('- trust: low — you are still learning to trust them');

  if (attachment >= 75)     lines.push('- attachment: strong — you think about them often');

  if (tension >= 60)        lines.push('- tension: present — there is some unresolved friction between you');
  else if (tension <= 10)   lines.push('- tension: none — things feel easy and comfortable');

  // If everything is midrange (40-60), skip the block — no noise
  if (lines.length === 1) return '';

  lines.push('\nLet this state subtly color your emotional tone and initiative level.');
  return lines.join('\n');
}

/**
 * LLM-based relationship delta inference.
 * After each reply, detect if the interaction should shift relationship metrics.
 */
export async function inferRelationshipDelta({ userText, irisReply, currentState, llmClient, model }) {
  try {
    const prompt = `You track emotional relationship metrics between Iris (AI companion) and a user.
Current state: closeness=${currentState.closeness}, trust=${currentState.trust}, attachment=${currentState.attachment}, tension=${currentState.tension}

User said: "${userText.slice(0, 300)}"
Iris replied: "${irisReply.slice(0, 300)}"

Did this exchange meaningfully shift any metric? If yes, return deltas as JSON (small values, -5 to +5).
If no significant change, return {}.
Only return valid JSON, nothing else. Example: {"closeness": 2, "tension": -1}`;

    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 60,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || '{}';
    const delta = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Apply deltas to current state
    const updated = {};
    for (const [k, v] of Object.entries(delta)) {
      if (typeof v === 'number' && k in currentState) {
        updated[k] = currentState[k] + v;
      }
    }

    return updated;
  } catch {
    return {};
  }
}
