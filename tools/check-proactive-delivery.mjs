import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cognitionError, decideProactiveMessage, parseCompletedJson } from '../server/cognition/proactiveDecision.js';
import { processProactiveUser, deliverPendingProactiveNotifications } from '../server/cognition/proactiveDelivery.js';
import { runBackgroundReflection, reflectOnExchange } from '../server/cognition/cognitiveEngine.js';
import { loadUserImageProvider, saveUserImageProvider } from '../server/image/imageProvider.js';

const candidate = { should_reach_out: true, message: 'Ako dopadol rozhovor v práci?', subject: 'Práca', reason: 'Unfinished topic from our conversation', urge: 80 };
const completed = (value) => ({ status: 'completed', output_text: JSON.stringify(value) });
const incomplete = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"self_patch":' };
const refused = { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] };
assert.throws(() => parseCompletedJson(incomplete), { code: 'cognition_incomplete' });
assert.throws(() => parseCompletedJson(refused), { code: 'cognition_refused' });
assert.throws(() => parseCompletedJson({ ...incomplete, incomplete_details: { reason: 'content_filter' } }), { code: 'cognition_refused' });
assert.throws(() => parseCompletedJson(completed([])), { code: 'cognition_invalid_json' });

const calls = [];
const llmClient = { responses: { create: async (args) => { calls.push(args); return calls.length === 1 ? incomplete : completed(candidate); } } };
assert.deepEqual(await decideProactiveMessage({ llmClient, model: 'test' }), candidate);
assert.equal(calls.length, 2);
assert.equal(calls[0].text.format.strict, true);
assert.ok(calls[1].max_output_tokens > calls[0].max_output_tokens);
let refusedCalls = 0;
await assert.rejects(decideProactiveMessage({ llmClient: { responses: { create: async () => { refusedCalls++; return refused; } } } }), { code: 'cognition_refused' });
assert.equal(refusedCalls, 1, 'Refusal is not retried as a format error');
let incompleteCalls = 0;
await assert.rejects(decideProactiveMessage({ llmClient: { responses: { create: async () => { incompleteCalls++; return incomplete; } } } }), { code: 'cognition_incomplete' });
assert.equal(incompleteCalls, 2, 'Formatting recovery is bounded');

const brokenReflection = { llmClient: { responses: { create: async () => incomplete } } };
await assert.rejects(runBackgroundReflection(brokenReflection), { code: 'cognition_incomplete' });
assert.equal(await reflectOnExchange({ ...brokenReflection, supabase: {}, userId: 'test', userText: 'Hello', irisReply: 'Hello' }), false);

const now = new Date('2026-09-01T12:00:00Z');
const profile = { user_id: 'test-user', proactivity_enabled: true, user_timezone: 'Europe/Bratislava', last_interaction_at: '2026-08-28T12:00:00Z' };
function store({ failInsert = false, lostResponse = false } = {}) {
  const state = { claimed: false, actions: [], messages: [], cooldown: null };
  return { state, async rpc(name, args) {
    if (name === 'claim_iris_proactive_run') {
      if (state.claimed) return { data: null };
      state.claimed = true;
      return { data: { id: 'run', lease_token: 'lease' } };
    }
    assert.equal(name, 'finish_iris_proactive_run');
    state.actions.push(args.p_action);
    if (state.messages.length) return { data: { status: 'sent', message_id: 'message' } };
    if (args.p_action === 'send') {
      if (failInsert) return { error: new Error('insert failed') };
      state.messages.push(args.p_message);
      state.cooldown = now;
      if (lostResponse) return { error: new Error('connection lost after commit') };
      return { data: { status: 'sent', message_id: 'message' } };
    }
    return { data: { status: args.p_action === 'skip' ? 'skipped' : 'error' } };
  } };
}
const db = store();
const context = { supabase: db, profile, selfModel: {}, now };
const options = { decide: async () => candidate };
const race = await Promise.all([processProactiveUser(context, options), processProactiveUser(context, options)]);
assert.equal(race.filter((r) => r.sent).length, 1);
assert.equal(db.state.messages.length, 1);
for (const changed of [{ proactivity_enabled: false }, { last_interaction_at: now.toISOString() }, { user_timezone: 'UTC', proactivity_quiet_hours: { start: '11:00', end: '13:00' } }]) {
  const blocked = store();
  const result = await processProactiveUser({ ...context, supabase: blocked, profile: { ...profile, ...changed } }, { decide: () => { throw new Error('Must not call model'); } });
  assert.equal(result.sent, false);
  assert.equal(blocked.state.claimed, false);
}
const noCandidate = store();
assert.equal((await processProactiveUser({ ...context, supabase: noCandidate }, { decide: async () => ({ ...candidate, should_reach_out: false }) })).reason, 'no_grounded_candidate');
assert.deepEqual(noCandidate.state.actions, ['skip']);
for (const [error, action] of [[cognitionError('cognition_incomplete'), 'error'], [cognitionError('cognition_refused'), 'terminal_error'], [Object.assign(new Error(), { status: 403 }), 'terminal_error']]) {
  const failed = store();
  const result = await processProactiveUser({ ...context, supabase: failed }, { decide: async () => { throw error; } });
  assert.equal(result.error, true);
  assert.deepEqual(failed.state.actions, [action]);
  assert.equal(failed.state.cooldown, null);
}
const failDb = store({ failInsert: true });
assert.equal((await processProactiveUser({ ...context, supabase: failDb }, options)).sent, false);
assert.equal(failDb.state.cooldown, null);
assert.deepEqual(failDb.state.actions, ['send', 'error']);
const lostDb = store({ lostResponse: true });
assert.equal((await processProactiveUser({ ...context, supabase: lostDb }, options)).sent, true);
assert.equal(lostDb.state.messages.length, 1);

