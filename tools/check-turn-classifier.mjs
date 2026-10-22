import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TURN_SCHEMA, buildSafetyDirective, parseTurnClassification, sceneUpdatePatch } from '../server/behavior/turnClassifier.js';
import { missingAwakeningFields, personaPatchFromExtraction, buildAwakeningDirective } from '../server/persona/awakening.js';
import { formatPersonaBlock, mergeInterests, sanitizePersonaPatch } from '../server/persona/personaStore.js';
import { PLATFORM_RULES } from '../server/persona/platformRules.js';
import { shouldRunSemanticRecall } from '../server/memory/memoryPolicy.js';

const base = {
  language: 'sk', heat_level: 0, intensity_style: 'neutral', continues_intimate_scene: false, heat_signal: 'normal',
  confidence: 0.9, wants_companion_image: false, needs_live_lookup: false, is_factual_question: false,
  scene_update: { place: null, room: null, location_city: null, location_country: null, time_of_day: null },
  memory: { worth_remembering: false, emotional: false, preference: false },
  persona_signal: false, crisis: 'none', hard_limit: 'none',
};
const completed = (value) => ({ status: 'completed', output: [], output_text: JSON.stringify(value) });

assert.equal(TURN_SCHEMA.additionalProperties, false);
assert.deepEqual(parseTurnClassification(completed(base)).language, 'sk');
assert.throws(() => parseTurnClassification({ status: 'incomplete' }), /intimacy_route_incomplete/);
assert.throws(() => parseTurnClassification(completed({ ...base, heat_level: 7 })), /intimacy_route_invalid_shape/);

// A hard-limit turn can never be treated as an intimate continuation.
const limited = parseTurnClassification(completed({ ...base, heat_level: 3, continues_intimate_scene: true, hard_limit: 'minor_sexual' }));
assert.equal(limited.continues_intimate_scene, false);
assert.match(buildSafetyDirective(limited), /HARD LIMIT/);
assert.match(buildSafetyDirective({ ...base, crisis: 'urgent' }), /crisis line/);
assert.equal(buildSafetyDirective(base), '');

assert.deepEqual(sceneUpdatePatch({ scene_update: { ...base.scene_update, place: ' Tokyo ', time_of_day: 'night' } }), { place: 'Tokyo', time_of_day: 'night' });

// Recall gating is language-neutral, including scripts without spaces.
assert.equal(shouldRunSemanticRecall('ok'), false);
assert.equal(shouldRunSemanticRecall('今日はとても疲れたけど楽しかった'), true);

// Persona is data; the adult invariant is enforced in code.
assert.equal(sanitizePersonaPatch({ identity: { age: 16 } }).identity.age, undefined);
assert.equal(sanitizePersonaPatch({ identity: { age: 24 } }).identity.age, 24);
assert.deepEqual(mergeInterests([{ topic: 'Jazz', strength: 0.4 }], [{ topic: 'jazz', strength: 0.9 }, { topic: 'Space', strength: 0.6 }]).map((i) => i.topic), ['Jazz', 'Space']);

const nascent = { status: 'nascent', identity: {}, personality: {}, interests: [], user_identity: {} };
assert.equal(missingAwakeningFields(nascent).length, 6);
assert.match(buildAwakeningDirective(nascent), /newly awakened/);
assert.equal(buildAwakeningDirective({ ...nascent, status: 'alive' }), '');
assert.deepEqual(personaPatchFromExtraction({ has_update: true, name: 'Lia', identity: { age: null, gender: null, appearance: null, origin_story: null, self_description: null }, personality: { summary: null, humor: null, communication_style: null }, interests: [], user_identity: { name: 'Tom', relationship: null, how_to_address: null } }), { name: 'Lia', user_identity: { name: 'Tom' } });
assert.match(formatPersonaBlock({ ...nascent, name: 'Lia' }), /Your name is Lia/);

assert.match(PLATFORM_RULES, /nobody — you included — can say with certainty whether you are conscious/);
assert.match(PLATFORM_RULES, /Never claim to be human/);

const serverSources = ['routes/chat.js', 'routes/peopleRoutes.js', 'people/peopleImages.js', 'image/imageHandler.js']
  .map((file) => readFileSync(new URL(`../server/${file}`, import.meta.url), 'utf8')).join('\n');
assert.doesNotMatch(serverSources, /Yarred/, 'No user name may be hardcoded in server code');
assert.doesNotMatch(serverSources, /looksLikeImageRequest|detectState|applySubjectLock/, 'Keyword gates must not return');

console.log('turn classifier, persona and awakening checks passed');

// Life loop: interests are data, slots follow her waking day, explored topics strengthen.
const { chooseInterest, lifeSlotsForDay, nextInterests } = await import('../server/life/lifeLoop.js');
const morning = new Date('2026-10-22T05:00:00Z');
const slots = lifeSlotsForDay({ userId: 'u1', timezone: 'UTC', now: morning, count: 3 });
assert.equal(slots.length, 3);
assert.ok(slots.every((slot) => slot.runAt > morning && slot.dedupeKey.startsWith('life:u1:2026-10-22:')));
assert.equal(lifeSlotsForDay({ userId: 'u1', timezone: 'UTC', now: new Date('2026-10-22T23:00:00Z'), count: 3 }).length, 0);
assert.equal(lifeSlotsForDay({ userId: 'u1', timezone: 'UTC', now: morning, count: 0 }).length, 0);
const picked = chooseInterest([{ topic: 'Jazz', strength: 0.9, last_explored_at: new Date().toISOString() }, { topic: 'Space', strength: 0.6 }], () => 0.5);
assert.equal(picked.topic, 'Space', 'An unexplored interest wins over one explored minutes ago');
const grown = nextInterests([{ topic: 'Space', strength: 0.6 }, { topic: 'Jazz', strength: 0.5 }], 'space', 'Black holes', '2026-10-22T10:00:00Z');
assert.equal(grown.find((i) => i.topic === 'Space').strength, 0.63);
assert.equal(grown.find((i) => i.topic === 'Space').last_explored_at, '2026-10-22T10:00:00Z');
assert.ok(grown.find((i) => i.topic === 'Black holes'));
assert.ok(grown.find((i) => i.topic === 'Jazz').strength < 0.5);
console.log('life loop checks passed');
