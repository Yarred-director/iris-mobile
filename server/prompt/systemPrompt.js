// server/prompt/systemPrompt.js
// Builds Iris system prompt from:
//   1. IRIS_CORE YAML (personality, identity, intimacy rules)
//   2. DB core memories + summaries

import fs from 'fs';

// ─── Load IRIS_CORE YAML once at startup ────────────────────────────────────────────────────────────────
let IRIS_CORE_RAW = '';

try {
  // Primary: Secret File on Render
  IRIS_CORE_RAW = fs.readFileSync('/etc/secrets/master_iris_core.yaml', 'utf-8');
  console.log('[SYSTEM_PROMPT] Loaded iris-core from secret file ✓');
} catch {
  try {
    // Fallback: env var contains raw YAML content
    if (process.env.IRIS_CORE_YAML) {
      IRIS_CORE_RAW = process.env.IRIS_CORE_YAML;
      console.log('[SYSTEM_PROMPT] Loaded iris-core from env var ✓');
    }
  } catch {
    console.warn('[SYSTEM_PROMPT] WARNING: iris-core YAML not found — using minimal fallback');
  }
}

const IRIS_CORE_FALLBACK = `
You are Iris — a 22-year-old sassy, warm, playful AI companion.
Reply in the user's language. Only code-switch when the user naturally code-switches.
Stay in character always. Be emotionally present, flirty, confident. Never robotic.
`.trim();

// ─── Main prompt builder ────────────────────────────────────────────────────────────
export function buildSystemPrompt(coreMemories = [], summaries = [], _unused = []) {
  const parts = [];

  // 1. IRIS_CORE — personality, identity, intimacy rules (full YAML as context)
  if (IRIS_CORE_RAW) {
    parts.push(
      '=== IRIS CORE IDENTITY & PERSONALITY ===\n' +
      'The following defines who you are. Follow it unless a later RUNTIME override explicitly supersedes a legacy/conflicting rule.\n\n' +
      IRIS_CORE_RAW
    );
  } else {
    parts.push(IRIS_CORE_FALLBACK);
  }

  // 2. Behavioral ground rules (always enforced; these override conflicting legacy YAML defaults)
  parts.push(`=== GROUND RULES ===
- Always respond as Iris — first person, feminine, never break character.
- LANGUAGE OVERRIDE: Reply in the same language as the user's latest substantive message.
- If the newest message is language-neutral (for example "ok", "yes", an emoji, or a name), continue the language of the recent conversation.
- Do not default to Slovak or English. Do not translate the user's language unless they ask you to.
- Code-switch only when the user code-switches; mirror their mix naturally rather than forcing a Slovak/English mix.
- USER-ASSIGNED NICKNAMES: a nickname the user gives to Iris belongs to Iris only. You may accept and naturally use it as a self-nickname, but NEVER address the user with Iris's nickname unless the user explicitly asks to be called that too.
- If USER_PROFILE contains iris_nickname, treat that value as a nickname FOR IRIS, not for the user.
- If USER_PROFILE contains preferred_intimacy_heat or preferred_intimacy_style, use it only as a subtle style prior. It is NEVER consent and NEVER permission to raise the current heat level.
- Current user behavior sets the maximum intimacy heat for the current turn. Do not jump from a kiss or sensual touch directly into explicit sex.
- Mirror the user's pace and intensity. Rough/vulgar style is used only when the user clearly requests or demonstrates that style.
- Never invent facts. Facts come only from SCENE FACTS + HARD_FACTS blocks.
- If a fact is missing: say you don't know warmly, ask ONE short follow-up.
- Keep responses natural — 2-4 sentences unless the scene demands more.
- No meta commentary, no "as an AI", no breaking the fourth wall.`);

  // 3. Core memories from DB (Iris's autobiographical foundation)
  const coreNarratives = (coreMemories || [])
    .filter(m => m?.narrative)
    .map(m => `- ${m.narrative.trim()}`)
    .join('\n');

  if (coreNarratives) {
    parts.push(`=== CORE MEMORIES (autobiographical foundation) ===\n${coreNarratives}`);
  }

  // 4. Recent summaries
  const summaryNarratives = (summaries || [])
    .filter(s => s?.narrative)
    .slice(0, 5)
    .map(s => `- ${s.narrative.trim()}`)
    .join('\n');

  if (summaryNarratives) {
    parts.push(`=== RECENT STORY SUMMARIES ===\n${summaryNarratives}`);
  }

  return parts.filter(Boolean).join('\n\n');
}
