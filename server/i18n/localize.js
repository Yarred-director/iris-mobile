// Automatic localization of server-originated lines. English source strings are data;
// any other language is translated once by the utility model and cached in-process.
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

export const SOURCE_LINES = Object.freeze({
  image_generation_failed: 'Oops, something went wrong with the photo. Try again in a moment.',
  image_daily_limit_reached: "Today's photo limit is used up ({used}/{limit}).",
  image_face_missing: "I don't have a face to start from yet. Describe how I look, or add a face reference pack in the menu.",
  people_image_failed: "I couldn't create {name} right now. Try again in a moment.",
});

const cache = new Map();
const MAX_CACHE = 2000;

function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (values[key] ?? `{${key}}`));
}

async function translate(text, language) {
  const response = await getLLMClient('openai').responses.create({
    model: MODELS.openaiUtility || MODELS.openai,
    reasoning: { effort: 'none' },
    max_output_tokens: 200,
    input: [
      { role: 'system', content: 'Translate the user text into the requested language. Keep {placeholders} and emoji unchanged. Output only the translation, in a warm, natural, casual voice.' },
      { role: 'user', content: `LANGUAGE: ${language}\nTEXT: ${text}` },
    ],
  }, { timeout: 15000, maxRetries: 0 });
  const output = String(response?.output_text || '').trim();
  return output || text;
}

export async function localizedLine(key, language, values = {}) {
  const source = SOURCE_LINES[key] || key;
  const lang = String(language || '').trim().toLowerCase().slice(0, 12);
  if (!lang || lang === 'en') return fill(source, values);
  const cacheKey = `${lang}:${key}`;
  if (!cache.has(cacheKey)) {
    try {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, await translate(source, lang));
    } catch (error) {
      console.log('[I18N_TRANSLATE_ERROR]', error?.message);
      return fill(source, values);
    }
  }
  return fill(cache.get(cacheKey), values);
}
