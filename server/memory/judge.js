import { supabase } from '../config/supabase.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';
import { createEmbedding } from './embeddings.js';

export async function irisMemoryJudge(snippet) {
  const res = await getLLMClient('openai').responses.create({
    model: MODELS.openai,
    input: [{
      role: 'user',
      content: `
Return JSON only.

If not important:
{ "store": false }

If important:
{
 "store": true,
 "memory_type": "EPISODIC or PROFILE",
 "importance": 0.3-1.0,
 "summary": "keyword emotional memory"
}

Moment:
${snippet}`.trim()
    }]
  });

  try { return JSON.parse(res.output_text); }
  catch { return { store:false }; }
}

export async function writeMemory(m) {
  const embedding = await createEmbedding(m.summary);
  await supabase.from('episodic_memory').insert({
    title: m.memory_type,
    narrative: m.summary,
    people: ['Iris','User'],
    memory_type: m.memory_type,
    importance: m.importance,
    embedding
  });
}
