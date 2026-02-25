import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

/**
 * Extrahuje kontext z textu pomocou LLM (OpenAI) pre globálne jazyky.
 * Fallback na regex pre rýchlosť/error.
 */
export async function extractContextFromText({ text, sceneContext }) {
  const patch = {};
  const raw = (text || '').toString().trim();
  if (!raw) return null;

  // === PRIMÁRNE: LLM extrakcia (OpenAI) – univerzálne pre všetky jazyky ===
  try {
    const client = getLLMClient('openai');
    const model = MODELS.openai;  // napr. gpt-4o-mini alebo gpt-4o

    const prompt = `
Extrahuj aktuálne miesto, izbu, mesto, krajinu a čas dňa z tohto textu: "${raw}".

Vráť STRICT JSON iba, bez ďalších komentárov:

{
  "place": string | null,           // napr. "raňajky v hoteli", "pláž", "lietadlo na ceste do Tokya"
  "room": string | null,            // napr. "hotelová izba", null ak vonku/pláž/lietadlo
  "location_city": string | null,   // napr. "Dubaj", "Tokio", "Paríž"
  "location_country": string | null,// napr. "UAE", "Japonsko", "Francúzsko"
  "time_of_day": string | null      // "morning", "evening", "night" – v angličtine
}

Pravidlá:
- Ak nie je spomenuté, vráť null.
- Inferuj logicky (napr. "Jumeirah Beach" → city="Dubaj", country="UAE").
- Ak je outdoor (pláž, lietadlo, bar na pláži, vonku), room = null.
- Podporuj akýkoľvek jazyk sveta – analyzuj text v pôvodnom jazyku.
- Vždy vracaj konzistentné anglické kľúče a hodnoty pre DB.
`.trim();

    const response = await client.chat.completions.create({
      model,
      temperature: 0.1,  // veľmi nízka pre presnosť
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const output = response.choices[0]?.message?.content || '';
    let extracted = null;

    try {
      extracted = JSON.parse(output);
    } catch {
      // Skús vybrať JSON z textu ak LLM pridal extra slová
      const match = output.match(/\{[\s\S]*\}/);
      if (match) extracted = JSON.parse(match[0]);
    }

    if (extracted && typeof extracted === 'object') {
      if (extracted.place) patch.place = extracted.place;
      if (extracted.room !== undefined) patch.room = extracted.room;  // môže byť null
      if (extracted.location_city) patch.location_city = extracted.location_city;
      if (extracted.location_country) patch.location_country = extracted.location_country;
      if (extracted.time_of_day) patch.time_of_day = extracted.time_of_day;
    }
  } catch (e) {
    console.error('[CONTEXT_LLM_ERROR]', e?.message || e);
  }

  // === FALLBACK: regex (pre rýchlosť alebo ak LLM zlyhá) ===
  if (Object.keys(patch).length === 0) {
    const t = raw.toLowerCase();

    // Explicit "sme na/v/práve/teraz"
    let m = raw.match(/\b(sme\s+(práve\s+)?na\s+|teraz\s+sme\s+na\s+|sme\s+v\s+.+?\s+na\s+)(.+?)(?=[\.,;!?\n]|$)/i);
    if (m && m[3]) {
      const place = m[3].trim();
      if (place.length >= 3 && place.length <= 80) patch.place = place;
    }

    // Špeciálne prípady
    if (/\b(našom )?hoteli?\b/i.test(raw)) patch.place = patch.place || 'hotel';
    if (/\bna raňajk[áchy]?\b/i.test(raw)) patch.place = patch.place || 'raňajky';
    if (/\braňajkách? (v |na )?hoteli?\b/i.test(raw)) patch.place = 'raňajky v hoteli';
    if (/\breštauráci[ia]\b/i.test(raw)) patch.place = 'reštaurácia';

    // Outdoor → room null
    const isOutdoor = /\b(pláž|beach|terasa|balkón|bazén|bar na pláži|reštaurácia na pláži|vonku|na vonkajšej|lietadlo|plane|airplane)\b/i.test(raw);
    if (isOutdoor) {
      patch.room = null;
    } else {
      if (/\bhotelov[áa] izba\b|\bhotel room\b/i.test(t)) patch.room = 'hotelová izba';
      else if (/\bsp[aá]l[nň]a|\bposte[lľ]/i.test(t)) patch.room = 'spálňa';
      else if (/\bkuchy[nň]/i.test(t)) patch.room = 'kuchyňa';
    }

    // Time of day fallback
    if (/\b(ráno|raňajk[áchy]|dobré ráno|morning|good morning)\b/i.test(t)) patch.time_of_day = 'morning';
    else if (/\b(ve[čc]er|dobrý večer|evening|good evening)\b/i.test(t)) patch.time_of_day = 'evening';
    else if (/\b(noc|polnoc|night|midnight)\b/i.test(t)) patch.time_of_day = 'night';
  }

  return Object.keys(patch).length ? patch : null;
}