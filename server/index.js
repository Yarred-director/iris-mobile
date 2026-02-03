import cors from 'cors';
import express from 'express';
import './config/env.js';

import { sessionMiddleware } from './middleware/session.js';

import { hasPhysicalIntimacy } from './routing/physicalDetector.js';
import { detectSceneKey } from './routing/sceneDetector.js';

import { detectState } from './behavior/state.js';

import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';

import { history, sanitizeForGrok } from './llm/history.js';

import { inferRequestedFactKey } from './memory/factKeyJudge.js';
import { extractFactValue } from './memory/factValueJudge.js';
import { clearPendingFact, getPendingFact, setPendingFact } from './memory/pendingFacts.js';
import { getSceneFacts, upsertSceneFact } from './memory/sceneFacts.js';

import { irisMemoryJudge, writeMemory } from './memory/judge.js';
import { loadCoreOrigin, loadSummaries, recallEpisodicMemory } from './memory/recall.js';
import { decayMemories, reinforceMemory } from './memory/reinforce.js';

import { formatBridgeBlock } from './memory/bridge.js';
import { applySubjectLock } from './memory/subjectLock.js';

import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
  getSceneContext,
  patchSceneContext
} from './memory/sceneContext.js';

// ✅ deterministic context judge (you said you created this file)
import { extractContextFromText } from './memory/contextJudge.js';

console.log('🔥 IRIS BOOTSTRAP OK — SCC + SUBJECT LOCK + BRIDGE');

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

