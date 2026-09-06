import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DRIVE_KEYS,
  REFLECTION_MEMORY_RULES,
  prepareDrivePatch,
} from '../server/cognition/reflectionConsolidation.js';

const baseline = {
  connection: 0.70,
  curiosity: 0.78,
  playfulness: 0.66,
  independence: 0.62,
  competence: 0.68,
  novelty: 0.58,
  protect_relationship: 0.72,
  self_consistency: 0.75,
};

assert.deepEqual(DRIVE_KEYS, Object.keys(baseline));
assert.equal(prepareDrivePatch(baseline, {}), null, 'Empty drive object means no change');
assert.deepEqual(prepareDrivePatch(baseline, baseline), baseline, 'An unchanged complete state is valid');

const bounded = { ...baseline, curiosity: 0.755, playfulness: 0.685 };
assert.deepEqual(prepareDrivePatch(baseline, bounded), bounded, 'A single reflection may move a drive by at most 0.025');
assert.throws(() => prepareDrivePatch(baseline, { curiosity: 0.77 }), { code: 'cognition_invalid_drive_state' }, 'Partial drive replacements are forbidden');
assert.throws(() => prepareDrivePatch(baseline, { ...baseline, curiosity: 0.01 }), { code: 'cognition_drive_out_of_bounds' }, 'Delta-shaped near-zero states must be rejected');
assert.throws(() => prepareDrivePatch(baseline, { ...baseline, curiosity: 0.74 }), { code: 'cognition_drive_step_too_large' }, 'A single reflection cannot make a large drive jump');
assert.throws(() => prepareDrivePatch(baseline, { ...baseline, invented_drive: 0.5 }), { code: 'cognition_invalid_drive_state' }, 'Unknown drive keys are forbidden');

assert.match(REFLECTION_MEMORY_RULES, /ABSOLUTE bounded drive state/);
assert.match(REFLECTION_MEMORY_RULES, /temporary product\/tool limitation/);
assert.match(REFLECTION_MEMORY_RULES, /Runtime capability is determined by the current product/);

const sql = fs.readFileSync(new URL('../supabase/migrations/20260906222500_cognition_drive_guard_and_legacy_cleanup.sql', import.meta.url), 'utf8');
assert.match(sql, /guard_iris_drive_state/);
assert.match(sql, /iris_drive_step_too_large/);
assert.match(sql, /legacy_capability_policy/);
assert.match(sql, /exact_duplicate/);
assert.match(sql, /"connection":0\.70/);
assert.match(sql, /'drives',drives/);
assert.doesNotMatch(sql, /delete from|truncate\s|drop table/i);

console.log('Cognition drive-state and legacy-cleanup checks passed.');
