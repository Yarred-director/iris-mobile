/**
 * One-time repair script
 * Fixes missing embedding on CORE_ORIGIN memory
 * SAFE + ROBUST VERSION
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import OpenAI from 'openai';

// ---------- CONFIG ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- MAIN ----------
async function repairCoreOriginEmbedding() {
  console.log('🔧 Starting CORE_ORIGIN embedding repair...');

  // 1. Load all memories (no schema prefix, no fragile filters)
  const { data: rows, error } = await supabase
    .from('episodic_memory')
    .select('id, memory_type, narrative, embedding');

  if (error) {
    throw error;
  }

  // 2. Robustly locate CORE_ORIGIN
  const core = rows.find(
    r =>
      typeof r.memory_type === 'string' &&
      r.memory_type.trim().toUpperCase() === 'CORE_ORIGIN'
  );

  if (!core) {
    throw new Error('CORE_ORIGIN not found in DB');
  }

  if (core.embedding) {
    console.log('✅ CORE_ORIGIN already has embedding. Nothing to do.');
    return;
  }

  console.log('🧠 Generating embedding for CORE_ORIGIN...');

  // 3. Generate embedding
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: core.narrative,
  });

  const embedding = embeddingResponse.data[0].embedding;

  // 4. Update DB
  const { error: updateError } = await supabase
    .from('episodic_memory')
    .update({ embedding })
    .eq('id', core.id);

  if (updateError) {
    throw updateError;
  }

  console.log('✅ CORE_ORIGIN embedding successfully repaired');
}

// ---------- RUN ----------
repairCoreOriginEmbedding()
  .then(() => {
    console.log('🎉 DONE');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ FAILED:', err);
    process.exit(1);
  });
