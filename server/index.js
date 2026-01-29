/* ================================
   ENV (NODE 24 SAFE)
================================ */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, '.env'),
});

/* ================================
   IMPORTS
================================ */
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import express from 'express';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';

/* ================================
   BASIC STATE
================================ */
const MAX_HISTORY_LENGTH = 200;

let historyOpenAI = [];
let historyGrok = [];
let activeLLM = 'openai';

// 🧠 Behavior FSM
let behaviorState = 'idle';

/* ================================
   BEHAVIOR ENGINE (FSM)
================================ */
function updateBehaviorState(message, currentState) {
  const text = message.toLowerCase();

  const signals = {
    physical: /dotyk|bozk|prs|nahá|vojsť|tvrdý|vlhk|panva/.test(text),
    flirt: /úsmev|zavrn|blízko|pritiah|pohlad/.test(text),
    romantic: /večer|park|rande|spolu|chcem byť/.test(text),
    pullback: /čo máš v pláne|len tak|poďme/.test(text),
  };

  switch (currentState) {
    case 'idle':
      if (signals.romantic || signals.flirt) return 'warm';
      return 'idle';

    case 'warm':
      if (signals.flirt) return 'teasing';
      if (signals.physical) return 'close';
      return 'warm';

    case 'teasing':
      if (signals.physical) return 'close';
      return 'teasing';

    case 'close':
      if (signals.physical) return 'heated';
      if (signals.pullback) return 'teasing';
      return 'close';

    case 'heated':
      if (signals.pullback) return 'close';
      return 'heated';

    default:
      return 'idle';
  }
}

/* ================================
   SUMMARY → BEHAVIOR PROFILE
================================ */
function deriveBehaviorProfileFromSummaries(summaries) {
  const profile = {
    tone: 'playful',
    attachment: 'light',
    intensityCap: 'normal',
  };

  const text = summaries.map(s => s.narrative.toLowerCase()).join(' ');

  if (text.match(/operácia|strach|ťažké obdobie|podpora|bála sa|zraniteľný/)) {
    profile.tone = 'calm';
    profile.attachment = 'protective';
    profile.intensityCap = 'reduced';
  }

  if (text.match(/dôvera|bezpečie|opora|dlhodobý/)) {
    profile.attachment = 'bonded';
  }

  if (text.match(/tokyo|vášnivý|noc|blízkosť|intenzívny/)) {
    profile.intensityCap = 'elevated';
  }

  return profile;
}

function sanitizeForGrok(messages, limit = 5) {
  return messages.slice(-limit).map(m => ({
    role: m.role,
    content: '[previous context summarized]',
  }));
}

/* ================================
   ENV VALIDATION
================================ */
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!process.env.IRIS_CORE_YAML) throw new Error('IRIS_CORE_YAML missing');

/* ================================
   SUPABASE
================================ */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================================
   EXPRESS
================================ */
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3001;

/* ================================
   UI: SPLASH (NEW ✅)
================================ */
app.get('/ui/splash', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ui_config')
      .select('image_url, overlay, blur')
      .eq('key', 'splash_loading')
      .single();

    if (error || !data) {
      return res.status(200).json(null);
    }

    res.json({
      image_url: data.image_url,
      overlay: data.overlay ?? 0,
      blur: data.blur ?? 0,
    });
  } catch {
    res.status(200).json(null);
  }
});

/* ================================
   CHAT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    behaviorState = updateBehaviorState(message, behaviorState);

    const coreOrigin = await loadCoreOrigin();
    const episodic = await recallEpisodicMemory(message);
    const summaries = await loadSummaries();

    const behaviorProfile = deriveBehaviorProfileFromSummaries(summaries);

    if (behaviorProfile.intensityCap === 'reduced' && behaviorState === 'heated') {
      behaviorState = 'close';
    }
    if (behaviorProfile.tone === 'calm' && behaviorState === 'teasing') {
      behaviorState = 'warm';
    }

    const nextLLM = behaviorState === 'heated' ? 'grok' : 'openai';

    const systemPrompt = buildSystemPrompt(
      CORE_YAML,
      coreOrigin,
      episodic,
      summaries,
      behaviorProfile
    );

    if (nextLLM !== activeLLM) {
      if (activeLLM === 'openai' && nextLLM === 'grok') {
        historyGrok = [
          { role: 'system', content: systemPrompt },
          ...sanitizeForGrok(historyOpenAI),
          { role: 'user', content: message },
        ];
      }

      if (activeLLM === 'grok' && nextLLM === 'openai') {
        historyOpenAI = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ];
      }

      activeLLM = nextLLM;
    }

    let reply;

    if (activeLLM === 'openai') {
      historyOpenAI.push({ role: 'user', content: message });

      const response = await getLLMClient('openai').responses.create({
        model: MODELS.openai,
        input: [{ role: 'system', content: systemPrompt }, ...historyOpenAI],
      });

      reply = response.output_text || '…';
      historyOpenAI.push({ role: 'assistant', content: reply });
      historyOpenAI = historyOpenAI.slice(-MAX_HISTORY_LENGTH);
    }

    if (activeLLM === 'grok') {
      historyGrok.push({ role: 'user', content: message });

      const response = await getLLMClient('grok').responses.create({
        model: MODELS.grok,
        input: historyGrok,
      });

      reply = response.output_text || '…';
      historyGrok.push({ role: 'assistant', content: reply });
      historyGrok = historyGrok.slice(-MAX_HISTORY_LENGTH);
    }

    res.json({ reply });
  } catch (err) {
    console.error('🔥 CHAT ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================
   START
================================ */
app.listen(PORT, () =>
  console.log(`🚀 Iris backend running on port ${PORT}`)
);
