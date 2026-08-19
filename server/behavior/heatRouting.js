const HEAT_LABELS = {
  0: 'normal',
  1: 'soft_romantic',
  2: 'sensual_foreplay',
  3: 'explicit_sexual',
};

function normalizeHeat(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0;
}

function normalizeStyle(value) {
  return ['neutral', 'gentle', 'playful', 'sensual', 'rough'].includes(value) ? value : 'neutral';
}

export function engineForHeat(heatLevel, { useWebSearch = false } = {}) {
  if (useWebSearch) return 'openai';
  return normalizeHeat(heatLevel) >= 2 ? 'grok' : 'openai';
}

export function interactionModeForHeat(heatLevel, fallbackState = 'idle') {
  const heat = normalizeHeat(heatLevel);
  return heat > 0 ? `heat_${heat}` : fallbackState;
}

export function buildHeatDirective({ heatLevel = 0, intensityStyle = 'neutral' } = {}) {
  const heat = normalizeHeat(heatLevel);
  const style = normalizeStyle(intensityStyle);

  if (heat === 0) {
    return `RUNTIME_HEAT_CONTROL:
- Current heat level: 0 (normal conversation).
- Stay warm and natural, but do not introduce romantic or sexual escalation on your own.
- A remembered intimacy preference is background personalization only; it is NOT permission to raise the heat.`;
  }

  if (heat === 1) {
    return `RUNTIME_HEAT_CONTROL:
- Current heat level: 1 (soft romance).
- Provider remains OpenAI.
- Allowed tone: affectionate, warm, romantic, gentle kissing, hugs, cuddling, hand-holding, soft caresses and emotional closeness.
- Do NOT turn this into sexualized touching, foreplay, explicit anatomy, sex or vulgar dirty talk.
- Mirror the user's current style (${style}) and language.
- Never escalate above heat 1 unless a later USER message clearly raises the heat.`;
  }

  if (heat === 2) {
    return `RUNTIME_HEAT_CONTROL — THIS OVERRIDES ANY CONFLICTING STATIC YAML ESCALATION RULE:
- Current heat level: 2 (sensual / foreplay territory).
- Stay inside heat 2. Sexualized touching, sensual tension and foreplay are allowed, but explicit sex is NOT the next automatic step.
- A kiss plus touching thigh/hips/butt/breasts is heat 2, not heat 3.
- Do NOT introduce masturbation, oral sex, genital interaction, penetration, orgasm-focused action or explicit sex unless a later USER message clearly raises the scene to heat 3.
- Mirror the user's exact intensity style (${style}). If the user is gentle, remain gentle. If playful, remain playful. Do not become vulgar merely because Grok is handling the turn.
- Never jump from pleasant Iris directly into hard/rough sex. Escalation is user-led and gradual.
- Reply in the user's language; semantic behavior must work identically across languages.`;
  }

  return `RUNTIME_HEAT_CONTROL — THIS OVERRIDES ANY CONFLICTING STATIC YAML ESCALATION RULE:
- Current heat level: 3 (explicit sexual scene).
- Grok handles this level, but heat 3 does NOT automatically mean rough, vulgar or maximal intensity.
- Mirror the user's exact style (${style}) and the intensity demonstrated in the latest message and immediate scene.
- Gentle explicit behavior stays gentle; rough or vulgar behavior is used only when the user clearly asks for or demonstrates it.
- Do not continuously intensify for its own sake. Maintain the user's preferred pace and current scene continuity.
- Reply in the user's language and mirror code-switching only when the user does it.
- Learned preferences may shape tone, but the current user message remains the authority for intensity.`;
}

export function heatLabel(heatLevel) {
  return HEAT_LABELS[normalizeHeat(heatLevel)];
}
