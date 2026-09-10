import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.OPENAI_API_KEY ||= 'test-only-key';

const {
  composePhysicalBodyDescription,
  mergePhysicalTraits,
  normalizePhysicalTraits,
} = await import('../server/memory/physicalIdentity.js');

const base = normalizePhysicalTraits({
  height: 'approximately 175 cm tall',
  build: 'tall and slim model-like physique, lean feminine fit body',
  legs: 'long slender model-like legs',
  waist: 'narrow defined waist',
  hips: 'medium proportionate hips',
  bust: 'large augmented bust',
  skin: 'pale skin',
  freckles: 'strong natural freckles across face and chest',
});

const merged = mergePhysicalTraits(base, {
  bust: 'surgically augmented 32DD, very full rounded high-projection natural-looking augmented breasts',
});

assert.equal(merged.height, base.height, 'changing bust must preserve height');
assert.equal(merged.build, base.build, 'changing bust must preserve slim build');
assert.equal(merged.legs, base.legs, 'changing bust must preserve legs');
assert.equal(merged.waist, base.waist, 'changing bust must preserve waist');
assert.match(merged.bust, /32DD/);

const description = composePhysicalBodyDescription(merged);
assert.match(description, /175 cm/i);
assert.match(description, /slim model-like/i);
assert.match(description, /narrow defined waist/i);
assert.match(description, /32DD/i);
assert.match(description, /freckles/i);

const migration = fs.readFileSync('supabase/migrations/20260910143000_structured_physical_identity.sql', 'utf8');
assert.match(migration, /add column if not exists traits jsonb/i);
assert.match(migration, /jsonb_typeof\(traits\) = 'object'/i);

const imageGen = fs.readFileSync('server/image/imageGen.js', 'utf8');
assert.match(imageGen, /https:\/\/fal\.run\/openai\/gpt-image-2\/edit/);
assert.match(imageGen, /https:\/\/fal\.run\/openai\/gpt-image-2'/);
assert.match(imageGen, /transport=fal/);
assert.match(imageGen, /generateOpenAiGptImage2Edit/);
assert.match(imageGen, /generateOpenAiGptImage2Text/);
assert.doesNotMatch(imageGen, /api\.openai\.com\/v1\/images/i);

console.log('physical identity + OpenAI Fal checks passed');
