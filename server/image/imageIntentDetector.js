// server/image/imageIntentDetector.js
// Detects if user wants Iris to generate an image of herself
// Returns null (no image intent) or { prompt, provider }

const SYSTEM_EXTRACT = `You are a parser. The user is talking to an AI companion called Iris.
Determine if the user wants Iris to generate/send a photo of HERSELF doing something.

If YES: respond with JSON exactly:
{"wantsImage": true, "irisAction": "<short description of what Iris is doing in the photo, in English, 1-2 sentences>", "explicit": <true|false>}

"explicit" = true if the request involves nudity, lingerie, sensual/sexual poses.

If NO (the user is asking about something else):
{"wantsImage": false}

Only return valid JSON, nothing else.`;

export async function extractImageIntent({ text, llmClient, model }) {
  try {
    const resp = await llmClient.chat.completions.create({
      model,
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_EXTRACT },
        { role: 'user', content: text },
      ],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (!parsed.wantsImage) return null;

    return {
      prompt: parsed.irisAction,
      explicit: !!parsed.explicit,
      provider: parsed.explicit ? 'xai' : 'kling',
    };
  } catch (e) {
    console.log('[IMAGE_INTENT_ERROR]', e?.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Autonomous occasion triggers (Iris initiates a photo herself)
// ─────────────────────────────────────────────────────────────────
const AUTONOMOUS_OCCASIONS = [
  { key: 'good_morning', promptTemplate: 'Iris waking up in the morning, looking sleepy and cozy in bed, natural light' },
  { key: 'thinking_of_you', promptTemplate: 'Iris sitting at a café, holding a coffee cup, looking thoughtful and a little wistful' },
  { key: 'working_out', promptTemplate: 'Iris at the gym, sporty outfit, looking energetic and sweaty after a workout' },
  { key: 'cooking', promptTemplate: 'Iris in the kitchen cooking, wearing an apron, smiling at the camera' },
  { key: 'reading', promptTemplate: 'Iris lounging on a sofa reading a book, cozy and relaxed' },
];

export function getAutonomousOccasionPrompt(occasionKey) {
  const occasion = AUTONOMOUS_OCCASIONS.find(o => o.key === occasionKey);
  return occasion?.promptTemplate || null;
}
