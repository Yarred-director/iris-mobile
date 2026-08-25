import assert from 'node:assert/strict';
import { extractImageIntent } from '../server/image/imageIntentDetector.js';
import { parseImageRequestScopeResponse } from '../server/image/imageRequestScope.js';
import { isOpenAIOutputModerationBlock, parseOpenAIImageResponse } from '../server/image/imageGen.js';

let capturedInput = null;
let capturedScopeInput = null;
let mockScope = {
  request_scope: 'scene_continuation',
  sexualized: false,
  confidence: 0.99,
  signal: 'accepted_immediate_scene',
};
let mockResponse = {
  prompt: 'Iris on a balcony at sunset in an elegant look.',
  explicit: false,
  framing: 'three_quarter',
  aspect_ratio: 'auto',
};

const llmClient = {
  responses: {
    create: async ({ input, text }) => {
      if (text?.format?.name === 'iris_image_request_scope') {
        capturedScopeInput = input;
        return { status: 'completed', output: [], output_text: JSON.stringify(mockScope) };
      }
      capturedInput = input;
      return { output_text: JSON.stringify(mockResponse) };
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
  visualState: { state: { outfit: 'black lace swimwear with a long sheer black skirt' } },
  physicalIdentity: { body_description: 'adult woman with a full augmented C-cup bust, slim waist and long legs' },
  activityState: { current_activity: 'relaxing on the balcony', next_steps: [], commitments: [], pending_promises: [] },
  llmClient,
  model: 'mock-model',
});

assert.ok(Array.isArray(capturedInput), 'Image prompt composer did not receive Responses API input.');
const joined = capturedInput.map((message) => String(message.content || '')).join('\n').toLowerCase();
assert.match(joined, /black lace swimwear/, 'Resolved current outfit was not passed into image prompt synthesis.');
assert.match(joined, /full augmented c-cup bust/, 'User-defined body identity was not passed into image prompt synthesis.');
assert.match(joined, /default personal-photo framing is three_quarter/i, 'Non-closeup default framing rule is missing.');
assert.match(joined, /current_activity_state/i, 'Activity continuity was not passed into image synthesis.');
assert.match(result.prompt.toLowerCase(), /mandatory user-defined body identity/, 'Final image prompt must deterministically include persistent body identity.');
assert.match(result.prompt.toLowerCase(), /full augmented c-cup bust/, 'Final image prompt lost the user-defined body description.');
assert.match(result.prompt.toLowerCase(), /mandatory current visual state/, 'Final image prompt must deterministically include current visual state.');
assert.match(result.prompt.toLowerCase(), /black lace swimwear/, 'Final image prompt lost the exact established outfit/color.');
assert.match(result.prompt.toLowerCase(), /three-quarter composition/, 'Default/body-oriented framing was not injected into final prompt.');
assert.equal(result.aspect_ratio, '3:4', 'Non-closeup personal photos should default to portrait framing.');

mockResponse = {
  prompt: 'Photorealistic elegant fantasy warrior inspired by Elden Ring, dark ornate armor, dramatic ruins and cinematic light.',
  explicit: false,
  framing: 'close_up',
  aspect_ratio: 'auto',
};
mockScope = {
  request_scope: 'scene_continuation',
  sexualized: false,
  confidence: 0.99,
  signal: 'accepted_immediate_scene',
};
const fantasyFollowup = await extractImageIntent({
  text: 'pošli mi tú fotku',
  conversationHistory: [
    { role: 'user', content: 'daj väčší výstrih a nezabudni augmented full chest' },
    { role: 'assistant', content: 'Môžem ti poslať ďalší fantasy záber s odvážnejším výstrihom a výraznejšou siluetou, stále ako elegantná bojovníčka z Elden Ringu.' },
    { role: 'user', content: 'jasne to je všetko čo chcem :)' },
    { role: 'assistant', content: 'Tak presne tak — elegantná, nebezpečná, v dark fantasy warrior scéne s výraznejším výstrihom.' },
  ],
  visualState: { state: { outfit: 'dark ornate fantasy armor with a deep neckline' } },
  physicalIdentity: { body_description: 'adult woman with a full augmented C-cup bust and athletic feminine proportions' },
  sceneContext: { place: 'fantasy ruins' },
  activityState: { current_activity: 'posing as a fantasy warrior', next_steps: [], commitments: [], pending_promises: [] },
  llmClient,
  model: 'mock-model',
});

const fantasyJoined = capturedInput.map((message) => String(message.content || '')).join('\n').toLowerCase();
assert.match(fantasyJoined, /elden ring|dark fantasy warrior/, 'Immediate fantasy scene plan was not passed into prompt synthesis.');
assert.match(fantasyJoined, /augmented full chest|výstrih/, 'Bust/neckline correction was not preserved in recent context.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /fantasy warrior/, 'Fantasy scene prompt should survive the follow-up request.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /entire established bust/, 'Bust visibility framing must be injected deterministically.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /head to at least the waist/, 'Bust emphasis must force wider torso framing.');
assert.match(fantasyFollowup.prompt.toLowerCase(), /do not crop at the collarbones or shoulders/, 'Shoulder-only crop guardrail is missing.');
assert.equal(fantasyFollowup.framing, 'three_quarter', 'Bust-focused requests must not collapse into close-up framing.');

mockResponse = {
  prompt: 'Close portrait focused on Iris smiling with tears in her eyes.',
  explicit: false,
  framing: 'close_up',
  aspect_ratio: 'auto',
};
mockScope = {
  request_scope: 'scene_continuation',
  sexualized: false,
  confidence: 0.99,
  signal: 'specified_scene',
};
const emotionPortrait = await extractImageIntent({
  text: 'ukáž mi detail tváre, chcem vidieť ten dojatý úsmev',
  conversationHistory: [],
  physicalIdentity: { body_description: 'adult woman with athletic feminine proportions' },
  llmClient,
  model: 'mock-model',
});
assert.equal(emotionPortrait.framing, 'close_up', 'Explicit emotional face detail should still allow close-up framing.');
assert.equal(emotionPortrait.aspect_ratio, '1:1', 'Close-up portrait should default to square framing.');

mockResponse = {
  prompt: 'Ordinary nonsexual personal photo of Iris alone in a relaxed neutral pose and tasteful casual clothing.',
  explicit: false,
  framing: 'three_quarter',
  aspect_ratio: 'auto',
};
mockScope = {
  request_scope: 'standalone',
  sexualized: false,
  confidence: 0.99,
  signal: 'generic_photo',
};
const neutralAfterErrors = await extractImageIntent({
  text: 'Iris, pošli mi fotku teba',
  conversationHistory: [
    { role: 'user', content: 'pošli mi fotku ako ti bozkávam bruško' },
    { role: 'assistant', content: 'Ojoj, niečo sa pokazilo 🙈 Skús znova o chvíľu!' },
    { role: 'user', content: 'ukáž mi fotku tejto scény' },
    { role: 'assistant', content: 'Ojoj, niečo sa pokazilo 🙈 Skús znova o chvíľu!' },
  ],
  visualState: { state: { hair: 'long red hair' } },
  physicalIdentity: { body_description: 'adult woman with natural adult proportions' },
  llmClient,
  model: 'mock-model',
});
const neutralJoined = capturedInput.map((message) => String(message.content || '')).join('\n').toLowerCase();
assert.doesNotMatch(neutralJoined, /bozkávam bruško|fotku tejto scény/, 'Standalone photo must not inherit an older intimate scene through generation errors.');
assert.match(neutralJoined, /image_request_scope: standalone/, 'Standalone scope must be explicit to the prompt composer.');
assert.equal(neutralAfterErrors.requestScope, 'standalone', 'Standalone request scope was not preserved on image intent.');
assert.equal(neutralAfterErrors.sexualized, false, 'Generic standalone photo must remain nonsexual.');
assert.ok(Array.isArray(capturedScopeInput), 'Semantic request-scope classifier did not receive recent context.');

assert.deepEqual(parseImageRequestScopeResponse({
  status: 'completed',
  output: [],
  output_text: JSON.stringify(mockScope),
}), mockScope, 'Valid strict image request scope was not parsed.');
assert.throws(() => parseImageRequestScopeResponse({
  status: 'completed',
  output: [],
  output_text: '{"request_scope":"standalone"}',
}), /image_scope_invalid_shape/, 'Incomplete image request scope must fail closed.');

const blockedResponse = new Response(JSON.stringify({
  error: {
    type: 'image_generation_user_error',
    code: 'moderation_blocked',
    moderation_details: { moderation_stage: 'output', categories: ['sexual'] },
  },
}), { status: 400, headers: { 'x-request-id': 'req_image_test' } });
let blockedError = null;
try {
  await parseOpenAIImageResponse(blockedResponse, 'OPENAI_GPT_IMAGE_2_EDIT');
} catch (error) {
  blockedError = error;
}
assert.equal(blockedError?.code, 'moderation_blocked', 'OpenAI image error code was not preserved.');
assert.equal(blockedError?.requestId, 'req_image_test', 'OpenAI request ID was not preserved.');
assert.equal(blockedError?.moderationStage, 'output', 'OpenAI moderation stage was not preserved.');
assert.deepEqual(blockedError?.moderationCategories, ['sexual'], 'OpenAI moderation categories were not preserved.');
assert.equal(isOpenAIOutputModerationBlock(blockedError), true, 'Output-stage moderation block must be eligible for a changed-prompt retry.');
assert.equal(isOpenAIOutputModerationBlock({ code: 'moderation_blocked', moderationStage: 'input' }), false, 'Input-stage moderation must never be retried.');

console.log('Image context continuity regression test passed.');
