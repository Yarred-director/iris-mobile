import assert from 'node:assert/strict';
import {
  formatVisualStateBlock,
  mergeVisualState,
  selectPotentialVisualPreferences,
} from '../server/memory/visualState.js';

const existing = {
  outfit: 'cream cocktail dress',
  nails: 'natural nails',
  hair: 'loose waves',
};

const nailsOnly = mergeVisualState(existing, { nails: 'glossy black nail polish' });
assert.equal(nailsOnly.outfit, 'cream cocktail dress');
assert.equal(nailsOnly.nails, 'glossy black nail polish');
assert.equal(nailsOnly.hair, 'loose waves');

const changedOutfit = mergeVisualState(existing, { outfit: 'silk lounge set' });
assert.equal(changedOutfit.outfit, 'silk lounge set');
assert.equal(changedOutfit.nails, 'natural nails');

const cleared = mergeVisualState(existing, {}, ['footwear', 'hair']);
assert.equal(cleared.outfit, 'cream cocktail dress');
assert.equal(cleared.hair, undefined);

const prefs = selectPotentialVisualPreferences([
  { category: 'preferences', fact_key: 'loves_black_nail_polish', fact_value: 'User loves black nail polish on Iris.', confidence: 0.98 },
  { category: 'visual_preferences', fact_key: 'iris_visual.sleepwear_style', fact_value: 'Prefers satin sleepwear on Iris.', confidence: 0.95 },
  { category: 'appearance', fact_key: 'user_hair', fact_value: 'User has dark hair.', confidence: 1 },
  { category: 'interests', fact_key: 'elden_ring', fact_value: 'Plays Elden Ring.', confidence: 1 },
]);
assert.equal(prefs.length, 2);
assert.ok(prefs.some((item) => item.fact_key === 'loves_black_nail_polish'));
assert.ok(prefs.some((item) => item.fact_key === 'iris_visual.sleepwear_style'));
assert.ok(!prefs.some((item) => item.fact_key === 'user_hair'));

const block = formatVisualStateBlock({ state: existing });
assert.match(block, /current visual continuity state/i);
assert.match(block, /Do not silently replace the outfit/i);
assert.match(block, /soft personalization signals/i);

console.log('visual state regression checks passed');
