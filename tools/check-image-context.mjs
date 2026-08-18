import assert from 'node:assert/strict';
import { extractImageIntent } from '../server/image/imageIntentDetector.js';

let capturedMessages = null;

const llmClient = {
  chat: {
    completions: {
      create: async ({ messages }) => {
        capturedMessages = messages;
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                prompt: 'Iris on a balcony at sunset wearing black lace swimwear with a long sheer black skirt.',
                explicit: false,
                aspect_ratio: 'auto',
              }),
            },
          }],
        };
      },
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

assert.ok(Array.isArray(capturedMessages), 'Image prompt composer did not receive messages.');
const joined = capturedMessages.map((message) => String(message.content || '')).join('\n').toLowerCase();
assert.match(joined, /čierne plavky|black lace/, 'Recent outfit context was not passed into image prompt synthesis.');
assert.match(joined, /priesvitn|sheer/, 'Recent skirt detail was not passed into image prompt synthesis.');
assert.match(joined, /balk[oó]n|balcony/, 'Recent scene context was not passed into image prompt synthesis.');
assert.match(joined, /pošli mi fotku/, 'Latest image request was not passed into image prompt synthesis.');
assert.match(result.prompt.toLowerCase(), /black lace/, 'Prompt synthesis result was not returned.');

console.log('Image context continuity regression test passed.');
