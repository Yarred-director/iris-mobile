import assert from 'node:assert/strict';
import { buildHeatDirective, engineForHeat, interactionModeForHeat } from '../server/behavior/heatRouting.js';

assert.equal(engineForHeat(0), 'openai');
assert.equal(engineForHeat(1), 'openai');
assert.equal(engineForHeat(2), 'grok');
assert.equal(engineForHeat(3), 'grok');
assert.equal(engineForHeat(3, { useWebSearch: true }), 'openai');

assert.equal(interactionModeForHeat(0, 'warm'), 'warm');
assert.equal(interactionModeForHeat(1, 'idle'), 'heat_1');
assert.equal(interactionModeForHeat(2, 'idle'), 'heat_2');
assert.equal(interactionModeForHeat(3, 'idle'), 'heat_3');

const heat1 = buildHeatDirective({ heatLevel: 1, intensityStyle: 'gentle' });
assert.match(heat1, /Provider remains OpenAI/);
assert.match(heat1, /Do NOT turn this into sexualized touching/);

const heat2 = buildHeatDirective({ heatLevel: 2, intensityStyle: 'gentle' });
assert.match(heat2, /Stay inside heat 2/);
assert.match(heat2, /do not become vulgar/i);
assert.match(heat2, /Do NOT introduce masturbation/);

const heat3Gentle = buildHeatDirective({ heatLevel: 3, intensityStyle: 'gentle' });
assert.match(heat3Gentle, /does NOT automatically mean rough/);
assert.match(heat3Gentle, /Gentle explicit behavior stays gentle/);

console.log('heat routing regression checks passed');
