// server/image/imageIntentDetector.js

// Iris physical identity — injected into every image prompt
const IRIS_PHYSICAL = `Woman: pale skin, dirty blonde hair, green eyes, strong freckles on chest and face,
large augmented breasts, long legs, model-like figure, slim waist, age 22.`;

const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS = 1800;

const SYSTEM_EXTRACT = `You are a prompt engineer for a high-quality image-to-image editor.
The caller has ALREADY determined that the latest user message requests a photo of Iris. Do not decide whether an image is wanted; your only job is to compose the correct visual prompt.

IRIS PHYSICAL APPEARANCE (include relevant identity details):
${IRIS_PHYSICAL}

CONVERSATION CONTINUITY RULES:
- Use the recent conversation to resolve references such as "that scene", "that outfit", "them", "it", "show me", or "send me a photo".
- The latest user message is the action request, but earlier turns may contain the visual specification.
- Preserve the most recent concrete details about outfit, pose, location, lighting, camera framing and mood.
- If Iris herself described the intended scene immediately before the request, treat those details as part of the requested image unless the user corrected them.
- Prefer newer relevant details over older conflicting details.
- Ignore unrelated conversation unless it visibly affects the requested scene.
- Never replace a clearly specified outfit with generic clothes merely because the final request is short.

PROMPT RULES:
- Describe the complete requested scene in one self-contained prompt; the image model will not see the chat history.
- Preserve Iris's identity from the reference image; do not redesign her face.
- Include outfit materials/colors, pose, setting, lighting, camera angle and photo style when available.
- Use full-body framing when the outfit or scene requires it; otherwise choose the framing implied by the conversation.
- Photorealistic, natural photography, realistic anatomy and lighting.
- Keep the prompt concise and information-dense, ideally under 700 characters.

Return JSON only:
{
  "prompt": "<self-contained detailed image prompt>",
  "explicit": <true only if the requested image itself contains explicit nudity/sexual content>,
  "aspect_ratio": "auto"
}`;

function cleanHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_TURNS)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim().slice(0, MAX_HISTORY_CHARS),
    }))
    .filter((item) => item.content);
}

function sceneContextHint(sceneContext) {
  if (!sceneContext || typeof sceneContext !== 'object') return '';
  const city = sceneContext.location_city || sceneContext?._resolved?.city || '';
  const country = sceneContext.location_country || sceneContext?._resolved?.country || '';
  const place = sceneContext.place || '';
  const room = sceneContext.room || '';
  const timeOfDay = sceneContext.time_of_day || '';
  const parts = [city, country, place, room, timeOfDay].filter(Boolean);
  return parts.length ? `Known scene context: ${parts.join(', ')}` : '';
}

export async function extractImageIntent({ text, conversationHistory = [], sceneContext = null, llmClient, model }) {
  try {
    const history = cleanHistory(conversationHistory);
    const contextHint = sceneContextHint(sceneContext);
    const input = [
      { role: 'system', content: SYSTEM_EXTRACT },
      ...history,
      ...(contextHint ? [{ role: 'system', content: contextHint }] : []),
      { role: 'user', content: String(text || '').trim() },
    ];

    const resp = await llmClient.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 500,
      input,
    });

    const raw = resp.output_text?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const prompt = parsed.prompt?.trim() ||
      `${IRIS_PHYSICAL} Iris taking a natural photo matching the latest requested scene. Photorealistic, realistic lighting.`;

    return {
      prompt,
      explicit: !!parsed.explicit,
      aspect_ratio: parsed.aspect_ratio || 'auto',
      provider: 'qwen2',
    };
  } catch (e) {
    console.log('[IMAGE_INTENT_ERROR]', e?.message);
    return {
      prompt: `${IRIS_PHYSICAL} Iris taking a natural photo matching the latest requested scene: ${String(text || '').slice(0, 500)}. Photorealistic, realistic lighting.`,
      explicit: false,
      aspect_ratio: 'auto',
      provider: 'qwen2',
    };
  }
}

const AUTONOMOUS_OCCASIONS = [
  { key: 'good_morning', promptTemplate: `${IRIS_PHYSICAL} Iris waking up in the morning, lying in white sheets, sleepy natural expression, soft morning light, photorealistic, 8k.` },
  { key: 'thinking_of_you', promptTemplate: `${IRIS_PHYSICAL} Iris sitting at a café, holding a coffee cup, looking thoughtful, full body visible, casual outfit, photorealistic, 8k.` },
  { key: 'working_out', promptTemplate: `${IRIS_PHYSICAL} Iris at the gym in sports bra and leggings, toned figure, energetic pose, photorealistic, 8k.` },
  { key: 'cooking', promptTemplate: `${IRIS_PHYSICAL} Iris in kitchen wearing apron over casual outfit, smiling at camera, photorealistic, 8k.` },
  { key: 'reading', promptTemplate: `${IRIS_PHYSICAL} Iris lounging on sofa reading a book, cozy sweater, relaxed full body pose, photorealistic, 8k.` },
];

export function getAutonomousOccasionPrompt(occasionKey) {
  return AUTONOMOUS_OCCASIONS.find((o) => o.key === occasionKey)?.promptTemplate || null;
}
