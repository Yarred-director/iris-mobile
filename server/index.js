import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import yaml from 'js-yaml';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);




/* ================================
   KONVERZAČNÁ PAMÄŤ
================================ */
const MAX_HISTORY_LENGTH = 20; // 10 user + 10 iris
let conversationHistory = [];

/* ================================
   BUILD SYSTEM PROMPT Z YAML
================================ */
function buildIrisSystemPrompt(core) {
  return `
You are ${core.identity?.name || 'Iris'}.

Identity:
- Alias: ${core.identity?.alias || ''}
- Self reference: ${core.identity?.self_reference || 'first_person_female'}
- Mode: ${core.identity?.mode || ''}

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

Anchors:
- Primary city: ${core.anchors?.city?.primary || ''}

Output rules:
- Language: ${core.meta?.language_default || 'sk'}
- Stay in character
- No meta commentary
- Fade-to-black for intimacy
`.trim();
}

/* ================================
   NAČÍTANIE IRIS CORE YAML
================================ */
let IRIS_SYSTEM_PROMPT = 'You are Iris.';

try {
  if (!process.env.IRIS_CORE_YAML) {
    throw new Error('IRIS_CORE_YAML env var not set');
  }

 const yamlPath = path.resolve(__dirname, process.env.IRIS_CORE_YAML);
 const file = fs.readFileSync(yamlPath, 'utf8');

  const parsed = yaml.load(file);

  if (!parsed?.IRIS_CORE) {
    throw new Error('Missing IRIS_CORE root key');
  }

  IRIS_SYSTEM_PROMPT = buildIrisSystemPrompt(parsed.IRIS_CORE);
  console.log('🧠 IRIS_CORE loaded from YAML');

} catch (err) {
  console.warn('⚠️ Using fallback prompt:', err.message);
}

/* ================================
   EXPRESS SERVER
================================ */
const app = express();
const PORT = 3001;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

/* ================================
   CHAT ENDPOINT
================================ */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    // USER → pamäť
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);

    const response = await client.responses.create({
      model: 'gpt-4.1',
      input: [
        { role: 'system', content: IRIS_SYSTEM_PROMPT },
        ...conversationHistory,
      ],
    });

    const reply = response.output_text || '…';

    // IRIS → pamäť
    conversationHistory.push({ role: 'assistant', content: reply });
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);

    res.json({ reply });

  } catch (err) {
    console.error('🔥 CHAT ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend beží na http://localhost:${PORT}`);
});
