import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateIrisImage } from '../server/image/imageGen.js';

// Output-stage moderation arrives as a bare 502 and is non-deterministic (live: 1 of 4 identical requests
// passed on 2026-11-10). It must be classified as retryable moderation, not as an outage.
const originalFetch = globalThis.fetch;
const originalKey = process.env.FAL_KEY;
const originalLog = console.log;
process.env.FAL_KEY = 'test-placeholder';
console.log = () => {};
const refs = ['https://example.invalid/front'];
try {
  globalThis.fetch = async () => new Response('upstream request failed', { status: 502 });
  await assert.rejects(
    generateIrisImage({ prompt: 'Iris in a kitchen, photorealistic.', provider: 'grok_imagine_2', imageUrls: refs }),
    (error) => error.status === 502 && error.moderationStage === 'provider_upstream_rejection',
  );

  globalThis.fetch = async () => new Response('bad gateway', { status: 502 });
  await assert.rejects(
    generateIrisImage({ prompt: 'Iris in a kitchen, photorealistic.', provider: 'grok_imagine_2', imageUrls: refs }),
    (error) => error.status === 502 && error.moderationStage === null,
    'Other gateway errors are not moderation and must not trigger the moderation fallback',
  );

  globalThis.fetch = async () => new Response(JSON.stringify({ detail: [{ type: 'content_policy_violation', loc: ['body', 'prompt'] }] }), { status: 422 });
  await assert.rejects(
    generateIrisImage({ prompt: 'Iris in a kitchen, photorealistic.', provider: 'kling_o3', imageUrls: refs }),
    (error) => error.moderationStage === 'body.prompt',
  );
} finally {
  globalThis.fetch = originalFetch;
  process.env.FAL_KEY = originalKey;
  console.log = originalLog;
}

const handler = readFileSync(new URL('../server/image/imageHandler.js', import.meta.url), 'utf8');
assert.match(handler, /provider_upstream_rejection/, 'Upstream rejections repeat the same shot once');
assert.match(handler, /forceNonSexual: true/, 'A moderation rejection falls back to one conservative recomposition');
assert.match(handler, /physicalIdentity: null/, 'The conservative recomposition carries no body description');

const detector = readFileSync(new URL('../server/image/imageIntentDetector.js', import.meta.url), 'utf8');
assert.match(detector, /resolved_outfit/, 'The composer resolves a complete outfit for non-sexual photos');
assert.doesNotMatch(detector.match(/export const OUTFIT_COMPLETE_RULE = '([^']*)'/)[1], /lower-body|missing|undress/i, 'Provider-facing outfit wording must not talk about missing garments');

console.log('image moderation retry checks passed');
