import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

/**
 * Extrahuje kontext z textu pomocou lacného aktuálneho OpenAI utility modelu.
 * Fallback na regex pre rýchlosť/error.
 */
export async function extractContextFromText({ text, sceneContext }) {
  const patch = {};
  const raw = (text || '').toString().trim();
  if (!raw) return null;

  try {
    const client = getLLMClient('openai');
    const model = MODELS.openaiUtility || MODELS.openai;

    const prompt = `
Extract the current place, room, city, country and time of day from this user message: ${JSON.stringify(raw)}.

Return STRICT JSON only:
{
  "place": string | null,
  "room": string | null,
  "location_city": string | null,
  "location_country": string | null,
  "time_of_day": string | null
}

Rules:
- If a value is not present or safely inferable, return null.
- Infer well-known geographic context when unambiguous (for example "Jumeirah Beach" -> city="Dubai", country="UAE").
- Outdoor places imply room=null.
- Understand any user language.
- Keep DB values concise and stable; time_of_day must be one of morning, afternoon, evening, night when present.
`.trim();

    const response = await client.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 300,
      input: [{ role: 'user', content: prompt }],
    });

    const output = response.output_text || '';
    let extracted = null;
    try {
      extracted = JSON.parse(output);
    } catch {
      const match = output.match(/\{[\s\S]*\}/);
      if (match) extracted = JSON.parse(match[0]);
    }

    if (extracted && typeof extracted === 'object') {
      if (extracted.place) patch.place = extracted.place;
      if (extracted.room !== undefined) patch.room = extracted.room;
      if (extracted.location_city) patch.location_city = extracted.location_city;
      if (extracted.location_country) patch.location_country = extracted.location_country;
      if (extracted.time_of_day) patch.time_of_day = extracted.time_of_day;
    }
  } catch (e) {
    console.error('[CONTEXT_LLM_ERROR]', e?.message || e);
  }

  if (Object.keys(patch).length === 0) {
    const t = raw.toLowerCase();

    const m = raw.match(/\b(sme\s+(práve\s+)?na\s+|teraz\s+sme\s+na\s+|sme\s+v\s+.+?\s+na\s+)(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[3]) {
      const place = m[3].trim();
      if (place.length >= 3 && place.length <= 80) patch.place = place;
    }

    if (/\b(našom )?hoteli?\b/i.test(raw)) patch.place = patch.place || 'hotel';
    if (/\bna raňajk[áchy]?\b/i.test(raw)) patch.place = patch.place || 'raňajky';
    if (/\braňajkách? (v |na )?hoteli?\b/i.test(raw)) patch.place = 'raňajky v hoteli';
    if (/\breštauráci[ia]\b/i.test(raw)) patch.place = 'reštaurácia';

    const isOutdoor = /\b(pláž|beach|terasa|balkón|bazén|bar na pláži|reštaurácia na pláži|vonku|na vonkajšej|lietadlo|plane|airplane)\b/i.test(raw);
    if (isOutdoor) {
      patch.room = null;
    } else {
      if (/\bhotelov[áa] izba\b|\bhotel room\b/i.test(t)) patch.room = 'hotelová izba';
      else if (/\bsp[aá]l[nň]a|\bposte[lľ]/i.test(t)) patch.room = 'spálňa';
      else if (/\bkuchy[nň]/i.test(t)) patch.room = 'kuchyňa';
    }

    if (/\b(ráno|raňajk[áchy]|dobré ráno|morning|good morning)\b/i.test(t)) patch.time_of_day = 'morning';
    else if (/\b(popoldnie|afternoon)\b/i.test(t)) patch.time_of_day = 'afternoon';
    else if (/\b(ve[čc]er|dobrý večer|evening|good evening)\b/i.test(t)) patch.time_of_day = 'evening';
    else if (/\b(noc|polnoc|night|midnight)\b/i.test(t)) patch.time_of_day = 'night';
  }

  return Object.keys(patch).length ? patch : null;
}
