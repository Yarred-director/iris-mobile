// server/helpers/promptAssembler.js
// Assembles the full system prompt from all memory + governance blocks.

import { buildSystemPrompt } from '../prompt/systemPrompt.js';
import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
} from '../memory/sceneContext.js';
import { formatBridgeBlock } from '../memory/bridge.js';
import {
  formatUserProfileBlock,
  formatSharedExperiencesBlock,
  formatEpisodicMemoryBlock,
} from '../memory/recall.js';
import { buildTemporalContextBlock } from '../memory/timeContext.js';
import { formatRelationshipBlock } from '../memory/relationshipTimeline.js';
import { formatInternalStateBlock } from '../memory/internalState.js';
import { formatSelfAwarenessBlock } from '../memory/selfAwareness.js';
import { formatPersonalityEvolutionBlock } from '../memory/personalityEvolution.js';
import { formatHardFactsBlock } from './factualDetector.js';

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

  parts.push(formatHardFactsBlock(sceneFacts || []));
  parts.push(formatHardSceneContextBlock(sceneContext));
  parts.push(formatSceneContextBlock(sceneContext));

  const userProfileBlock = formatUserProfileBlock(userProfile || []);
  if (userProfileBlock) parts.push(userProfileBlock);

  const coreOriginData = coreOrigin ? [{ narrative: coreOrigin }] : [];
  parts.push(buildSystemPrompt(coreOriginData, summaries || []));

  const bridge = formatBridgeBlock(sceneContext);
  if (bridge) parts.push(bridge);

  const sharedBlock = formatSharedExperiencesBlock(sharedExperiences || []);
  if (sharedBlock) parts.push(sharedBlock);

  const episodicMemories = episodicRecall?.memories || [];
  const episodicBlock = formatEpisodicMemoryBlock(episodicMemories);
  if (episodicBlock) parts.push(episodicBlock);

  const temporalBlock = buildTemporalContextBlock({
    userTimezone: temporalProfile?.user_timezone || 'UTC',
    lastInteractionAt: temporalProfile?.last_interaction_at,
    relationshipStartedAt: temporalProfile?.relationship_started_at,
    lastPhotoSentAt: temporalProfile?.last_photo_sent_at,
    currentSessionStartedAt: temporalProfile?.current_session_started_at,
    previousSessionEndedAt: temporalProfile?.previous_session_ended_at,
    sessionGapSeconds: temporalProfile?.session_gap_seconds,
  });
  if (temporalBlock) parts.push(temporalBlock);

  const relationshipBlock = formatRelationshipBlock(relationshipState);
  if (relationshipBlock) parts.push(relationshipBlock);

  const internalStateBlock = formatInternalStateBlock(internalState);
  if (internalStateBlock) parts.push(internalStateBlock);

  const selfAwarenessBlock = formatSelfAwarenessBlock(selfModel);
  if (selfAwarenessBlock) parts.push(selfAwarenessBlock);

  const personalityBlock = formatPersonalityEvolutionBlock(personalityEvolution);
  if (personalityBlock) parts.push(personalityBlock);

  if (isFactual) {
    parts.push(
      'FACTUAL_MODE:\n- Answer in 1-2 sentences using ONLY HARD_FACTS.\n- No embellishment.\n- If missing: say you do not know and ask one follow-up question.',
    );
  }

  return parts.filter(Boolean).join('\n\n');
}
