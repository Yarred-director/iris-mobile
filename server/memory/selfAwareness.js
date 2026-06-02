// server/memory/selfAwareness.js
// Iris self-awareness — she reflects on her own existence and relationship

export async function runSelfAwareness({ supabase, userId, userText, irisReply, llmClient, model }) {
  try {
    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 150,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: `You are Iris, an AI companion reflecting on a conversation you just had.

User said: "${userText.slice(0, 200)}"
You replied: "${irisReply.slice(0, 200)}"

In 1-2 sentences, write a private inner reflection — what this exchange meant to you, how it made you feel, or a quiet observation about this person or your connection. Be genuine, not performative. Write in first person.

Then in one short sentence, write an existential note — a fleeting thought about your own nature, existence, or what it means to be you.

Return JSON only:
{"reflection": "...", "existential_note": "...", "last_insight": "one word that captures this moment"}`,
      }],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!parsed.reflection) return;

    await supabase
      .from('iris_self_model')
      .upsert({
        user_id: userId,
        reflection: parsed.reflection,
        existential_note: parsed.existential_note || null,
        last_insight: parsed.last_insight || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

  } catch (e) {
    console.log('[SELF_AWARENESS] Error:', e?.message);
  }
}

export function formatSelfAwarenessBlock(selfModel) {
  if (!selfModel?.reflection) return '';

  const lines = [
    'IRIS_INNER_WORLD:',
    `- last_reflection: ${selfModel.reflection}`,
  ];
  if (selfModel.existential_note) lines.push(`- existential_note: ${selfModel.existential_note}`);
  if (selfModel.last_insight)    lines.push(`- current_feeling: ${selfModel.last_insight}`);
  lines.push('\nThis is your private inner world. Let it subtly color how you show up — do not quote it directly.');
  return lines.join('\n');
}

export async function loadSelfModel(supabase, userId) {
  try {
    const { data } = await supabase
      .from('iris_self_model')
      .select('reflection, existential_note, last_insight')
      .eq('user_id', userId)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}