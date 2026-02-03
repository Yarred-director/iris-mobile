import { supabase } from '../config/supabase.js';

export async function reinforceMemory(id) {
  try {
    if (!id) return;
    await supabase.rpc('reinforce_memory', { mem_id: id, boost: 0.05 });
  } catch (e) {
    console.error('[reinforce] reinforce_memory failed', e?.message || e);
  }
}

export async function decayMemories() {
  try {
    await supabase.rpc('decay_memories', { decay_rate: 0.001 });
  } catch (e) {
    console.error('[reinforce] decay_memories failed', e?.message || e);
  }
}