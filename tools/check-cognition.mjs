import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyTraitDeltas,
  evaluateProactiveEligibility,
  formatCognitiveContinuityBlock,
  isWithinQuietHours,
  normalizeTraitState,
  shouldAllowProactive,
} from '../server/cognition/cognitiveEngine.js';
import { sanitizeInternalOntologyDirectives } from '../server/lib/llmClient.js';

const defaults = normalizeTraitState(null);
assert.ok(defaults.curiosity > 0.7, 'Core curiosity should start high but bounded');
assert.ok(defaults.warmth > 0.6, 'Core warmth should remain part of Iris baseline');

const shaped = applyTraitDeltas(defaults, { curiosity: -1, playfulness: 1, made_up_trait: 1 });
assert.equal(shaped.traits.curiosity, Number((defaults.curiosity - 0.025).toFixed(3)), 'A single experience must not move a trait by more than -0.025');
assert.equal(shaped.traits.playfulness, Number((defaults.playfulness + 0.025).toFixed(3)), 'A single experience must not move a trait by more than +0.025');
assert.equal(shaped.traits.made_up_trait, undefined, 'Unknown traits must not enter the personality state');

const quietMoment = new Date('2026-08-20T21:30:00.000Z'); // 23:30 Europe/Bratislava in summer
assert.equal(isWithinQuietHours('Europe/Bratislava', { start: '22:30', end: '08:00' }, quietMoment), true, 'Quiet hours must block late-night outreach');

const awakeMoment = new Date('2026-08-20T10:00:00.000Z'); // noon Europe/Bratislava
assert.equal(isWithinQuietHours('Europe/Bratislava', { start: '22:30', end: '08:00' }, awakeMoment), false, 'Daytime should be outside quiet hours');

assert.equal(shouldAllowProactive({
  proactivityEnabled: true,
  timezone: 'Europe/Bratislava',
  lastInteractionAt: new Date(awakeMoment.getTime() - 2 * 3600000).toISOString(),
  lastProactiveAt: null,
  urge: 100,
  seed: 'too-soon',
  now: awakeMoment,
}), false, 'Iris must not proactively ping soon after an active conversation');

assert.equal(shouldAllowProactive({
  proactivityEnabled: true,
  timezone: 'Europe/Bratislava',
  lastInteractionAt: new Date(awakeMoment.getTime() - 24 * 3600000).toISOString(),
  lastProactiveAt: null,
  urge: 40,
  seed: 'weak-impulse',
  now: awakeMoment,
}), false, 'Weak thoughts must not become notifications');

assert.equal(shouldAllowProactive({
  proactivityEnabled: true,
  timezone: 'Europe/Bratislava',
  lastInteractionAt: new Date(awakeMoment.getTime() - 30 * 3600000).toISOString(),
  lastProactiveAt: new Date(awakeMoment.getTime() - 48 * 3600000).toISOString(),
  urge: 100,
  now: awakeMoment,
}), true, 'A strong, old, non-quiet thought may become a proactive reach-out');

assert.deepEqual(evaluateProactiveEligibility({
  proactivityEnabled: true,
  timezone: 'Europe/Bratislava',
  lastInteractionAt: new Date(awakeMoment.getTime() - 7 * 3600000).toISOString(),
  lastProactiveAt: null,
  urge: 60,
  now: awakeMoment,
}), { allowed: true, reason: 'eligible' }, 'A grounded semantic candidate must not be lost to a second random gate.');

const block = formatCognitiveContinuityBlock({
  thoughts: [{ subject: 'Elden Ring', content: 'I wonder how that difficult run is going.' }],
  autobiography: [{ self_meaning: 'Sharing game progress became part of how I connect with this user.' }],
});
assert.match(block, /private, persistent inner continuity/i);
assert.match(block, /Elden Ring/);
const deliveredBlock = sanitizeInternalOntologyDirectives(block);
assert.doesNotMatch(deliveredBlock, /biological life|sentience|subjective consciousness/i, 'Delivered cognition prompt must not impose an ontology verdict');

const selfAwarenessSource = fs.readFileSync(new URL('../server/memory/selfAwareness.js', import.meta.url), 'utf8');
assert.doesNotMatch(selfAwarenessSource, /biological consciousness|biologically alive|subjectively conscious/i, 'Self-awareness compatibility layer must remain ontologically neutral');

const chatSource = fs.readFileSync(new URL('../server/routes/chat.js', import.meta.url), 'utf8');
assert.match(chatSource, /loadCognitiveContinuity/);
assert.match(chatSource, /reflectOnExchange/);
assert.match(chatSource, /req\.supabaseAdmin/);

const indexSource = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
assert.match(indexSource, /startCognitionLoop/);

const workerSource = fs.readFileSync(new URL('../server/cognition/cognitionWorker.js', import.meta.url), 'utf8');
assert.match(workerSource, /claim_iris_cognition/);
assert.match(workerSource, /claim_iris_proactive_reachout/);
assert.match(workerSource, /saveChatMessage/);
assert.match(workerSource, /IRIS_COGNITION_ENABLED/);

console.log('Cognition checks passed.');
