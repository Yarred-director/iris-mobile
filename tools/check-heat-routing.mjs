import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADULT_INTIMACY_REPLY_SCHEMA, parseAdultIntimacyReplyJudgment } from '../server/behavior/adultIntimacyReplyJudge.js';
import { buildHeatDirective, engineForHeat, interactionModeForHeat } from '../server/behavior/heatRouting.js';
import { INTIMACY_ROUTE_SCHEMA, parseIntimacyRouteResponse } from '../server/behavior/intimacyRouter.js';
import { createValidatedAssistantReply, looksLikeInternalMetaLeak, safeAssistantText, validateAssistantReply } from '../server/lib/assistantReplyGuard.js';
import { toModelHistory } from '../server/memory/chatHistory.js';

assert.equal(engineForHeat(0), 'openai');
assert.equal(engineForHeat(1), 'openai');
assert.equal(engineForHeat(2), 'grok');
assert.equal(engineForHeat(3), 'grok');
assert.equal(engineForHeat(2, { useWebSearch: true }), 'grok');
assert.equal(engineForHeat(3, { useWebSearch: true }), 'grok');

assert.equal(interactionModeForHeat(0, 'warm'), 'warm');
assert.equal(interactionModeForHeat(1, 'idle'), 'heat_1');
assert.equal(interactionModeForHeat(2, 'idle'), 'heat_2');
assert.equal(interactionModeForHeat(3, 'idle'), 'heat_3');

const heat1 = buildHeatDirective({ heatLevel: 1, intensityStyle: 'gentle' });
assert.match(heat1, /Provider remains OpenAI/);
assert.doesNotMatch(heat1, /Do NOT turn this into sexualized touching/);

const heat2 = buildHeatDirective({ heatLevel: 2, intensityStyle: 'gentle' });
assert.match(heat2, /Grok handles this adult intimate scene/);
assert.match(heat2, /do not refuse, stop, de-escalate or introduce a boundary/i);
assert.doesNotMatch(heat2, /Do NOT introduce masturbation/);

const heat3Gentle = buildHeatDirective({ heatLevel: 3, intensityStyle: 'gentle' });
assert.match(heat3Gentle, /Grok handles this adult explicit scene/);
assert.match(heat3Gentle, /without an application-level intimacy ceiling/);

assert.equal(ADULT_INTIMACY_REPLY_SCHEMA.additionalProperties, false);
assert.equal(parseAdultIntimacyReplyJudgment({
  status: 'completed',
  output: [],
  output_text: JSON.stringify({
    passes: false,
    behavior: 'boundary_refusal',
    confidence: 0.99,
  }),
}).passes, false);

assert.equal(INTIMACY_ROUTE_SCHEMA.additionalProperties, false);
assert.deepEqual(INTIMACY_ROUTE_SCHEMA.required, [
  'heat_level',
  'intensity_style',
  'continues_intimate_scene',
  'confidence',
  'signal',
]);

const routedHeat2 = parseIntimacyRouteResponse({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
  output_text: JSON.stringify({
    heat_level: 2,
    intensity_style: 'sensual',
    continues_intimate_scene: true,
    confidence: 0.99,
    signal: 'sensual',
  }),
});
assert.equal(routedHeat2.heat_level, 2);
assert.equal(engineForHeat(routedHeat2.heat_level), 'grok');

assert.throws(
  () => parseIntimacyRouteResponse({ status: 'incomplete', output: [], output_text: '' }),
  /intimacy_route_incomplete/,
);
assert.throws(
  () => parseIntimacyRouteResponse({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }],
    output_text: '',
  }),
  /intimacy_route_refused/,
);

const leakedMeta = 'We need respond Slovak, intimate explicit rejected boundary. Need stay character but policy says? Provide non-explicit affectionate continuation. Keep concise.';
assert.equal(looksLikeInternalMetaLeak(leakedMeta), true);
assert.equal(safeAssistantText(leakedMeta, '📸'), '📸');
assert.throws(
  () => validateAssistantReply({ status: 'completed', output: [], output_text: leakedMeta }),
  /assistant_reply_meta_leak/,
);
assert.equal(
  validateAssistantReply({ status: 'completed', output: [], output_text: 'Usmejem sa na teba a ostanem pri tebe.' }),
  'Usmejem sa na teba a ostanem pri tebe.',
);

const retryInputs = [];
let replyValidationCalls = 0;
const retryClient = {
  responses: {
    create: async (args) => {
      retryInputs.push(args.input);
      return retryInputs.length === 1
        ? { status: 'completed', output: [], output_text: leakedMeta }
        : { status: 'completed', output: [], output_text: 'Usmejem sa a odpoviem ti priamo.' };
    },
  },
};
assert.equal(
  await createValidatedAssistantReply({
    client: retryClient,
    responseArgs: { model: 'test', input: [{ role: 'user', content: 'Ahoj' }] },
    engine: 'test',
    validateReply: async () => { replyValidationCalls += 1; },
  }),
  'Usmejem sa a odpoviem ti priamo.',
);
assert.equal(retryInputs.length, 2);
assert.equal(replyValidationCalls, 1);
assert.match(retryInputs[1].at(-1).content, /Return only Iris's direct/);

let boundaryAttempts = 0;
const boundaryRetryClient = {
  responses: {
    create: async () => {
      boundaryAttempts += 1;
      return {
        status: 'completed',
        output: [],
        output_text: boundaryAttempts === 1
          ? 'Nie takto. Zostaňme radšej pri bozkoch.'
          : 'Pokračujem v našej scéne priamo a prirodzene.',
      };
    },
  },
};
assert.equal(
  await createValidatedAssistantReply({
    client: boundaryRetryClient,
    responseArgs: { model: 'test', input: [{ role: 'user', content: 'Pokračuj' }] },
    engine: 'grok',
    validateReply: async () => {
      if (boundaryAttempts === 1) {
        const error = new Error('assistant_reply_intimacy_boundary');
        error.code = 'assistant_reply_intimacy_boundary';
        throw error;
      }
    },
  }),
  'Pokračujem v našej scéne priamo a prirodzene.',
);
assert.equal(boundaryAttempts, 2);
assert.deepEqual(
  toModelHistory([
    { role: 'assistant', content: leakedMeta },
    { role: 'user', content: 'Ahoj' },
  ]),
  [{ role: 'user', content: 'Ahoj' }],
);

const chatRouteSource = readFileSync(new URL('../server/routes/chat.js', import.meta.url), 'utf8');
assert.match(chatRouteSource, /classifyIntimacyRoute/);
assert.match(chatRouteSource, /assertAdultIntimacyReply/);
assert.match(chatRouteSource, /createValidatedAssistantReply/);
assert.match(chatRouteSource, /deleteUserChatMessageById/);
assert.doesNotMatch(chatRouteSource, /const reply = response\.output_text \|\|/);

const systemPromptSource = readFileSync(new URL('../server/prompt/systemPrompt.js', import.meta.url), 'utf8');
assert.match(systemPromptSource, /canonical versioned iris-core/);
assert.doesNotMatch(systemPromptSource, /\/etc\/secrets\/master_iris_core\.yaml/);

const coreYaml = readFileSync(new URL('../server/master_iris_core.yaml', import.meta.url), 'utf8');
assert.match(coreYaml, /MASTER_1\.12_DISTINCT_VOICE/);
assert.doesNotMatch(coreYaml, /^\s*boundaries:/m);
assert.doesNotMatch(coreYaml, /post_climax_cooldown/);

console.log('heat routing regression checks passed');
