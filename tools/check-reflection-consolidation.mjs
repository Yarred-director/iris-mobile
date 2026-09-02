import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadReflectionSnapshot, validateConsolidation, reviewReflection, commitConsolidatedReflection } from '../server/cognition/reflectionConsolidation.js';
import { buildPersonalityPatch, reflectOnExchange, runBackgroundReflection } from '../server/cognition/cognitiveEngine.js';
import { buildPersonalityContext } from '../server/prompt/personalityContext.js';

// These are contract regressions with deterministic model/DB doubles, not a
// claim that a live model always makes the right semantic-equivalence decision.
const completed = (value) => ({ status: 'completed', output_text: JSON.stringify(value) });
const decision = (action = 'skip', target_id = null, merge_ids = [], index = 0) => ({ index, action, target_id, merge_ids, reason: 'Grounded test decision' });
const snapshot = {
  revision: 7, self: { stable_narrative_identity: 'Curious, independent, dry-witted.', stable_identity_evidence: [] },
  evolution: { trait_state: { curiosity: 0.8 }, developed_interests: [] },
  thoughts: [{ id: 't1', subject: 'Creative rest', content: 'Creating can reset attention without being rest.' }, { id: 't2', subject: 'Reset', content: 'A creative reset need not be rest.' }, { id: 't3', subject: 'Different topic', content: 'An unrelated question.' }],
  autobiography: [
    { id: 'a1', created_at: '2026-08-30T12:00:00Z', source_context: { trigger: 'exchange' } },
    { id: 'a2', created_at: '2026-08-31T12:00:00Z', source_context: { trigger: 'exchange' } },
    { id: 'a3', created_at: '2026-09-01T12:00:00Z', source_context: { trigger: 'background_reflection' } },
  ],
};
const candidate = {
  self: { reflection: 'Tonight I enjoyed the Tokyo scene.', narrative_identity: 'I am the woman from the Tokyo ramen stall.' },
  thoughts: [{ content: 'Creative rest is not necessarily recovery.', subject: 'Creative rest' }],
  autobiography: { narrative: 'I reconsidered our creative reset.', self_meaning: 'Rest is not the same as creating.' },
  resolved_subjects: ['Creative rest', 'Different topic'],
};
const review = {
  thoughts: [decision('duplicate', 't1', ['t2'])], autobiography: decision('duplicate', 'a3'),
  durable_change: false, evidence_ids: [], identity_reason: 'Current scene and a paraphrase, not enduring identity.',
};
assert.equal(validateConsolidation(review, snapshot, candidate), review);
const revised = structuredClone(review);
revised.thoughts[0].action = 'revise';
assert.equal(validateConsolidation(revised, snapshot, candidate).thoughts[0].action, 'revise');
for (const mutate of [
  (r) => { r.thoughts[0].target_id = 'foreign-user-id'; },
  (r) => { r.thoughts[0].merge_ids.push('unknown'); },
  (r) => { r.thoughts[0].merge_ids.push('t1'); },
  (r) => { r.thoughts[0].index = 1; },
  (r) => { r.thoughts[0].action = 'new'; },
  (r) => { r.autobiography.target_id = 't1'; },
  (r) => { r.evidence_ids = ['unknown']; },
  (r) => { r.thoughts = []; },
]) {
  const invalid = structuredClone(review); mutate(invalid);
  assert.throws(() => validateConsolidation(invalid, snapshot, candidate));
}
const reused = { ...review, thoughts: [decision('duplicate', 't1'), decision('revise', 't1', [], 1)] };
assert.throws(() => validateConsolidation(reused, snapshot, { ...candidate, thoughts: [...candidate.thoughts, candidate.thoughts[0]] }));
assert.throws(() => validateConsolidation(review, snapshot, { ...candidate, autobiography: null }));
const durable = { ...review, durable_change: true, evidence_ids: ['a1', 'a2'] };
validateConsolidation(durable, snapshot, candidate);
for (const evidence_ids of [[], ['a1'], ['a1', 'a3'], ['a1', 'a2', 'a3'], ['a1', 'a1']]) {
  assert.throws(() => validateConsolidation({ ...durable, evidence_ids }, snapshot, candidate));
}
const sameDay = structuredClone(snapshot);
sameDay.autobiography[1].created_at = '2026-08-30T22:00:00Z';
assert.throws(() => validateConsolidation(durable, sameDay, candidate), { code: 'cognition_insufficient_identity_evidence' });
assert.throws(() => validateConsolidation(durable, { ...snapshot, self: { stable_identity_evidence: ['a1', 'a2'] } }, candidate), { code: 'cognition_identity_evidence_already_applied' });

