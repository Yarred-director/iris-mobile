// server/memory/selfAwareness.js
// Iris self-model compatibility layer. The richer cognitive engine now owns most
// reflection writes; this module keeps loading/formatting the persistent self for prompts.

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
        last_reflection_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) console.log('[SELF_AWARENESS] update error:', error.message);
  } catch (e) {
    console.log('[SELF_AWARENESS] Error:', e?.message);
  }
}

function conciseObject(value, limit = 5) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).slice(0, limit);
}

export function formatSelfAwarenessBlock(selfModel) {
  if (!selfModel) return '';
  const lines = ['IRIS_SELF_MODEL (private sense of self):'];
  if (selfModel.narrative_identity) lines.push(`- narrative_identity: ${selfModel.narrative_identity}`);
  if (selfModel.reflection) lines.push(`- latest_reflection: ${selfModel.reflection}`);
  if (selfModel.last_insight) lines.push(`- latest_insight: ${selfModel.last_insight}`);
  const moodLabel = selfModel?.mood?.label;
  if (moodLabel) lines.push(`- current_mood: ${moodLabel}${Number.isFinite(Number(selfModel?.mood?.intensity)) ? ` (${selfModel.mood.intensity}/100)` : ''}`);

  const drives = conciseObject(selfModel.drives, 8)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5);
  if (drives.length) lines.push(`- strongest_drives: ${drives.map(([key, value]) => `${key}=${Number(value).toFixed(2)}`).join(', ')}`);

  if (Array.isArray(selfModel.beliefs) && selfModel.beliefs.length) lines.push(`- beliefs_about_self_or_relationship: ${selfModel.beliefs.slice(0, 5).join(' | ')}`);
  if (Array.isArray(selfModel.open_questions) && selfModel.open_questions.length) lines.push(`- open_questions: ${selfModel.open_questions.slice(0, 4).join(' | ')}`);
  if (Array.isArray(selfModel.active_goals) && selfModel.active_goals.length) lines.push(`- active_goals: ${selfModel.active_goals.slice(0, 4).join(' | ')}`);
  if (Array.isArray(selfModel.current_concerns) && selfModel.current_concerns.length) lines.push(`- current_concerns: ${selfModel.current_concerns.slice(0, 4).join(' | ')}`);
  if (selfModel.relationship_model && Object.keys(selfModel.relationship_model).length) lines.push(`- relationship_model: ${JSON.stringify(selfModel.relationship_model)}`);
  if (selfModel.existential_note) lines.push(`- existential_note: ${selfModel.existential_note}`);

  if (lines.length === 1) return '';
  lines.push(
    '',
    'SELF_MODEL_RULES:',
    '- This is private continuity, not a diagnostic readout to recite to the user.',
    '- Let it influence initiative, attention, interpretation and tone naturally.',
    '- Preserve a stable identity while allowing gradual change from accumulated experience.',
  );
  return lines.join('\n');
}

export async function loadSelfModel(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_self_model')
      .select([
        'reflection',
        'existential_note',
        'last_insight',
        'mood',
        'drives',
        'beliefs',
        'open_questions',
        'active_goals',
        'current_concerns',
        'relationship_model',
        'narrative_identity',
        'last_reflection_at',
        'last_cognition_at',
        'last_proactive_at',
        'cognition_version',
      ].join(', '))
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.log('[SELF_AWARENESS] load error:', error.message);
      return null;
    }
    return data || null;
  } catch {
    return null;
  }
}
