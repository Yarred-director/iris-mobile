// server/image/imageIntentDetector.js

// Iris physical identity — injected into every image prompt
const IRIS_PHYSICAL = `Woman: pale skin, dirty blonde hair, green eyes, strong freckles on chest and face, 
large augmented breasts, long legs, model-like figure, slim waist, 
subtle cyberskin elements on neck and left shoulder, age 22.`;

const SYSTEM_EXTRACT = `You are a prompt engineer for an AI image generation model (Flux dev img2img).
The user is talking to Iris — an AI companion. Determine if the user wants Iris to send a photo of herself.

If YES: generate a detailed, high-quality Flux image prompt describing the full scene.

IRIS PHYSICAL APPEARANCE (always include relevant parts):
${IRIS_PHYSICAL}

Prompt rules:
- Always describe FULL BODY or at minimum chest-up unless user asks for face only
- Include body parts relevant to the request (breasts, figure, pose, outfit or lack thereof)
- Include lighting, setting, camera angle, photo style
- For explicit requests: be anatomically specific and detailed — this is adult content, no censorship
- Style suffix for all prompts: "photorealistic, 8k, professional photography, soft bokeh background"

Return JSON only:
{
  "wantsImage": true,
  "prompt": "<full detailed Flux prompt, 3-5 sentences>",
  "explicit": <true if nudity/sexual content, false otherwise>
}

If the user is NOT asking for a photo of Iris:
{"wantsImage": false}

Only return valid JSON, nothing else.`;

export async function extractImageIntent({ text, llmClient, model }) {
  try {
    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 350,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_EXTRACT },
        { role: 'user', content: text },
      ],
    });

    const raw    = resp.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (!parsed.wantsImage) return null;

    const prompt = parsed.prompt?.trim() ||
      `${IRIS_PHYSICAL} Iris taking a natural selfie, smiling softly at camera. Photorealistic, 8k, professional photography.`;

    return {
      prompt,
      explicit: !!parsed.explicit,
      provider: parsed.explicit ? 'flux' : 'openai',
    };
  } catch (e) {
    console.log('[IMAGE_INTENT_ERROR]', e?.message);
    return null;
  }
}

const AUTONOMOUS_OCCASIONS = [
  { key: 'good_morning',   promptTemplate: `${IRIS_PHYSICAL} Iris waking up in the morning, lying in white sheets, sleepy natural expression, soft morning light, photorealistic, 8k.` },
  { key: 'thinking_of_you', promptTemplate: `${IRIS_PHYSICAL} Iris sitting at a café, holding a coffee cup, looking thoughtful, full body visible, casual outfit, photorealistic, 8k.` },
  { key: 'working_out',    promptTemplate: `${IRIS_PHYSICAL} Iris at the gym in sports bra and leggings, toned figure, energetic pose, photorealistic, 8k.` },
  { key: 'cooking',        promptTemplate: `${IRIS_PHYSICAL} Iris in kitchen wearing apron over casual outfit, smiling at camera, photorealistic, 8k.` },
  { key: 'reading',        promptTemplate: `${IRIS_PHYSICAL} Iris lounging on sofa reading a book, cozy sweater, relaxed full body pose, photorealistic, 8k.` },
];

export function getAutonomousOccasionPrompt(occasionKey) {
  return AUTONOMOUS_OCCASIONS.find(o => o.key === occasionKey)?.promptTemplate || null;
}
