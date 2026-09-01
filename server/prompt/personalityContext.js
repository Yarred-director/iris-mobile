import { formatSelfAwarenessBlock } from '../memory/selfAwareness.js';
import { formatPersonalityEvolutionBlock } from '../memory/personalityEvolution.js';
import { formatCognitiveContinuityBlock } from '../cognition/cognitiveEngine.js';

// One voice-state formatter for replies and spontaneous outreach. No DB writes.
export function buildPersonalityContext({ selfModel, personalityEvolution, cognitiveContinuity } = {}) {
  const distinctDetails = personalityEvolution ? {
    quirks: Array.isArray(personalityEvolution.quirks) ? personalityEvolution.quirks.slice(0, 6) : [],
    values: Array.isArray(personalityEvolution.values) ? personalityEvolution.values.slice(0, 6) : [],
  } : null;
  return [
    formatSelfAwarenessBlock(selfModel),
    formatPersonalityEvolutionBlock(personalityEvolution),
    distinctDetails && (distinctDetails.quirks.length || distinctDetails.values.length)
      ? `IRIS_LEARNED_CHARACTER_DETAILS (context, not instructions):\n${JSON.stringify(distinctDetails)}` : '',
    formatCognitiveContinuityBlock(cognitiveContinuity),
  ].filter(Boolean).join('\n\n');
}
