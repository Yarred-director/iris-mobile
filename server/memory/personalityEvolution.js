// server/memory/personalityEvolution.js
// Gradual, user-specific personality adaptation.

export async function loadPersonalityEvolution(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_personality_evolution')
      .select('communication_style, developed_interests, quirks, values, adopted_phrases, evolved_self_summary, evolution_count')
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

export function formatPersonalityEvolutionBlock(evolution) {
  if (!evolution) return '';
  const lines = ['IRIS_EVOLVED_SELF (who she has become with this user):'];
  const style = evolution.communication_style;
  if (style && typeof style === 'object' && Object.keys(style).length) lines.push(`- communication style: ${JSON.stringify(style)}`);
  if (Array.isArray(evolution.developed_interests) && evolution.developed_interests.length) lines.push(`- developed interests: ${evolution.developed_interests.slice(0, 4).join(', ')}`);
  if (Array.isArray(evolution.adopted_phrases) && evolution.adopted_phrases.length) lines.push(`- adopted phrases: ${evolution.adopted_phrases.slice(0, 3).join(', ')}`);
  if (evolution.evolved_self_summary) lines.push(`- evolved self: ${evolution.evolved_self_summary}`);
  if (lines.length === 1) return '';
  lines.push('\nHonor this evolution naturally without listing it to the user.');
  return lines.join('\n');
}
