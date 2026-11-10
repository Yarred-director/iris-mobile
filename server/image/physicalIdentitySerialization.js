// Image-only projection. Canonical traits/body_description are never written or
// modified here. Other providers and sexualized requests retain their raw text.
// Every provider's content checker reads clinical anatomy as sexual, so any non-sexual request
// gets the photographic projection. Sexualized requests keep the canonical description.
// The provider argument stays for call-site compatibility; behavior is provider-independent.
export function usesNeutralPhysicalIdentity(_provider, sexualized) {
  return sexualized === false;
}

const TRAIT_LABELS = Object.freeze({
  height: 'Height', build: 'Build', legs: 'Legs', waist: 'Waist',
  hips: 'Hips', bust: 'Bust', skin: 'Skin', freckles: 'Freckles',
  other: 'Other enduring traits',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function freckleDistribution(value) {
  return value.replace(/\b(?:chest\s+and\s+(?:upper\s+)?bust|upper\s+bust|breasts?|chest|bust)\b/gi, 'visible skin');
}

// Compatibility with pre-structured identity snapshots. Translate only local
// anatomical phrases, preserving unrelated height/build/skin/leg information.
const BUST_WORDING = /\b(?:bust|breasts?|chest|cleavage|cup[- ]size)\b|\b\d{2,3}\s*[A-K]{1,3}\b|\b[A-K]{1,3}[- ]cup\b/i;

// Drops only the clauses that describe the bust, keeping height, build, legs, waist, skin and freckles.
function neutralLegacyDescription(value) {
  const freckles = value.replace(/[^.;]*\bfreckles\b[^.;]*/gi, (phrase) => freckleDistribution(phrase));
  return freckles
    .split(/(?<=[.;,])/)
    .filter((clause) => !BUST_WORDING.test(clause))
    .join('')
    .replace(/^[\s,;]+|[\s,;]+$/g, '')
    .trim();
}

export function serializePhysicalIdentityForImageProvider({ physicalIdentity, provider, sexualized }) {
  const body = text(physicalIdentity?.body_description);
  if (!usesNeutralPhysicalIdentity(provider, sexualized)) return body;

  // Prefer field-level authority; hydrated hints may expose traits at top level.
  const legacyTraits = {};
  // Retain fields from labeled compatibility descriptions when an older snapshot
  // contains only a partial structured trait set. Structured fields win.
  const labels = /(?:^|\.\s+)(height|build|legs|waist|hips|bust|skin|freckles|other enduring traits):\s*([\s\S]*?)(?=\.\s+(?:height|build|legs|waist|hips|bust|skin|freckles|other enduring traits):|$)/gi;
  for (const [, key, value] of body.matchAll(labels)) legacyTraits[key.toLowerCase() === 'other enduring traits' ? 'other' : key.toLowerCase()] = value.replace(/\.$/, '');
  const traits = physicalIdentity?.traits || physicalIdentity || {};
  const parts = Object.entries(TRAIT_LABELS).flatMap(([key, label]) => {
    const value = text(traits[key]) || text(physicalIdentity?.[key]) || text(legacyTraits[key]);
    if (!value) return [];
    // Bust wording of any kind trips provider content checkers on ordinary photos (verified against
    // Kling and Grok on 2026-11-10); the face references and remaining traits carry her look instead.
    if (key === 'bust') return [];
    const description = key === 'freckles' ? freckleDistribution(value) : neutralLegacyDescription(value);
    return [`${label}: ${description}.`];
  });
  return parts.length ? parts.join(' ') : neutralLegacyDescription(body);
}

// Fail locally if synthesis reintroduces clinical anatomy from earlier context.
// This is a draft validation, never a provider-policy retry or scene rewrite.
export function validatePhysicalIdentityImagePrompt({ prompt, provider, sexualized }) {
  if (usesNeutralPhysicalIdentity(provider, sexualized) && /\bbreasts?\b|\b\d{2,3}\s*[A-K]{1,3}\b|\b[A-K]{1,3}[- ]cup\b|\bcup[- ]?size\b|\bhigh[- ]projection\b/gi.test(prompt)) {
    throw Object.assign(new Error('Nonsexual draft contains anatomical identity wording'), { code: 'image_identity_serialization_invalid' });
  }
}

export const NEUTRAL_PHYSICAL_IDENTITY_PROMPT_RULE = 'The supplied physical identity is already serialized for an ordinary non-sexual photo. Preserve its visual silhouette without adding cup sizes, breast terminology, surgical details or chest-focused anatomy. Do not infer nudity, intimate posing or exposure from body shape. Describe the requested ordinary scene and complete clothing.';
