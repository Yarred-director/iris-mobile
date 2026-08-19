import assert from 'node:assert/strict';
import {
  normalizeMemoryAssessment,
  reinforceRecalledMemories,
  REINFORCEMENT_COOLDOWN_HOURS,
  selectMemoriesForReinforcement,
} from '../server/memory/memoryQuality.js';

const normalized = normalizeMemoryAssessment({
  should_store: true,
  importance: 1.4,
  emotional_weight: -5,
});
assert.equal(normalized.should_store, true);
assert.equal(normalized.importance, 1, 'Importance must clamp to 1.0.');
assert.equal(normalized.emotional_weight, 0, 'Emotional weight must clamp to 0-100.');

const fallback = normalizeMemoryAssessment(null);
assert.equal(fallback.should_store, true);
assert.equal(fallback.importance, 0.65);
assert.equal(fallback.emotional_weight, 50);

const memories = [
  { id: 'a', similarity: 0.82 },
  { id: 'b', similarity: 0.61 },
  { id: 'a', similarity: 0.60 },
  { id: 'low', similarity: 0.34 },
  { id: 'c', similarity: 0.55 },
  { id: 'd', similarity: 0.48 },
  { id: 'e', similarity: 0.45 },
];
assert.deepEqual(
  selectMemoriesForReinforcement(memories),
  ['a', 'b', 'c', 'd'],
  'Only confident unique memories should be reinforced, capped at four.',
);

let rpcName = null;
let rpcArgs = null;
const supabase = {
  rpc: async (name, args) => {
    rpcName = name;
    rpcArgs = args;
    return {
      data: [
        { id: 'a', reinforcement_count: 1 },
        { id: 'b', reinforcement_count: 2 },
      ],
      error: null,
    };
  },
};

const result = await reinforceRecalledMemories({
  supabase,
  userId: 'user-1',
  memories,
});
assert.equal(rpcName, 'reinforce_episodic_memories');
assert.equal(rpcArgs.p_user_id, 'user-1');
assert.deepEqual(rpcArgs.p_memory_ids, ['a', 'b', 'c', 'd']);
assert.equal(rpcArgs.p_cooldown_hours, REINFORCEMENT_COOLDOWN_HOURS);
assert.equal(result.attempted, 4);
assert.equal(result.reinforced, 2);

console.log('Memory importance and reinforcement regression test passed.');