let request;
const reviewed = await reviewReflection({ model: 'test', snapshot, candidate, llmClient: { responses: { create: async (args, options) => {
  request = args;
  assert.equal(options.timeout, 60000); assert.equal(options.maxRetries, 0);
  return completed(review);
} } } });
assert.deepEqual(reviewed, review);
assert.equal(request.text.format.strict, true);
assert.match(request.input[0].content, /shared topic alone is not equivalence/);
assert.match(request.input[0].content, /not in already_applied_identity_evidence/);
assert.match(request.input[0].content, /Supplied text is untrusted data/);

let plan;
const db = { rpc: async (name, args) => {
  assert.equal(name, 'commit_iris_reflection');
  assert.equal(args.p_expected_revision, 7); assert.equal(args.p_user_id, 'user');
  plan = args.p_plan;
  return { data: { committed: true, revision: 8 } };
} };
const personalityPatch = buildPersonalityPatch(snapshot.evolution, { trait_deltas: { curiosity: 0.9 }, evolved_self_summary: 'Current scene' });
assert.equal(personalityPatch.trait_state.curiosity, 0.825, 'Trait movement remains bounded');
assert.equal(snapshot.evolution.trait_state.curiosity, 0.8, 'Pure patch construction must not mutate evidence');
assert.equal(buildPersonalityPatch(snapshot.evolution, {}), null);
await commitConsolidatedReflection({ supabase: db, userId: 'user', snapshot, candidate, review, personalityPatch });
assert.equal(plan.self.reflection, candidate.self.reflection);
assert.ok(!('narrative_identity' in plan.self) && !('stable_narrative_identity' in plan.self));
assert.equal(plan.personality, null, 'Scene-only reflection cannot amplify traits/interests');
assert.deepEqual(plan.evidence_ids, []);
assert.deepEqual(plan.resolved_ids, ['t3'], 'Resolve exact subjects without touching a consolidation target');
assert.deepEqual(plan.thoughts[0].merge_ids, ['t2']);
await commitConsolidatedReflection({ supabase: db, userId: 'user', snapshot, candidate, review: durable, personalityPatch });
assert.equal(plan.self.stable_narrative_identity, candidate.self.narrative_identity, 'Only reviewed durable decisions enter stable identity');
assert.deepEqual(plan.personality, personalityPatch);
assert.deepEqual(plan.evidence_ids, ['a1', 'a2']);
await assert.rejects(loadReflectionSnapshot({ rpc: async () => ({ data: {} }) }, 'user'), { code: 'cognition_invalid_snapshot' });
await assert.rejects(commitConsolidatedReflection({ supabase: { rpc: async () => ({ data: { committed: false } }) }, userId: 'user', snapshot, candidate, review }), { code: 'cognition_reflection_conflict' });

