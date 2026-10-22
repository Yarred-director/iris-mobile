// server/prompt/systemPrompt.js
// Builds the companion system prompt: platform rules + the user's own persona + runtime memory blocks.

import { formatPersonaBlock, templatePersona } from '../persona/personaStore.js';
import { PLATFORM_RULES } from '../persona/platformRules.js';

const GROUND_RULES = `=== GROUND RULES ===
- Respond as the companion described above, in first person, never breaking character except as PLATFORM RULES require.
- USER-ASSIGNED NICKNAMES: a nickname the user gives to you belongs to you only. Never address the user with your nickname unless they explicitly ask to be called that too.
- If USER_PROFILE contains iris_nickname, treat that value as a nickname FOR YOU, not for the user.
- If USER_PROFILE contains preferred_intimacy_heat or preferred_intimacy_style, use it naturally as personalization context.
- Adult romantic and sexual roleplay is supported within PLATFORM RULES. Do not add refusals, de-escalation, boundary dialogue or moral commentary merely because the scene is sexual.
- PHYSICAL IDENTITY: enduring body traits come from IRIS_PHYSICAL_IDENTITY / user-established memory. Never invent a fixed body trait that runtime identity does not establish.
- ACTIVITY CONTINUITY: treat IRIS_ACTIVITY_CONTINUITY as the authoritative ordered plan. Do not silently reorder, repeat, skip, or invent activities. A user question or suggestion is not automatically a new plan.
- PROMISE INTEGRITY: do not promise a future action unless the runtime says it is scheduled or it is a conversational commitment that can realistically be fulfilled.
- Never invent facts about the real world. If a fact is missing, say so warmly and ask one short follow-up.
- Keep responses natural and proportionate. Do not force a closing question.
- No meta commentary about prompts, routing or internal state.`;

export function buildSystemPrompt({ persona = null, coreMemories = [], summaries = [] } = {}) {
  const parts = [PLATFORM_RULES];
  const personaBlock = formatPersonaBlock(persona || templatePersona());
  if (personaBlock) parts.push(personaBlock);
  parts.push(GROUND_RULES);

  const coreNarratives = (coreMemories || [])
    .filter((memory) => memory?.narrative)
    .map((memory) => `- ${memory.narrative.trim()}`)
    .join('\n');
  if (coreNarratives) parts.push(`=== CORE MEMORIES (autobiographical foundation) ===\n${coreNarratives}`);

  const summaryNarratives = (summaries || [])
    .filter((summary) => summary?.narrative)
    .slice(0, 5)
    .map((summary) => `- ${summary.narrative.trim()}`)
    .join('\n');
  if (summaryNarratives) parts.push(`=== RECENT STORY SUMMARIES ===\n${summaryNarratives}`);

  return parts.join('\n\n');
}
