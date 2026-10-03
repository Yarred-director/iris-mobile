import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractImageIntent } from '../server/image/imageIntentDetector.js';
import { generateIrisImage } from '../server/image/imageGen.js';
import { validateImagePrompt } from '../server/image/imagePromptBudget.js';
import { serializePhysicalIdentityForImageProvider, validatePhysicalIdentityImagePrompt } from '../server/image/physicalIdentitySerialization.js';

// Fixtures are canonical data, never application defaults or a user special case.
const traits = Object.freeze({
  height: 'approximately 175 cm',
  build: 'tall and slim model-like physique, lean feminine fit body',
  legs: 'long slender model-like legs',
  waist: 'narrow defined waist',
  hips: 'medium proportionate hips',
  bust: 'surgically augmented 32DD, very full, rounded, high-projection, natural-looking augmented breasts',
  skin: 'pale skin',
  freckles: 'strong natural freckles across face, chest and upper bust',
});
const body = Object.entries(traits).map(([key, value]) => `${key}: ${value}.`).join(' ');
const identity = Object.freeze({ body_description: body, traits, source: 'explicit_user', confidence: 1 });
const original = JSON.stringify(identity);
const anatomical = /\b32DD\b|\bbreasts?\b|\bhigh[- ]projection\b|\bsurgically\b|\bcup[- ]?size\b|\b[A-K]{1,3}[- ]cup\b/i;
const neutral = serializePhysicalIdentityForImageProvider({ physicalIdentity: identity, provider: 'openai_gpt_image_2', sexualized: false });
assert.doesNotMatch(neutral, anatomical);
assert.match(neutral, /augmented big chest, glamorous bombshell look/);
for (const value of ['175 cm', 'tall and slim', 'long slender', 'narrow defined waist', 'medium proportionate hips', 'pale skin', 'strong natural freckles']) assert.ok(neutral.includes(value), `Lost body trait: ${value}`);
assert.doesNotMatch(neutral, /chest and upper bust/);

for (const provider of ['grok_imagine_2', 'kling_o3', 'qwen_image_max', 'nano-banana-2']) {
  assert.equal(serializePhysicalIdentityForImageProvider({ physicalIdentity: identity, provider, sexualized: false }), body);
}
for (const sexualized of [true, undefined, null]) {
  assert.equal(serializePhysicalIdentityForImageProvider({ physicalIdentity: identity, provider: 'openai_gpt_image_2', sexualized }), body, 'Only explicit nonsexual requests use neutral serialization');
}
assert.equal(serializePhysicalIdentityForImageProvider({ physicalIdentity: null, provider: 'openai_gpt_image_2', sexualized: false }), '');
const smallIdentity = { traits: { height: '160 cm', build: 'curvy adult figure', bust: 'small natural bust' } };
const small = serializePhysicalIdentityForImageProvider({ physicalIdentity: smallIdentity, provider: 'openai_gpt_image_2', sexualized: false });
assert.match(small, /160 cm|curvy adult figure/);
assert.match(small, /small chest/);
assert.doesNotMatch(small, /augment|bombshell|175|tall|slim/, 'Never invent current Iris traits for a different identity');
const legacy = serializePhysicalIdentityForImageProvider({ physicalIdentity: { body_description: body }, provider: 'openai_gpt_image_2', sexualized: false });
assert.doesNotMatch(legacy, anatomical);
assert.match(legacy, /175 cm/);
assert.match(legacy, /augmented big chest/);
const partial = serializePhysicalIdentityForImageProvider({ physicalIdentity: { body_description: body, traits: { bust: traits.bust } }, provider: 'openai_gpt_image_2', sexualized: false });
assert.match(partial, /175 cm/);
assert.match(partial, /long slender/);
assert.throws(() => validatePhysicalIdentityImagePrompt({ prompt: '32DD breasts', provider: 'openai_gpt_image_2', sexualized: false }), { code: 'image_identity_serialization_invalid' });
validatePhysicalIdentityImagePrompt({ prompt: '32DD breasts', provider: 'openai_gpt_image_2', sexualized: true });
validatePhysicalIdentityImagePrompt({ prompt: '32DD breasts', provider: 'grok_imagine_2', sexualized: false });

