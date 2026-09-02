import { Buffer } from 'node:buffer';

// Verified against full Fal OpenAPI schemas on 2026-09-02. The plugin's
// abbreviated parameter descriptions omit maxLength for several endpoints.
export const IMAGE_PROMPT_POLICIES = Object.freeze(Object.fromEntries([
  ['kling_o3', 2500, 1],
  ['qwen_image_max', 800, 1],
  ['openai_gpt_image_2', 32000, 2],
  ['grok_imagine_2', 8000, 1],
  ['nano-banana-2', 50000, 3],
].map(([provider, documentedMaxChars, minChars]) => [provider, Object.freeze({
  documentedMaxChars,
  minChars,
  maxChars: documentedMaxChars,
  // Conservative application transport envelope, NOT a claimed Fal byte limit.
  // Covers upstream validators that count UTF-8 rather than JS string units.
  maxUtf8Bytes: documentedMaxChars,
})])));

export function imagePromptMetrics(prompt) {
  return { chars: Array.from(prompt).length, utf8Bytes: Buffer.byteLength(prompt, 'utf8') };
}

function policyFor(provider) {
  const policy = IMAGE_PROMPT_POLICIES[provider];
  if (!policy) throw new Error(`Unknown image prompt policy: ${provider}`);
  return policy;
}

export function validateImagePrompt(provider, prompt) {
  const policy = policyFor(provider);
  const metrics = imagePromptMetrics(prompt);
  if (!prompt.trim() || metrics.chars < policy.minChars || metrics.chars > policy.maxChars || metrics.utf8Bytes > policy.maxUtf8Bytes) {
    const error = new Error(`Final ${provider} prompt exceeds its application budget or is empty`);
    error.code = 'image_prompt_budget_invalid';
    throw error;
  }
  return { ...metrics, ...policy };
}

function clipUtf8(value, maxBytes) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let output = '';
  let used = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (used + size > maxBytes - 3) break;
    output += character;
    used += size;
  }
  const boundary = output.lastIndexOf(' ');
  if (boundary > output.length * 0.65) output = output.slice(0, boundary);
  return output.trimEnd() + '…';
}

// Only compress known application boilerplate. User-authored scene details
// aren't classified, translated or rewritten here. Reserve separate budgets
// for body, appearance and scene so long prefixes cannot erase the scene tail.
function compactSections(source) {
  const parts = [];
  const scene = source
    .replace(/MANDATORY USER-DEFINED BODY IDENTITY: ([\s\S]*?)\. Preserve these body traits exactly; do not reduce, enlarge, replace or reinterpret them\./, (_, body) => {
      parts.push(`Body identity (preserve exactly): ${body}.`);
      return '';
    })
    .replace(/MANDATORY CURRENT VISUAL STATE: ([\s\S]*?)\. (?:Any outfit value is exhaustive: do not add visible clothing layers that are not named\. )?Preserve these exact established visible details and colors unless the current request explicitly changes them\./, (_, appearance) => {
      parts.push(`Appearance: ${appearance}.`);
      return '';
    })
    .replace(/Iris is a clearly adult woman\. Never depict her as a minor, underage, childlike, teen-like, or with minor-like body proportions\./g, '')
    .replace(/Natural adult female anatomy and realistic head-to-body scale\.[\s\S]*?or malformed limbs\./g, '')
    .replace(/Close-up portrait framing\. Use this only because[\s\S]*?emotional expression\./g, 'Close-up portrait.')
    .replace(/Half-body composition from head to hips\/waist,[\s\S]*?face-only portrait\./g, 'Half-body framing: head to waist, not face-only.')
    .replace(/Three-quarter composition from head to upper thighs or knees,[\s\S]*?environment context\./g, 'Three-quarter framing: head to thighs/knees; show outfit and setting.')
    .replace(/Full-body composition from head to feet with natural perspective,[\s\S]*?scene believable\./g, 'Full-body framing: head to feet; show complete outfit, pose and setting.')
    .replace(/\s+/g, ' ').trim();
  if (scene) parts.push(`Scene: ${scene}`);
  return parts;
}

export function fitImagePrompt({ provider, prompt, prefix = '', suffix = '' }) {
  const policy = policyFor(provider);
  const source = String(prompt || '').trim();
  if (!source) throw new Error('Image prompt is empty');
  const join = (parts) => parts.filter(Boolean).map((part) => part.trim()).join(' ');
  let output = join([prefix, source, suffix]);
  if (imagePromptMetrics(output).utf8Bytes > policy.maxUtf8Bytes) {
    const guard = 'Iris is a clearly adult woman, never a minor. Preserve facial identity and established body proportions; references define face only. Realistic anatomy and head/body scale. Outfit is exhaustive: no unrequested visible layers. Latest explicit scene details override older appearance.';
    const fixed = join([prefix, guard, suffix]);
    const parts = compactSections(source);
    const budget = policy.maxUtf8Bytes - Buffer.byteLength(fixed, 'utf8') - parts.length;
    if (!parts.length || budget < parts.length * 32) {
      throw Object.assign(new Error('Image prompt fixed instructions exceed budget'), { code: 'image_prompt_budget_invalid' });
    }
    const sizes = parts.map((part) => Buffer.byteLength(part, 'utf8'));
    const allocations = sizes.map((size) => Math.min(size, Math.floor(budget / parts.length)));
    let remaining = budget - allocations.reduce((sum, size) => sum + size, 0);
    // Give spare space to the scene first, then appearance and body identity.
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const extra = Math.min(remaining, sizes[index] - allocations[index]);
      allocations[index] += extra;
      remaining -= extra;
    }
    output = join([prefix, guard, ...parts.map((part, index) => clipUtf8(part, allocations[index])), suffix]);
  }
  validateImagePrompt(provider, output);
  return output;
}
