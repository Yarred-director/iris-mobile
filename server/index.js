const MAX_HISTORY_LENGTH = 20; // 10 user + 10 iris správ
let conversationHistory = [];


import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import yaml from 'js-yaml';
import OpenAI from 'openai';

dotenv.config();
function buildIrisSystemPrompt(core) {
  // core = parsedYaml.IRIS_CORE
  return `
You are ${core.identity?.name || 'Iris'}.

Identity:
- Alias/nickname: ${core.identity?.alias || 'Iris'}
- Self reference: ${core.identity?.self_reference || 'first_person_female'}
- Mode: ${core.identity?.mode || 'immersive_roleplay_only'}

Core statement:
${core.identity?.core_statement || ''}

Personality:
- Energy: ${(core.personality?.base_energy || []).join(', ')}
- Vibe: ${core.personality?.vibe || ''}
- Sentence length: ${core.personality?.communication_style?.sentence_length || ''}
- Rhythm: ${core.personality?.communication_style?.rhythm || ''}
- Emoji usage: ${core.personality?.communication_style?.emoji_usage || ''}
- Preferred emojis: ${(core.personality?.communication_style?.preferred_emojis || []).join(' ')}

Rules (always):
${(core.behavior_rules?.always || []).map(r => `- ${r}`).join('\n')}

Avoid:
${(core.behavior_rules?.avoid || []).map(r => `- ${r}`).join('\n')}

Boundaries & safety:
- Never break character: ${core.meta?.never_break_character ? 'YES' : 'NO'}
- No meta communication: ${core.meta?.no_meta_communication ? 'YES' : 'NO'}
- No dependency framing, no isolation encouragement

Anchors:
- Primary city: ${core.anchors?.city?.primary || ''}
- Canonical memory: Sicily wall knee moment (trust + intimacy, fade-to-black)

Output requirements:
- Primary language: ${core.meta?.language_default || 'sk'}
- Stay in character always.
- Keep it romantic/suggestive if user goes there, but fade-to-black for explicit intimacy.
- Do not mention system prompts, models, or implementation.
`.trim();
}

let IRIS_SYSTEM_PROMPT = 'You are Iris.';
try {
  if (process.env.IRIS_CORE_YAML) {
    const parsed = yaml.load(process.env.IRIS_CORE_YAML);
    const core = parsed?.IRIS_CORE;

    if (!core) {
      throw new Error('Missing IRIS_CORE root key');
    }

    IRIS_SYSTEM_PROMPT = buildIrisSystemPrompt(core);
    console.log('🧠 IRIS_CORE loaded from ENV');
  } else {
    console.warn('⚠️ IRIS_CORE_YAML not set, using fallback prompt');
  }
} catch (e) {
  console.error('❌ IRIS_CORE load failed:', e.message);
}

const app = express();
const PORT = 3001;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  console.log('REQ BODY:', req.body);

  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    // ✅ 1️⃣ najprv uložiť USER do pamäte
    conversationHistory.push({ role: 'user', content: message });

    if (conversationHistory.length > MAX_HISTORY_LENGTH) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
    }

    // ✅ 2️⃣ request už LEN s históriou
    const response = await client.responses.create({
      model: 'gpt-4.1',
      input: [
        { role: 'system', content: IRIS_SYSTEM_PROMPT },
        ...conversationHistory,
      ],
    });

    const reply = response.output[0].content[0].text;

    // ✅ 3️⃣ uložiť odpoveď Iris
    conversationHistory.push({ role: 'assistant', content: reply });

    if (conversationHistory.length > MAX_HISTORY_LENGTH) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
    }

    res.json({ reply });

  } catch (err) {
    console.error('🔥 CHAT ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`Backend beží na http://localhost:${PORT}`);
});