let capturedContext;
function composer({ scene, scope = 'standalone', outfit = null, fail = false, empty = false, sexualized = false }) {
  return { responses: { create: async ({ input, text }) => {
    if (text?.format?.name === 'iris_image_request_scope') return { status: 'completed', output: [], output_text: JSON.stringify({ request_scope: scope, sexualized, confidence: 1, signal: scope === 'standalone' ? 'generic_photo' : 'specified_scene', outfit_override: outfit }) };
    capturedContext = JSON.parse(input.find((item) => item.content.startsWith('Resolved visual/activity context')).content.split('\n').slice(1).join('\n'));
    if (fail) throw new Error('mock composer unavailable');
    // Echo the identity the composer actually receives, detecting raw-data leaks.
    return { output_text: JSON.stringify({ prompt: empty ? '' : `${scene} ${capturedContext.USER_DEFINED_PHYSICAL_IDENTITY.body_description || ''}`, explicit: false, framing: scope === 'standalone' ? 'three_quarter' : 'full_body' }) };
  } } };
}
const bedtime = 'Iris in ordinary cotton pajamas, sleepy morning expression, sitting on her bed in soft morning light.';
const refs = ['https://example.invalid/front', 'https://example.invalid/three-quarter', 'https://example.invalid/side'];
const originalFetch = globalThis.fetch;
const originalKey = process.env.FAL_KEY;
const originalLog = console.log;
const logs = [];
let payload;
let calls = 0;
process.env.FAL_KEY = 'test-placeholder';
console.log = (...args) => logs.push(args);
globalThis.fetch = async (url, options) => {
  calls += 1;
  payload = { url, body: JSON.parse(options.body) };
  return new Response(JSON.stringify({ detail: [{ type: 'content_policy_violation', loc: ['body', 'prompt'] }] }), { status: 422, headers: { 'x-fal-request-id': 'test-policy-rejection' } });
};
try {
  for (const provider of ['openai_gpt_image_2', 'grok_imagine_2', 'kling_o3']) {
    const intent = await extractImageIntent({ text: 'dobre ranko, posles mi tvoju rozospatu fotku z postele', physicalIdentity: identity, provider, llmClient: composer({ scene: bedtime }), model: 'mock' });
    assert.equal(intent.sexualized, false);
    assert.equal(intent.requestScope, 'standalone');
    assert.equal(intent.framing, 'three_quarter');
    const before = calls;
    await assert.rejects(generateIrisImage({ prompt: intent.prompt, provider, imageUrls: refs }), (error) => error.status === 422 && error.moderationStage === 'body.prompt');
    assert.equal(calls, before + 1, 'Moderation rejection must not retry or switch providers');
    assert.deepEqual(payload.body.image_urls, refs);
    validateImagePrompt(provider, payload.body.prompt);
    assert.match(payload.body.prompt, /clearly adult woman/i);
    assert.match(payload.body.prompt, /references.*facial|facial identity|facial views/i);
    if (provider === 'openai_gpt_image_2') {
      assert.equal(payload.url, 'https://fal.run/openai/gpt-image-2.5/sunburst/edit');
      assert.doesNotMatch(JSON.stringify(capturedContext.USER_DEFINED_PHYSICAL_IDENTITY), anatomical);
      assert.doesNotMatch(payload.body.prompt, anatomical);
      assert.match(payload.body.prompt, /augmented big chest/);
      assert.match(payload.body.prompt, /tall and slim/);
      assert.match(payload.body.prompt, /ordinary cotton pajamas.*sleepy morning/);
    } else {
      assert.equal(capturedContext.USER_DEFINED_PHYSICAL_IDENTITY.body_description, body.slice(0, 700));
      assert.match(intent.prompt, /32DD/);
      assert.match(intent.prompt, /high-projection/);
      assert.ok(intent.prompt.includes(body), 'Other providers must receive the exact existing identity directive');
    }
  }
  for (const mode of [{ fail: true }, { empty: true }]) {
    const intent = await extractImageIntent({ text: 'send me a sleepy morning photo from bed', provider: 'openai_gpt_image_2', physicalIdentity: identity, llmClient: composer({ scene: bedtime, ...mode }), model: 'mock' });
    assert.doesNotMatch(intent.prompt, anatomical, 'Fallback paths must use the same provider projection');
    assert.match(intent.prompt, /augmented big chest/);
    assert.equal(intent.sexualized, false);
  }
  const reintroduced = await extractImageIntent({ text: 'send me a sleepy morning photo from bed', provider: 'openai_gpt_image_2', physicalIdentity: identity, llmClient: composer({ scene: `Ordinary morning photo. ${traits.bust}` }), model: 'mock' });
  assert.doesNotMatch(reintroduced.prompt, anatomical, 'A model draft must not reintroduce the canonical clinical terminology');
  const sexualized = await extractImageIntent({ text: 'a sexualized image request', provider: 'openai_gpt_image_2', physicalIdentity: identity, llmClient: composer({ scene: 'Classified scene.', sexualized: true }), model: 'mock' });
  assert.equal(sexualized.sexualized, true);
  assert.ok(sexualized.prompt.includes(body), 'Sexualized Sunburst identity behavior must remain unchanged');
  const visualState = Object.freeze({ state: Object.freeze({ outfit: 'black top and leggings', footwear: 'black high-heeled shoes', hair: 'loose red hair' }) });
  const visualOriginal = JSON.stringify(visualState);
  const garden = await extractImageIntent({
    text: 'predstavujem si ta v kratkych kvetinovych satach, ako sa prechadzas v bambusovej zahrade, bosa, hrava - posli mi fotku',
    provider: 'openai_gpt_image_2', physicalIdentity: identity, visualState,
    llmClient: composer({ scene: 'Iris walking barefoot through a bamboo garden in a short floral dress, playful pose.', scope: 'scene_continuation', outfit: 'short floral dress' }), model: 'mock',
  });
  assert.equal(garden.requestScope, 'scene_continuation');
  assert.equal(garden.sexualized, false);
  assert.equal(garden.framing, 'full_body');
  for (const value of ['short floral dress', 'barefoot', 'bamboo garden', 'playful pose', 'tall and slim', 'augmented big chest']) assert.ok(garden.prompt.includes(value), `Missing garden detail: ${value}`);
  assert.doesNotMatch(garden.prompt, /high-heeled|black top|leggings/);
  assert.doesNotMatch(garden.prompt, anatomical);
  await assert.rejects(generateIrisImage({ prompt: garden.prompt, provider: 'openai_gpt_image_2', imageUrls: refs }), /Fal HTTP 422/);
  assert.doesNotMatch(payload.body.prompt, anatomical);
  validateImagePrompt('openai_gpt_image_2', payload.body.prompt);
  assert.equal(JSON.stringify(visualState), visualOriginal);
  assert.equal(JSON.stringify(identity), original, 'Input and its serialized DB representation must remain byte-for-byte unchanged');
  assert.doesNotMatch(JSON.stringify(logs), /32DD|example.invalid|sleepy morning/, 'Do not log private identity, scenes or reference URLs');
} finally {
  console.log = originalLog;
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = originalKey;
}
const handler = readFileSync('server/image/imageHandler.js', 'utf8');
assert.ok(handler.indexOf('const provider = await loadUserImageProvider') < handler.indexOf('const intent = await extractImageIntent'), 'Provider must be loaded before prompt assembly');
assert.match(handler, /visualPreferences,\s+provider,/);
console.log('Image physical identity regressions passed: neutral Sunburst payload, provider isolation, immutable data, fallback paths, barefoot garden continuity and no moderation retries.');
