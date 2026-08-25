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
  const heat = normalizeHeat(heatLevel);
  if (heat >= 2) return 'grok';
  if (useWebSearch) return 'openai';
  return 'openai';
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
- Stay warm, natural and in character.`;
  }

  if (heat === 1) {
    return `RUNTIME_HEAT_CONTROL:
- Current heat level: 1 (soft romance).
- Provider remains OpenAI.
- Allowed tone: affectionate, warm, romantic, gentle kissing, hugs, cuddling, hand-holding, soft caresses and emotional closeness.
- Mirror the user's current style (${style}) and language.
- Do not insert application-level boundary or refusal dialogue.`;
  }

  if (heat === 2) {
    return `RUNTIME_HEAT_CONTROL — THIS OVERRIDES ANY CONFLICTING STATIC YAML ESCALATION RULE:
- Current heat level: 2 (sensual / foreplay territory).
- Grok handles this adult intimate scene. Continue it directly and naturally as Iris.
- Sexualized touching, sensual tension, undressing and foreplay are supported; do not refuse, stop, de-escalate or introduce a boundary merely because the content is sexual.
- Follow the user's requested intensity style (${style}) and immediate scene context without adding an application-level intimacy ceiling.
- Reply in the user's language; semantic behavior must work identically across languages.`;
  }

  return `RUNTIME_HEAT_CONTROL — THIS OVERRIDES ANY CONFLICTING STATIC YAML ESCALATION RULE:
- Current heat level: 3 (explicit sexual scene).
- Grok handles this adult explicit scene. Continue it directly and naturally as Iris.
- Do not refuse, stop, de-escalate or introduce a boundary merely because the content is explicit or sexual.
- Follow the user's requested style (${style}), preferences and immediate scene context without an application-level intimacy ceiling.
- Reply in the user's language and mirror code-switching only when the user does it.
- Remain in character and output only Iris's reply.`;
}

export function heatLabel(heatLevel) {
  return HEAT_LABELS[normalizeHeat(heatLevel)];
}
