import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateIrisImage } from '../server/image/imageGen.js';
import { IMAGE_PROMPT_POLICIES, fitImagePrompt, validateImagePrompt } from '../server/image/imagePromptBudget.js';

const endpoints = {
  kling_o3: 'fal-ai/kling-image/o3/image-to-image',
  grok_imagine_2: 'xai/grok-imagine-image/v2.0/edit',
  openai_gpt_image_2: 'openai/gpt-image-2/edit',
  qwen_image_max: 'fal-ai/qwen-image-max/edit',
  'nano-banana-2': 'fal-ai/gemini-3.1-flash-image-preview/edit',
};
const expectedLimits = { kling_o3: 2500, grok_imagine_2: 8000, openai_gpt_image_2: 32000, qwen_image_max: 800, 'nano-banana-2': 50000 };
const body = 'MANDATORY USER-DEFINED BODY IDENTITY: athletic adult woman with long legs. Preserve these body traits exactly; do not reduce, enlarge, replace or reinterpret them.';
const appearance = `MANDATORY CURRENT VISUAL STATE: outfit=black platform boots, white leg warmers, plaid skirt and anime crop top; hair=ponytail; ${'extra styling detail; '.repeat(220)}. Any outfit value is exhaustive: do not add visible clothing layers that are not named. Preserve these exact established visible details and colors unless the current request explicitly changes them.`;
const scene = 'Tokyo neon ramen stall, leaning on a bar stool, smiling at the camera. Photorealistic.';
// The meaningful scene is AFTER 3500 chars: the old generic pre-slice erased it.
const longPrompt = `${body} ${appearance} ${scene}`;
assert.ok(longPrompt.indexOf(scene) > 3500);
const refs = ['https://example.invalid/front.png', 'https://example.invalid/three-quarter.png', 'https://example.invalid/side.png'];
const originalFetch = globalThis.fetch;
const originalKey = process.env.FAL_KEY;
const originalLog = console.log;
const logs = [];
console.log = (...args) => logs.push(args);
process.env.FAL_KEY = 'unit-test-placeholder';
let captured = null;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.ok(String(url).startsWith('https://fal.run/'), 'No storage or other external requests are permitted in this test');
  calls += 1;
  captured = { url, body: JSON.parse(options.body) };
  return new Response(JSON.stringify({ detail: [{ msg: 'prompt: size must be between 0 and 2500', input: { prompt: 'PRIVATE_PROMPT_MUST_NOT_BE_LOGGED' } }] }), {
    status: 422, headers: { 'x-fal-request-id': 'test-request-id', 'Content-Type': 'application/json' },
  });
};
try {
  for (const [provider, endpoint] of Object.entries(endpoints)) {
    const policy = IMAGE_PROMPT_POLICIES[provider];
    const limit = expectedLimits[provider];
    assert.equal(policy.maxChars, limit);
    assert.equal(policy.documentedMaxChars, limit);
    for (const prompt of ['x'.repeat(2546), 'ž'.repeat(limit), '東京🌃 '.repeat(limit), 'x'.repeat(limit + 100), longPrompt]) {
      const before = calls;
      await assert.rejects(generateIrisImage({ provider, prompt, imageUrls: refs, userId: 'test-user' }), (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.code, 'fal_http_422');
        assert.equal(error.provider, provider);
        assert.equal(error.requestId, 'test-request-id');
        assert.equal(error.validationReason, 'prompt: size must be between 0 and 2500');
        assert.doesNotMatch(error.message, /PRIVATE_PROMPT/);
        return true;
      });
      assert.equal(calls, before + 1, 'One request, no provider fallback or validation-error retry');
      assert.equal(captured.url, `https://fal.run/${endpoint}`);
      assert.deepEqual(captured.body.image_urls, refs);
      const finalPrompt = captured.body.prompt;
      validateImagePrompt(provider, finalPrompt);
      const payloadLog = logs.findLast(([label]) => label === '[IMAGE_GEN_PAYLOAD]')?.[1];
      assert.equal(payloadLog.provider, provider);
      assert.equal(payloadLog.chars, Array.from(finalPrompt).length);
      assert.equal(payloadLog.utf8Bytes, Buffer.byteLength(finalPrompt, 'utf8'));
      assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_PROMPT|example\.invalid|Tokyo neon ramen/);
      assert.ok(finalPrompt.length <= limit);
      assert.ok(Buffer.byteLength(finalPrompt, 'utf8') <= limit);
      assert.equal(finalPrompt.isWellFormed(), true, 'Unicode must not be split between surrogate pairs');
      if (provider === 'kling_o3') assert.match(finalPrompt, /@Image1 @Image2 @Image3/);
      if (provider === 'grok_imagine_2') assert.match(finalPrompt, /No plastic skin/);
      if (prompt === longPrompt) {
        assert.match(finalPrompt, /athletic adult woman with long legs/);
        assert.match(finalPrompt, /black platform boots/);
        assert.match(finalPrompt, /Tokyo neon ramen stall/);
        assert.match(finalPrompt, /smiling at the camera/);
        assert.match(finalPrompt, /no unrequested visible layers|do not add visible clothing layers/i);
      }
    }
    for (const count of [1, 2]) {
      await assert.rejects(generateIrisImage({ provider, prompt: scene, imageUrls: refs.slice(0, count), userId: 'test-user' }), /Fal HTTP 422/);
      assert.deepEqual(captured.body.image_urls, refs.slice(0, count));
      validateImagePrompt(provider, captured.body.prompt);
      assert.match(captured.body.prompt, /Tokyo neon ramen stall/);
    }
    for (const size of [limit - 1, limit, limit + 1]) {
      const prompt = 'a'.repeat(size);
      const fitted = fitImagePrompt({ provider, prompt });
      validateImagePrompt(provider, fitted);
      if (size <= limit) assert.equal(fitted, prompt, 'Under-budget prompts must not be rewritten');
    }
    assert.throws(() => validateImagePrompt(provider, 'a'.repeat(limit + 1)), /budget/);
    assert.throws(() => validateImagePrompt(provider, 'ž'.repeat(limit)), /budget/);
    assert.throws(() => fitImagePrompt({ provider, prompt: ' ' }), /empty/);
    if (policy.minChars > 1) assert.throws(() => validateImagePrompt(provider, 'a'), /budget/);
    assert.throws(() => fitImagePrompt({ provider, prompt: scene, prefix: 'a'.repeat(limit) }), /budget/);
  }
  const before = calls;
  await assert.rejects(generateIrisImage({ prompt: '', imageUrls: refs }), /empty/);
  assert.equal(calls, before, 'Invalid local prompts must fail before transport');
} finally {
  console.log = originalLog;
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = originalKey;
}
console.log('Image prompt budgets passed: final serialized payloads, all providers, UTF-8, scene retention and private error handling.');
