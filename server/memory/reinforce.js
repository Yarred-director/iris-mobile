import { supabase } from '../config/supabase.js';

export async function reinforceMemory(id) {
  await supabase.rpc('reinforce_memory', { mem_id: id, boost: 0.05 });
}

export async function decayMemories() {
  await supabase.rpc('decay_memories', { decay_rate: 0.001 });
}
