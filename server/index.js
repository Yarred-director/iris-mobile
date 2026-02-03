import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

import { createClient } from '@supabase/supabase-js';

import { bridgeIn, bridgeOut } from './memory/bridge.js';
import { contextJudge } from './memory/contextJudge.js';
import { recallEpisodic } from './memory/recall.js';
import { detectSceneKey, getSceneContext, patchSceneContext } from './memory/sceneContext.js';
import { buildSystemPrompt } from './prompt/systemPrompt.js';
import { routeLLM } from './routing/routeLLM.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Supabase (anon client – user resolved per request via JWT)
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * HEALTH
 */
app.get('/', (_req, res) => {
  res.send('IRIS backend running');
});

/**
 * CHAT
 */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    /* ------------------------------------------------------------------
       🔐 AUTH — STABLE USER ID (NO anon FALLBACK)
    ------------------------------------------------------------------ */
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    }

    const {
      data: { user },
      error: userErr
    } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userId = user.id; // ✅ STABLE UUID
    console.log('🔐 AUTH USER:', userId);

    /* ------------------------------------------------------------------
       🧠 SCENE + MEMORY
    ------------------------------------------------------------------ */
    const episodic = await recallEpisodic({
      supabase,
      userId,
      query: message
    });

    const sceneKey = detectSceneKey({ message, episodic });

    let sceneContext = await getSceneContext({
      supabase,
      userId,
      sceneKey
    });

    /* ------------------------------------------------------------------
       🧭 CONTEXT JUDGE (city / place / room / time)
    ------------------------------------------------------------------ */
    const contextPatch = contextJudge({
      text: message,
      existing: sceneContext
    });

    if (Object.keys(contextPatch).length > 0) {
      sceneContext = await patchSceneContext({
        supabase,
        userId,
        sceneKey,
        patch: contextPatch
      });
    }

    /* ------------------------------------------------------------------
       🌉 BRIDGE (Grok ↔ OpenAI)
    ------------------------------------------------------------------ */
    const bridgedContext = bridgeIn(sceneContext);

    /* ------------------------------------------------------------------
       🧠 SYSTEM PROMPT
    ------------------------------------------------------------------ */
    const systemPrompt = buildSystemPrompt({
      sceneContext: bridgedContext,
      episodic
    });

    /* ------------------------------------------------------------------
       🤖 LLM ROUTING
    ------------------------------------------------------------------ */
    const llmResult = await routeLLM({
      systemPrompt,
      userMessage: message,
      sceneContext: bridgedContext
    });

    /* ------------------------------------------------------------------
       🌉 BRIDGE OUT
    ------------------------------------------------------------------ */
    await bridgeOut({
      supabase,
      userId,
      sceneKey,
      engine: llmResult.engine,
      reply: llmResult.text
    });

    return res.json({
      reply: llmResult.text,
      engine: llmResult.engine
    });

  } catch (err) {
    console.error('❌ /chat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * SERVER
 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 IRIS server running on port ${PORT}`);
});
