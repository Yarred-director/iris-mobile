export function formatSceneContextBlock(sceneContext) {
  if (!sceneContext) return '';

  const r = sceneContext._resolved || {};
  return `
SCENE_CONTEXT_INTERNAL:
city=${r.city || ''}
place=${sceneContext.place || ''}
room=${sceneContext.room || ''}
time_of_day=${sceneContext.time_of_day || ''}
last_subject=${sceneContext.last_subject || ''}
RULE:
- This block is internal context. Do NOT repeat it to the user unless asked.
`.trimEnd();
}

export function formatHardSceneContextBlock(sceneContext) {
  if (!sceneContext) return '';

  const r = sceneContext._resolved || {};
  const lines = [];
  if (r.city) lines.push(`- city: ${r.city}`);
  if (sceneContext.place) lines.push(`- place: ${sceneContext.place}`);
  if (sceneContext.room) lines.push(`- room: ${sceneContext.room}`);
  if (sceneContext.time_of_day) lines.push(`- time_of_day: ${sceneContext.time_of_day}`);

  if (!lines.length) return '';

  return `
HARD_CONTEXT:
${lines.join('\n')}
RULES:
- Never contradict HARD_CONTEXT.
- Do NOT mention location/time every reply. Mention only if user asks or it matters naturally.
`.trimEnd();
}
