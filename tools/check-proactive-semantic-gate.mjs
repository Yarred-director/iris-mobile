import assert from 'node:assert/strict';
import { processProactiveUser } from '../server/cognition/proactiveDelivery.js';

const now = new Date('2026-09-15T12:00:00Z');
const profile = {
  user_id: 'test-user',
  proactivity_enabled: true,
  user_timezone: 'Europe/Bratislava',
  last_interaction_at: new Date(now.getTime() - 24 * 3600000).toISOString(),
};

const actions = [];
const supabase = {
  async rpc(name, args) {
    if (name === 'claim_iris_proactive_run') {
      return { data: { id: 'run', lease_token: 'lease' }, error: null };
    }
    assert.equal(name, 'finish_iris_proactive_run');
    actions.push(args.p_action);
    return {
      data: args.p_action === 'send'
        ? { status: 'sent', message_id: 'message' }
        : { status: 'skipped', reason: args.p_reason },
      error: null,
    };
  },
};

const candidate = {
  should_reach_out: true,
  message: 'Napadlo mi niečo z nášho posledného rozhovoru.',
  subject: 'unfinished-topic',
  reason: 'grounded callback',
  urge: 1,
};

const result = await processProactiveUser(
  { supabase, profile, selfModel: {}, now, cooldownHours: 16 },
  { decide: async () => candidate },
);

assert.equal(result.sent, true, 'A grounded semantic reach-out must not be vetoed by a second numeric urge threshold');
assert.deepEqual(actions, ['send']);

console.log('Proactive semantic decision gate passed.');
