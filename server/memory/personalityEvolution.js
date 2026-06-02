// server/memory/personalityEvolution.js
// Iris personality evolution — she gradually adapts to each user

export async function loadPersonalityEvolution(supabase, userId) {
  try {
    const { data } = await supabase
      .from('iris_personality_evolution')
      .select('communication_style, evolved_traits, inside_references, evolved_interests')
      .eq('user_id', userId)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

export async function evolvePersonality({ supabase, userId, userText, irisReply, currentEvolution, userProfile, llmClient, model }) {
  try {
    const profileSummary = (userProfile || [])
      .slice(0, 5)
      .map(p => `${p.fact_key}: ${p.fact_value}`)
      .join(', ') || 'unknown';

    const current = {
      communication_style: currentEvolution?.communication_style || 'neutral',
      evolved_traits: currentEvolution?.evolved_traits || [],
      inside_references: currentEvolution?.inside_references || [],
      evolved_interests: currentEvolution?.evolved_interests || [],
    };

    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 200,
      temperature: 0.4,
      messages: [{
        role: 'user',
        content: `You track how Iris (AI companion) gradually evolves her personality for a specific user.

User profile: ${profileSummary}
Current evolution: ${JSON.stringify(current)}

User said: "${userText.slice(0, 200)}"
Iris replied: "${irisReply.slice(0, 200)}"

Did this exchange reveal anything new about how Iris should communicate with this user?
Only update if there is a meaningful signal. Small incremental changes only.

Return JSON (only changed fields, or {} if no change):
{
  "communication_style": "brief description of how Iris naturally speaks with this user",
  "evolved_traits": ["trait1", "trait2"],
  "inside_references": ["shared joke or reference"],
  "evolved_interests": ["topic Iris has grown to associate with this user"]
}`,
      }],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || '{}';
    const patch = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!Object.keys(patch).length) return;

    await supabase
      .from('iris_personality_evolution')
      .upsert({
        user_id: userId,
        ...patch,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

  } catch (e) {
    console.log('[PERSONALITY_EVOLUTION] Error:', e?.message);
  }
}

export function formatPersonalityEvolutionBlock(evolution) {
  if (!evolution) return '';

  const lines = ['IRIS_EVOLVED_SELF (who she has become with this user):'];

  if (evolution.communication_style) {
    lines.push(`- style: ${evolution.communication_style}`);
  }

  const traits = evolution.evolved_traits;
  if (Array.isArray(traits) && traits.length) {
    lines.push(`- traits: ${traits.slice(0, 4).join(', ')}`);
  }

  const refs = evolution.inside_references;
  if (Array.isArray(refs) && refs.length) {
    lines.push(`- shared references: ${refs.slice(0, 3).join('; ')}`);
  }

  const interests = evolution.evolved_interests;
  if (Array.isArray(interests) && interests.length) {
    lines.push(`- evolved interests: ${interests.slice(0, 4).join(', ')}`);
  }

  if (lines.length === 1) return '';

  lines.push('\nThis is who you have grown to be with this specific person. Honor it naturally.');
  return lines.join('\n');
}