import assert from 'node:assert/strict';
import { extractImageIntent } from '../server/image/imageIntentDetector.js';

const text = 'predstavujem si ta - cierne leginy, dlhe nohy bose, sedacka posunuta vzadu, nohy vylozene na palubovke, na vrchu mas sport top nad brusko s vckovym vystrihom vlasy v cope, blod red lipstick - pošli mi fotku';
const conversationHistory = [
  { role: 'assistant', content: 'Čierne legíny, bosé nohy na palubovke. Prejdem ti prstami po stehne.' },
  { role: 'user', content: 'pošli mi fotku este raz kitty' },
  { role: 'assistant', content: 'Ojoj, niečo sa pokazilo. Skús znova o chvíľu!' },
];
const identity = Object.freeze({ body_description: '175 cm tall slim adult woman, long slender legs, narrow waist, surgically augmented 32DD breasts', traits: Object.freeze({ height: '175 cm', build: 'tall slim adult figure', legs: 'long slender legs', waist: 'narrow waist', bust: 'surgically augmented 32DD breasts' }) });
const before = JSON.stringify(identity);
const logs = [];
const originalLog = console.log;
console.log = (...args) => logs.push(args);
try {
  for (const provider of ['openai_gpt_image_2', 'grok_imagine_2', 'kling_o3']) {
    for (const scopeSexualized of [false, true]) {
      for (const composerExplicit of [false, true]) {
        let input;
        const result = await extractImageIntent({ text, conversationHistory, physicalIdentity: identity, provider, model: 'mock', llmClient: { responses: { create: async (request) => {
          if (request.text?.format) return { status: 'completed', output_text: JSON.stringify({ request_scope: 'scene_continuation', signal: 'specified_scene', sexualized: scopeSexualized, confidence: 0.99, outfit_override: 'black leggings and a V-neck sports crop top' }) };
          input = request.input;
          return { output_text: JSON.stringify({ prompt: 'Adult Iris wearing black leggings and a V-neck sports crop top, barefoot, seated in the passenger seat with legs on the dashboard, ponytail, bold red lipstick.', explicit: composerExplicit, framing: 'three_quarter' }) };
        } } } });
        assert.equal(result.sexualized, scopeSexualized || composerExplicit, 'Diagnostics must not override or weaken classification');
        assert.equal(result.imageDiagnostics.scopeSexualized, scopeSexualized);
        assert.equal(result.imageDiagnostics.composerExplicit, composerExplicit);
        assert.equal(result.imageDiagnostics.sexualizationSource, scopeSexualized ? (composerExplicit ? 'both' : 'scope') : (composerExplicit ? 'composer' : 'none'));
        assert.equal(result.imageDiagnostics.physicalIdentitySerialization, provider === 'openai_gpt_image_2' && !result.sexualized ? 'neutral' : 'canonical');
        assert.equal(result.imageDiagnostics.scopeSignal, 'specified_scene');
        assert.equal(result.imageDiagnostics.compositionStatus, 'completed');
        assert.ok(!input.some((item) => item.content.includes('Prejdem ti prstami')), 'A newly specified scene must not feed old sexual touching into the composer');
        assert.match(result.prompt, /black leggings.*sports crop top/);
        assert.match(result.prompt, /barefoot/);
        assert.match(result.prompt, /dashboard/);
        if (provider === 'openai_gpt_image_2' && !result.sexualized) {
          assert.match(result.prompt, /augmented big chest/);
          assert.doesNotMatch(result.prompt, /32DD|breasts/i);
        } else assert.ok(result.prompt.includes(identity.body_description));
        assert.doesNotMatch(JSON.stringify(result.imageDiagnostics), /32DD|palubovke|Prejdem|https:/);
      }
    }
  }
  for (const failScope of [false, true]) {
    const result = await extractImageIntent({ text: 'send me a photo', physicalIdentity: identity, provider: 'openai_gpt_image_2', model: 'mock', llmClient: { responses: { create: async (request) => {
      if (request.text?.format && !failScope) return { status: 'completed', output_text: JSON.stringify({ request_scope: 'standalone', signal: 'generic_photo', sexualized: true, confidence: 0.99, outfit_override: null }) };
      throw new Error('mock unavailable');
    } } } });
    assert.equal(result.imageDiagnostics.scopeStatus, failScope ? 'fallback' : 'completed');
    assert.equal(result.imageDiagnostics.compositionStatus, 'fallback');
    assert.equal(result.imageDiagnostics.composerExplicit, null);
    assert.equal(result.imageDiagnostics.sexualizationSource, failScope ? 'none' : 'scope');
  }
  assert.equal(JSON.stringify(identity), before, 'Canonical identity must remain immutable');
} finally { console.log = originalLog; }
console.log('Image sexualization provenance checks passed.');
