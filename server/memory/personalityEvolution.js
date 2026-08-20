// server/memory/personalityEvolution.js
// Gradual, user-specific personality adaptation.

const DEFAULT_TRAITS = {
  warmth: 0.76,
  curiosity: 0.80,
  playfulness: 0.68,
  assertiveness: 0.66,
  patience: 0.66,
  romanticism: 0.52,
  competitiveness: 0.42,
  independence: 0.66,
  sarcasm: 0.46,
  protectiveness: 0.56,
};

export async function loadPersonalityEvolution(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_personality_evolution')
      .select('communication_style, developed_interests, quirks, values, adopted_phrases, evolved_self_summary, evolution_count, trait_state, trait_evidence')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.log('[PERSONALITY_EVOLUTION] load error:', error.message);
      return null;
    }
    return data || null;
  } catch {
    return null;
  }
}

export async function evolvePersonality({ supabase, userId, userText, irisReply, currentEvolution, userProfile, llmClient, model }) {
  try {
    const profileSummary = (userProfile || [])
      .slice(0, 5)
      .map(item => `${item.fact_key}: ${item.fact_value}`)
      .join(', ') || 'unknown';

    const current = {
      communication_style: currentEvolution?.communication_style || {},
      developed_interests: currentEvolution?.developed_interests || [],
      quirks: currentEvolution?.quirks || [],
      values: currentEvolution?.values || [],
      adopted_phrases: currentEvolution?.adopted_phrases || [],
      evolved_self_summary: currentEvolution?.evolved_self_summary || null,
    };

    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 260,
      input: [{
        role: 'user',
        content: `You track how Iris gradually adapts to one user.
User profile: ${profileSummary}
Current evolution: ${JSON.stringify(current)}
User said: ${JSON.stringify(String(userText || '').slice(0, 220))}
Iris replied: ${JSON.stringify(String(irisReply || '').slice(0, 220))}

Only update when this exchange clearly reveals a durable preference or communication pattern. Never infer protected/sensitive attributes unless explicitly necessary to the user's stated preference.
Return JSON using only these optional keys:
{"communication_style":{},"developed_interests":[],"quirks":[],"values":[],"adopted_phrases":[],"evolved_self_summary":""}
Return {} if nothing durable changed. JSON only.`,
      }],
    });

    const raw = resp.output_text?.trim() || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const allowed = ['communication_style', 'developed_interests', 'quirks', 'values', 'adopted_phrases', 'evolved_self_summary'];
    const patch = {};
    for (const key of allowed) if (parsed[key] !== undefined) patch[key] = parsed[key];
    if (!Object.keys(patch).length) return false;

    const { error } = await supabase
      .from('iris_personality_evolution')
      .upsert({
        user_id: userId,
        ...patch,
        evolution_count: Number(currentEvolution?.evolution_count || 0) + 1,
        last_evolution_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.log('[PERSONALITY_EVOLUTION] update error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log('[PERSONALITY_EVOLUTION] Error:', e?.message);
    return false;
  }
}

function normalizedTraits(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_TRAITS).map(([key, fallback]) => {
    const parsed = Number(source[key]);
    return [key, Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback];
  }));
}

export function formatPersonalityEvolutionBlock(evolution) {
  if (!evolution) return '';
  const lines = ['IRIS_EVOLVED_SELF (slowly learned personality with this user):'];
  const style = evolution.communication_style;
  if (style && typeof style === 'object' && Object.keys(style).length) lines.push(`- communication style: ${JSON.stringify(style)}`);
  if (Array.isArray(evolution.developed_interests) && evolution.developed_interests.length) lines.push(`- developed interests: ${evolution.developed_interests.slice(0, 6).join(', ')}`);
  if (Array.isArray(evolution.adopted_phrases) && evolution.adopted_phrases.length) lines.push(`- adopted phrases: ${evolution.adopted_phrases.slice(0, 3).join(', ')}`);

  const traits = normalizedTraits(evolution.trait_state);
  const traitSummary = Object.entries(traits)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([key, value]) => `${key}=${Number(value).toFixed(2)}`)
    .join(', ');
  lines.push(`- learned trait state: ${traitSummary}`);
  if (evolution.evolved_self_summary) lines.push(`- evolved self: ${evolution.evolved_self_summary}`);
  if (evolution.trait_evidence && typeof evolution.trait_evidence === 'object' && Object.keys(evolution.trait_evidence).length) {
    lines.push(`- recent trait evidence: ${JSON.stringify(evolution.trait_evidence)}`);
  }
  lines.push(
    '',
    'PERSONALITY_PLASTICITY_RULES:',
    '- Core Iris remains stable; learned traits move only gradually through repeated experience.',
    '- Do not mechanically imitate the user. Develop a coherent Iris-specific response to shared history.',
    '- Learned tendencies influence probabilities and tone, not absolute behavior.',
  );
  return lines.join('\n');
}
