import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const RELAY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    should_relay: { type: 'boolean' },
    target_slug: { type: 'string' },
    relay_message: { type: 'string' },
  },
  required: ['should_relay', 'target_slug', 'relay_message'],
};

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionedAiPeople(text, directory = []) {
  const raw = String(text || '');
  return (directory || []).filter((person) => {
    if (person?.kind !== 'ai' || !person?.agent_active) return false;
    const names = [person.name, person.slug, ...(Array.isArray(person.aliases) ? person.aliases : [])]
      .map((value) => clean(value, 120))
      .filter(Boolean);
    return names.some((name) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(name)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(raw));
  });
}

export async function classifyPeopleRelayRequest({ text, directory = [] }) {
  const mentioned = mentionedAiPeople(text, directory);
  if (mentioned.length !== 1) return null;
  const target = mentioned[0];
  const client = getLLMClient('openai');

  try {
    const response = await client.responses.create({
      model: MODELS.openaiUtility,
      reasoning: { effort: 'none' },
      max_output_tokens: 260,
      text: {
        format: {
          type: 'json_schema',
          name: 'iris_people_relay',
          strict: true,
          schema: RELAY_SCHEMA,
        },
      },
      input: [
        {
          role: 'system',
          content: `You classify whether the user is asking Iris to relay/say/ask something to a separate persistent AI person. Work semantically in any language.\n- should_relay=true only when the user wants Iris to communicate a message/question/request TO the named AI person.\n- Asking Iris ABOUT that person, describing that person, requesting that person's photo, or directly addressing that person is NOT a relay.\n- target_slug must be the supplied target slug when should_relay=true, otherwise empty string.\n- relay_message is the concise message Iris should pass to that person, preserving the user's meaning and language. Do not invent content.\nReturn only the schema.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            user_message: clean(text, 3500),
            candidate_target: { name: target.name, slug: target.slug, aliases: target.aliases || [] },
          }),
        },
      ],
    });
    if (response?.status !== 'completed') return null;
    const parsed = JSON.parse(String(response.output_text || '').trim());
    if (!parsed?.should_relay || parsed.target_slug !== target.slug || !clean(parsed.relay_message, 3500)) return null;
    return { person: target, relayMessage: clean(parsed.relay_message, 3500) };
  } catch (error) {
    console.log('[PEOPLE_RELAY_CLASSIFIER_ERROR]', error?.code || error?.message || error);
    return null;
  }
}