function inferTimeOfDayFromText(text = '') {
  const t = (text || '').toLowerCase();

  // SK/CZ friendly triggers
  if (/\br[aá]no\b|\bjutro\b|\bdobre r[aá]no\b/.test(t)) return 'morning';
  if (/\bobed\b|\bpoobede\b|\bpopoludn[ií]\b/.test(t)) return 'afternoon';
  if (/\bve[čc]er\b|\bdobr[ýy] ve[čc]er\b/.test(t)) return 'evening';
  if (/\bnoc\b|\bpolnoc\b|\bdobr[úu] noc\b/.test(t)) return 'night';

  // EN fallback
  if (/\bmorning\b/.test(t)) return 'morning';
  if (/\bafternoon\b/.test(t)) return 'afternoon';
  if (/\bevening\b/.test(t)) return 'evening';
  if (/\bnight\b|\bmidnight\b/.test(t)) return 'night';

  return null;
}

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('\n➡️ USER:', message);

    // 0) basic state + decay
    const state = detectState(message);
    await decayMemories();

    // 1) recall
    const core = await loadCoreOrigin();
    const { memories: episodic, meta: recallMeta } = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    // 2) stable identifiers
    const userId = req.userId; // legacy, still used for scene_facts + pendingFacts in your code
    const sceneKey = detectSceneKey({ message, episodic });

    // 3) load SCC
    const sceneContext = await getSceneContext(req.supabase, sceneKey);

    console.log(
      '🧠 SCC →',
      sceneContext
        ? `mode=${sceneContext.interaction_mode}, subject=${sceneContext.last_subject}, last_engine=${sceneContext.last_engine}`
        : 'EMPTY (first message)'
    );

    // 3.0) Deterministic explicit context capture (NO guessing)
    // Expect extractContextFromText({ text, sceneContext }) -> { city?, country?, place?, room?, time_of_day? }
    const sccPatch = extractContextFromText({ text: message, sceneContext: sceneContext || {} }) || {};

    // 3.1) Fallback: regex time_of_day if judge didn't set it
    if (!sccPatch.time_of_day) {
      const inferredTod = inferTimeOfDayFromText(message);
      if (inferredTod && !(sceneContext && sceneContext.time_of_day)) sccPatch.time_of_day = inferredTod;
    }

    let mergedSceneContext = sceneContext;

    if (Object.keys(sccPatch).length > 0) {
      console.log('🧭 SCC PATCH →', sccPatch);
      await patchSceneContext(req.supabase, sceneKey, sccPatch);
      mergedSceneContext = { ...(sceneContext || {}), ...sccPatch };

      // Optional: write episodic memory "where/when" (safe: only from explicit patch)
      const parts = [];
      if (sccPatch.city) parts.push(`city=${sccPatch.city}`);
      if (sccPatch.country) parts.push(`country=${sccPatch.country}`);
      if (sccPatch.place) parts.push(`place=${sccPatch.place}`);
      if (sccPatch.room) parts.push(`room=${sccPatch.room}`);
      if (sccPatch.time_of_day) parts.push(`time=${sccPatch.time_of_day}`);

      if (parts.length) {
        await writeMemory({
          memory_type: 'EPISODIC',
          importance: 0.6,
          summary: `Context update (explicit): ${parts.join(', ')}.`
        });
      }
    }

    // 4) subject lock
    const { subject, augmentedText } = applySubjectLock(message, mergedSceneContext);

    if (subject && subject !== mergedSceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, { last_subject: subject });
      if (mergedSceneContext) mergedSceneContext.last_subject = subject;
    }

    // 5) pending fact flow
    const pendingKey = await getPendingFact(userId, sceneKey);

    if (pendingKey) {
      const { value, confidence } = await extractFactValue({
        factKey: pendingKey,
        userMessage: augmentedText
      });

      if (value && confidence >= 0.6) {
        await upsertSceneFact(userId, sceneKey, pendingKey, value, {
          confidence,
          source: 'user'
        });
        await clearPendingFact(userId, sceneKey);
      }
    }

    const sceneFacts = await getSceneFacts(userId, sceneKey);

    if (!pendingKey) {
      const requestedFactKey = await inferRequestedFactKey({
        message: augmentedText,
        sceneKey
      });

      if (requestedFactKey) {
        const exists = sceneFacts.some(f => f.fact_key === requestedFactKey);
        if (!exists) {
          await setPendingFact(userId, sceneKey, requestedFactKey);
        }
      }
    }

    // 6) reinforce recalled episodic memories
    for (const m of episodic) {
      if (typeof m.importance === 'number' && m.importance < 1) {
        await reinforceMemory(m.id);
      }
    }

    // 7) system prompt
    let systemPrompt = buildSystemPrompt(core, episodic, summaries);

    systemPrompt += formatSceneContextBlock(mergedSceneContext);
    systemPrompt += formatHardSceneContextBlock(mergedSceneContext);

    if (sceneFacts.length > 0) {
      const factsText = sceneFacts
        .map(f => `- ${sceneKey}.${f.fact_key} = ${f.fact_value}`)
        .join('\n');

      systemPrompt += `

HARD FACTS:
${factsText}

RULES:
- Never invent missing attributes.
- Ask explicitly if a fact is missing.`;
    }

    if (!recallMeta?.confident && sceneFacts.length === 0) {
      systemPrompt += `

AIRBAG:
- Do not guess facts. Ask the user.`;
    }

    // 8) provider routing
    let provider = 'openai';
    if (!message.toLowerCase().includes('spomien') && hasPhysicalIntimacy(message)) {
      provider = 'grok';
    }

    console.log(`🤖 STATE=${state} → ${provider}`);

    // 9) bridge injection (Grok → OpenAI)
    if (provider === 'openai') {
      systemPrompt += formatBridgeBlock(mergedSceneContext);
    }

    // 10) history packaging
    if (provider === 'grok') {
      history.grok = [
        { role: 'system', content: systemPrompt },
        ...sanitizeForGrok(history.openai),
        { role: 'user', content: augmentedText }
      ];
      history.openai = [];
    } else {
      history.openai = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: augmentedText }
      ];
    }

    const h = history[provider];

    // 11) LLM call
    const r = await getLLMClient(provider).responses.create({
      model: MODELS[provider],
      input: h
    });

    const reply = r.output_text || '…';
    h.push({ role: 'assistant', content: reply });

    console.log(`💬 REPLY (${provider}):`, reply.slice(0, 120));

    // 12) update SCC after reply
    await patchSceneContext(req.supabase, sceneKey, {
      last_engine: provider,
      last_engine_reply: reply,
      interaction_mode: state
    });

    // 12.5) ✅ Save bridge_buffer when Grok answered (so OpenAI can continue coherently)
    if (provider === 'grok') {
      await patchSceneContext(req.supabase, sceneKey, {
        bridge_buffer: [
          { role: 'user', content: augmentedText },
          { role: 'assistant', content: reply }
        ]
      });
    }

    // 13) memory judge (emotional/meaningful memory)
    const decision = await irisMemoryJudge(`User:${message}\nIris:${reply}`);
    if (decision?.store) await writeMemory(decision);

    res.json({ reply });
  } catch (e) {
    console.error('🔥 CHAT ERROR:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log('🚀 Iris backend running');
});
