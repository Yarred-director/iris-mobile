import fs from 'node:fs';
import { Router } from 'express';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const router = Router();
const SOURCE = JSON.parse(fs.readFileSync(new URL('../../i18n/en.json', import.meta.url), 'utf8'));
const SOURCE_KEYS = Object.keys(SOURCE);
const bundles = new Map([['en', SOURCE]]);
const pending = new Map();
const CHUNK = 60;

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
}

async function translateChunk(entries, language) {
  const response = await getLLMClient('openai').responses.create({
    model: MODELS.openaiUtility || MODELS.openai,
    reasoning: { effort: 'none' },
    max_output_tokens: 6000,
    input: [
      { role: 'system', content: 'Translate the JSON values into the requested language for a companion app UI. Keep keys, {placeholders}, emoji, arrows and leading symbols such as ">" unchanged. Natural, warm, concise. Return only the JSON object.' },
      { role: 'user', content: `LANGUAGE: ${language}\n${JSON.stringify(entries)}` },
    ],
  }, { timeout: 60000, maxRetries: 1 });
  const parsed = JSON.parse(String(response?.output_text || '{}').replace(/```json|```/g, '').trim());
  const out = {};
  for (const [key, source] of Object.entries(entries)) {
    const value = typeof parsed?.[key] === 'string' ? parsed[key].trim() : '';
    // A translation that drops or invents placeholders is rejected per key.
    out[key] = value && placeholders(value) === placeholders(source) ? value : source;
  }
  return out;
}

async function buildBundle(language) {
  const result = {};
  for (let index = 0; index < SOURCE_KEYS.length; index += CHUNK) {
    const keys = SOURCE_KEYS.slice(index, index + CHUNK);
    Object.assign(result, await translateChunk(Object.fromEntries(keys.map((key) => [key, SOURCE[key]])), language));
  }
  return result;
}

export function normalizeLanguage(value) {
  const code = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(code) ? code : 'en';
}

// Public on purpose: the boot screen is translated before sign-in. Only the fixed source
// bundle can be translated, so this endpoint cannot be used as a free translation proxy.
router.get('/i18n/:lang', async (req, res) => {
  const language = normalizeLanguage(req.params.lang);
  try {
    if (!bundles.has(language)) {
      if (!pending.has(language)) {
        pending.set(language, buildBundle(language).then((bundle) => {
          bundles.set(language, bundle);
          return bundle;
        }).finally(() => pending.delete(language)));
      }
      await pending.get(language);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.json({ language, strings: bundles.get(language) });
  } catch (error) {
    console.log('[I18N_BUNDLE_ERROR]', language, error?.message);
    return res.json({ language: 'en', strings: SOURCE, fallback: true });
  }
});

export default router;
