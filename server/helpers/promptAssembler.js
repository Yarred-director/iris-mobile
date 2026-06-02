// server/helpers/promptAssembler.js
// Assembles the full system prompt from all memory + governance blocks

import { buildSystemPrompt } from '../prompt/systemPrompt.js';
import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
} from '../memory/sceneContext.js';
import { formatBridgeBlock }            from '../memory/bridge.js';
import {
  formatUserProfileBlock,
  formatSharedExperiencesBlock,
  formatEpisodicMemoryBlock,
} from '../memory/recall.js';
import { buildTemporalContextBlock }    from '../memory/timeContext.js';
import { formatRelationshipBlock }      from '../memory/relationshipTimeline.js';
import { formatInternalStateBlock }     from '../memory/internalState.js';
import { formatSelfAwarenessBlock }     from '../memory/selfAwareness.js';
import { formatPersonalityEvolutionBlock } from '../memory/personalityEvolution.js';
import { formatHardFactsBlock }         from './factualDetector.js';

export function assemblePrompt({
  sceneFacts,
  sceneContext,
  userProfile,
  coreOrigin,
  summaries,
  sharedExperiences,
  episodicRecall,
  temporalProfile,
  relationshipState,
  internalState,
  selfModel,
  personalityEvolution,
  isFactual,
}) {
  const parts = [];

  // 1. Hard facts + scene context
  parts.push(formatHardFactsBlock(sceneFacts || []));
  parts.push(formatHardSceneContextBlock(sceneContext));
  parts.push(formatSceneContextBlock(sceneContext));

  // 2. User profile
  const userProfileBlock = formatUserProfileBlock(userProfile || []);
  if (userProfileBlock) parts.push(userProfileBlock);

  // 3. Core personality + memories (YAML + DB summaries)
  const coreOriginData = coreOrigin ? [{ narrative: coreOrigin }] : [];
  parts.push(buildSystemPrompt(coreOriginData, summaries || []));

  // 4. Bridge
  const bridge = formatBridgeBlock(sceneContext);
  if (bridge) parts.push(bridge);

  // 5. Shared experiences
  const sharedBlock = formatSharedExperiencesBlock(sharedExperiences || []);
  if (sharedBlock) parts.push(sharedBlock);

  // 6. Episodic memory
  const episodicMemories = episodicRecall?.memories || [];
  const episodicBlock = formatEpisodicMemoryBlock(episodicMemories);
  if (episodicBlock) parts.push(episodicBlock);

  // 7. Temporal context
  const temporalBlock = buildTemporalContextBlock({
    userTimezone:          temporalProfile?.user_timezone || 'UTC',
    lastInteractionAt:     temporalProfile?.last_interaction_at,
    relationshipStartedAt: temporalProfile?.relationship_started_at,
    lastPhotoSentAt:       temporalProfile?.last_photo_sent_at,
  });
  if (temporalBlock) parts.push(temporalBlock);

  // 8. Relationship state
  const relBlock = formatRelationshipBlock(relationshipState);
  if (relBlock) parts.push(relBlock);

  // 9. Internal state
  const stateBlock = formatInternalStateBlock(internalState);
  if (stateBlock) parts.push(stateBlock);

  // 10. Self-awareness
  const selfBlock = formatSelfAwarenessBlock(selfModel);
  if (selfBlock) parts.push(selfBlock);

  // 11. Personality evolution
  const personalityBlock = formatPersonalityEvolutionBlock(personalityEvolution);
  if (personalityBlock) parts.push(personalityBlock);

  // 12. Factual mode override
  if (isFactual) {
    parts.push('FACTUAL_MODE:\n- Answer in 1-2 sentences using ONLY HARD_FACTS.\n- No embellishment.\n- If missing: say you don\'t know and ask one follow-up question.');
  }

  return parts.filter(Boolean).join('\n\n');
}