// In-memory PostgREST-shaped store exercises the actual push claim/transition code.
function pushStore(attempts = 0) {
  const row = { id: 'run', user_id: 'test-user', message_id: 'msg', push_status: 'pending', push_attempts: attempts, push_next_at: now.toISOString() };
  return { row, from(table) {
    let patch; const filters = [];
    const query = {
      select() { return this; }, update(value) { patch = value; return this; },
      eq(key, value) { filters.push((r) => r[key] === value); return this; },
      in(key, values) { filters.push((r) => values.includes(r[key])); return this; },
      lte(key, value) { filters.push((r) => r[key] <= value); return this; },
      order() { return this; }, limit() { return this; },
      maybeSingle() { return this.execute(true); },
      execute(single = false) {
        if (table === 'chat_messages') return Promise.resolve({ data: { content: candidate.message } });
        const matches = filters.every((f) => f(row));
        if (matches && patch) Object.assign(row, patch);
        return Promise.resolve({ data: single ? (matches ? { ...row } : null) : (matches ? [{ ...row }] : []) });
      }, then(resolve, reject) { return this.execute().then(resolve, reject); },
    };
    return query;
  } };
}
for (const [summary, expected, attempts] of [
  [{ accepted: 1, failed: 0, subscriptions: 1 }, 'accepted', 0],
  [{ accepted: 0, failed: 0, subscriptions: 0 }, 'unavailable', 0],
  [{ accepted: 0, failed: 1, subscriptions: 1 }, 'retry', 0],
  [{ accepted: 0, failed: 1, subscriptions: 1 }, 'failed', 2],
]) {
  const pushDb = pushStore(attempts);
  let sent = 0;
  await Promise.all([1, 2].map(() => deliverPendingProactiveNotifications({ supabase: pushDb, now, notify: async () => { sent++; return summary; } })));
  assert.equal(sent, 1, 'Concurrent push drain must claim one delivery');
  assert.equal(pushDb.row.push_status, expected);
}

function providerStore(data, error = null) {
  const query = { select() { return this; }, eq() { return this; }, upsert() { return this; }, maybeSingle: async () => ({ data, error }), single: async () => ({ data, error }) };
  return { from: () => query };
}
await assert.rejects(loadUserImageProvider(providerStore(null, { message: 'db unavailable' }), 'user'), /image_provider_store_unavailable/);
await assert.rejects(loadUserImageProvider(providerStore(null), 'user'), /image_provider_not_configured/);
await assert.rejects(saveUserImageProvider(providerStore(null), 'user', 'kling_o3'), /image_provider_verify_failed/);
assert.equal(await loadUserImageProvider(providerStore({ image_provider: 'grok_imagine_2' }), 'user'), 'grok_imagine_2');
const ui = fs.readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(ui, /setImageProvider\(payload\.image_provider\)/);
assert.doesNotMatch(ui, /provider === imageProvider\) return/);
assert.match(ui, /request !== providerRequestRef\.current/);
assert.match(ui, /useState<ImageProvider \| null>\(null\)/);
console.log('Proactive decisions, recovery, push delivery and provider failure checks passed.');