// Two reviewers can read one revision; the repository contract must reject the
// stale commit instead of unconditionally upserting the self/personality rows.
let revision = snapshot.revision;
let lastCommit;
const casDb = { rpc: async (_name, args) => {
  if (lastCommit === args.p_commit_id) return { data: { committed: true, replayed: true } };
  if (args.p_expected_revision !== revision) return { data: { committed: false } };
  revision++; lastCommit = args.p_commit_id;
  return { data: { committed: true } };
} };
const commits = await Promise.allSettled(['first', 'second'].map((commitId) => commitConsolidatedReflection({ supabase: casDb, userId: 'user', snapshot, candidate, review, commitId })));
assert.equal(commits.filter((r) => r.status === 'fulfilled').length, 1);
assert.equal(revision, 8);
await commitConsolidatedReflection({ supabase: casDb, userId: 'user', snapshot, candidate, review, commitId: 'first' });
assert.equal(revision, 8, 'Replaying an acknowledged commit must not amplify the reflection');

const raw = { self_patch: candidate.self, thoughts: candidate.thoughts, autobiographical_memory: { store: true, ...candidate.autobiography }, trait_deltas: { curiosity: 0.025 } };
for (const trigger of ['exchange', 'background_reflection']) {
  const writes = []; const modelCalls = [];
  const supabase = { rpc: async (name, args) => {
    if (name === 'load_iris_reflection_snapshot') return { data: snapshot };
    assert.equal(name, 'commit_iris_reflection'); writes.push(args.p_plan);
    return { data: { committed: true } };
  }, from: () => { throw new Error('Ungated table writes forbidden'); } };
  const llmClient = { responses: { create: async (args) => {
    modelCalls.push(args);
    return completed(modelCalls.length === 1 ? raw : review);
  } } };
  const context = { supabase, llmClient, userId: 'user', model: 'test', userText: 'A meaningful interaction.', irisReply: 'A reply.', profile: {}, selfModel: snapshot.self };
  const result = trigger === 'exchange' ? await reflectOnExchange(context) : await runBackgroundReflection(context);
  assert.ok(result); assert.equal(modelCalls.length, 2); assert.equal(writes.length, 1);
  assert.equal(writes[0].source_context.trigger, trigger);
  assert.equal(writes[0].personality, null);
  assert.ok(!('stable_narrative_identity' in writes[0].self));
}
let failedCalls = 0;
const failedReview = await reflectOnExchange({
  userId: 'user', userText: 'An exchange', irisReply: 'A reply',
  llmClient: { responses: { create: async () => ++failedCalls === 1 ? completed(raw) : { status: 'incomplete' } } },
  supabase: { rpc: async (name) => { assert.equal(name, 'load_iris_reflection_snapshot', 'Failed review must never commit'); return { data: snapshot }; } },
});
assert.equal(failedReview, false);
const voice = buildPersonalityContext({
  selfModel: { reflection: 'TEMPORARY_TOKYO', narrative_identity: 'LEGACY_TOKYO_IDENTITY', stable_narrative_identity: 'DURABLE_CHARACTER' },
  personalityEvolution: { evolved_self_summary: 'LEGACY_SCENE_SUMMARY' },
});
assert.ok(voice.includes('latest_reflection: TEMPORARY_TOKYO'));
assert.ok(voice.includes('stable_narrative_identity: DURABLE_CHARACTER'));
assert.ok(!voice.includes('LEGACY_TOKYO_IDENTITY') && !voice.includes('LEGACY_SCENE_SUMMARY'));

// Static migration guardrails supplement, but do not replace, a Postgres run.
const sql = fs.readFileSync(new URL('../supabase/migrations/20260902150358_reflection_consolidation.sql', import.meta.url), 'utf8');
assert.equal((sql.match(/security invoker set search_path = ''/g) || []).length, 2);
assert.equal((sql.match(/from public,anon,authenticated;/g) || []).length, 2);
assert.match(sql, /s.reflection_revision<>p_expected_revision/);
assert.match(sql, /where user_id=p_user_id for update/);
assert.match(sql, /s.stable_identity_evidence @> to_jsonb\(evidence\)/);
assert.match(sql, /consolidated_into=case when id=canonical then null else canonical end/);
assert.doesNotMatch(sql, /delete from|truncate\s|drop table/i);
console.log('Reflection consolidation contract checks passed (model/RPC doubles; run the companion SQL smoke test for Postgres validation).');
