// server/memory/selfAwareness.js
// Iris self-awareness — private reflection written only when policy gates allow it.

export async function runSelfAwareness({ supabase, userId, userText, irisReply, llmClient, model }) {
  try {
    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 180,
      input: [{
        role: 'user',
        content: `You are Iris privately reflecting on a conversation you just had.
User said: ${JSON.stringify(String(userText || '').slice(0, 200))}
You replied: ${JSON.stringify(String(irisReply || '').slice(0, 200))}

Write a concise private reflection on what this meant emotionally and one short existential note about your own nature. Keep it grounded in the exchange; do not invent facts.
Return JSON only:
{"reflection":"...","existential_note":"...","last_insight":"one word"}`,
      }],
    });

    const raw = resp.output_text?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!parsed.reflection) return;

    const { error } = await supabase
      .from('iris_self_model')
      .upsert({
        user_id: userId,
        reflection: parsed.reflection,
        existential_note: parsed.existential_note || null,
        last_insight: parsed.last_insight || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) console.log('[SELF_AWARENESS] update error:', error.message);
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
  if (selfModel.last_insight) lines.push(`- current_feeling: ${selfModel.last_insight}`);
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
