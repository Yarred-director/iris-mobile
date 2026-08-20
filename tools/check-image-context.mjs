import assert from 'node:assert/strict';
import { extractImageIntent } from '../server/image/imageIntentDetector.js';

let capturedInput = null;
let mockPrompt = 'Iris on a balcony at sunset wearing black lace swimwear with a long sheer black skirt.';

const llmClient = {
  responses: {
    create: async ({ input }) => {
      capturedInput = input;
      return {
        output_text: JSON.stringify({
          prompt: mockPrompt,
          explicit: false,
          aspect_ratio: 'auto',
        }),
      };
    },
  },
};

const conversationHistory = [
  { role: 'user', content: 'Nemáš nejaké čierne plavky s čipkou a na spodok priesvitnú dlhú čiernu sukňu?' },
  { role: 'assistant', content: 'Čierne plavky s čipkou a dlhá priesvitná sukňa by boli perfektné.' },
  { role: 'user', content: 'prečo mi ich nepredvieš rovno hneď?' },
  { role: 'assistant', content: 'Predstav si ma na balkóne so západom slnka v pozadí, v čiernych plavkách s čipkou a dlhej priesvitnej sukni.' },
];

const result = await extractImageIntent({
  text: 'pošli mi fotku',
  conversationHistory,
  sceneContext: { location_city: 'Dubai', place: 'balcony', time_of_day: 'evening' },
  llmClient,
  model: 'mock-model',
});

assert.ok(Array.isArray(capturedInput), 'Image prompt composer did not receive Responses API input.');
const joined = capturedInput.map((message) => String(message.content || '')).join('\n').toLowerCase();
assert.match(joined, /čierne plavky|black lace/, 'Recent outfit context was not passed into image prompt synthesis.');
assert.match(joined, /priesvitn|sheer/, 'Recent skirt detail was not passed into image prompt synthesis.');
assert.match(joined, /balk[oó]n|balcony/, 'Recent scene context was not passed into image prompt synthesis.');
assert.match(joined, /pošli mi fotku/, 'Latest image request was not passed into image prompt synthesis.');
assert.match(joined, /head-to-body scale|head must not be enlarged/, 'Body proportion guardrails were not passed into image prompt synthesis.');
assert.match(joined, /planned scene as the authoritative image specification/i, 'Immediate planned-scene handoff rule is missing.');
assert.match(joined, /full chest.*does not mean a tight head-and-chest portrait/i, 'Full-chest anatomy/framing disambiguation rule is missing.');
assert.match(result.prompt.toLowerCase(), /black lace/, 'Prompt synthesis result was not returned.');
assert.match(result.prompt.toLowerCase(), /head-to-body scale/, 'Mandatory body proportion guardrails were not injected into the final image prompt.');
assert.match(result.prompt.toLowerCase(), /long-legged/, 'Iris body silhouette guardrail is missing from the final image prompt.');

mockPrompt = 'Photorealistic elegant fantasy warrior inspired by Elden Ring, dark ornate armor, dramatic ruins and cinematic light.';
const fantasyFollowup = await extractImageIntent({
  text: 'pošli mi tú fotku',
  conversationHistory: [
    { role: 'user', content: 'daj väčší výstrih a nezabudni augmented full chest' },
    { role: 'assistant', content: 'Môžem ti poslať ďalší fantasy záber s odvážnejším výstrihom a výraznejšou siluetou, stále ako elegantná bojovníčka z Elden Ringu.' },
    { role: 'user', content: 'jasne to je všetko čo chcem :)' },
    { role: 'assistant', content: 'Tak presne tak — elegantná, nebezpečná, v dark fantasy warrior scéne s výraznejším výstrihom.' },
  ],
  visualState: { outfit: 'black lace top from the previous portrait' },
  sceneContext: { place: 'fantasy ruins' },
  llmClient,
  model: 'mock-model',
});

const fantasyJoined = capturedInput.map((message) => String(message.content || '')).join('\n').toLowerCase();
assert.match(fantasyJoined, /elden ring|dark fantasy warrior/, 'Immediate fantasy scene plan was not passed into prompt synthesis.');
assert.match(fantasyJoined, /augmented full chest|výstrih/, 'Bust/neckline correction was not preserved in recent context.');
assert.match(fantasyJoined, /do not fall back to a generic portrait/i, 'Generic-portrait regression rule is missing.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /fantasy warrior/, 'Fantasy scene prompt should survive the follow-up request.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /entire augmented bust/, 'Bust visibility framing must be injected deterministically for this follow-up.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /head to at least the waist/, 'Bust emphasis must force wider torso framing.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /do not crop at the collarbones or shoulders/, 'Shoulder-only crop guardrail is missing.');

console.log('Image context continuity regression test passed.');
