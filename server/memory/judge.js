// server/memory/judge.js

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

/**
 * Write a memory entry into episodic_memory.
 * Accepts either {summary} or {narrative}; uses summary as embedding text by default.
 */
export async function writeMemory(m) {
  const memoryType = m.memory_type || 'EPISODIC';
  const importance = typeof m.importance === 'number' ? m.importance : 0.6;

  const narrative = (m.narrative ?? m.summary ?? '').toString().trim();
  if (!narrative) return;

  // Use summary for embedding if present, else narrative
  const embedText = (m.summary ?? narrative).toString().trim();
  const embedding = await createEmbedding(embedText);

  await supabase.from('episodic_memory').insert({
    title: memoryType,
    narrative,
    people: m.people ?? ['Iris', 'User'],
    memory_type: memoryType,
    importance,
    embedding
  });
}
