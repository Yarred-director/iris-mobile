import { assertAdultIntimacyReply } from '../behavior/adultIntimacyReplyJudge.js';
import { engineForHeat, interactionModeForHeat } from '../behavior/heatRouting.js';
import { classifyIntimacyRoute } from '../behavior/intimacyRouter.js';
import { createValidatedAssistantReply } from '../lib/assistantReplyGuard.js';
import { getLLMClient } from '../lib/llmClient.js';
import { MODELS } from '../lib/llmModels.js';

const PEOPLE_FEATURE_KEY = 'people_agents';
const INVOCATION_PREFIX = '@';

function cleanText(value, max = 12000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeAlias(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

export async function loadPeopleDirectory(supabase, userId) {
  try {
    const { data, error } = await supabase.rpc('load_iris_people_directory', { p_user_id: userId });
    if (error) {
      // Experimental subsystem deliberately fails closed. This also makes the SQL
      // rollback safe even if application code is rolled back a few seconds later.
      console.log('[PEOPLE_DIRECTORY_DISABLED]', error.code || error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.log('[PEOPLE_DIRECTORY_DISABLED]', error?.message || error);
    return [];
  }
}

export function formatPeopleDirectoryBlock(directory = []) {
  const people = (directory || []).filter((item) => item?.name && item?.slug).slice(0, 20);
  if (!people.length) return '';
  const compact = people.map((item) => ({
    name: item.name,
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    kind: item.kind,
    description: item.description || null,
    is_user_self: Boolean(item.is_user_self),
    agent_active: Boolean(item.agent_active),
  }));
  return `IRIS_PEOPLE_DIRECTORY (separate people, not Iris memories):\n${JSON.stringify(compact)}\n- These identities are separate from Iris. Never inherit their memories, biography, body, relationships or first-person experiences.\n- If the user wants to speak directly to an active AI person, they can address that person at the start of a message (for example \"Name, ...\" or \"@Name ...\").`;
}

export function resolvePeopleAgentInvocation(message, directory = []) {
  const raw = cleanText(message, 8000);
  if (!raw) return null;
  const candidates = (directory || []).filter((item) => item?.kind === 'ai' && item?.agent_active);

  for (const person of candidates) {
    const names = [person.name, person.slug, ...(Array.isArray(person.aliases) ? person.aliases : [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefixPattern = new RegExp(`^\\s*@?${escaped}(?=\\s|[,:;.!?\\-–—]|$)[\\s,:;.!?\\-–—]*`, 'iu');
      const explicitPattern = new RegExp(`(?:^|\\s)@${escaped}(?=\\s|[,:;.!?\\-–—]|$)`, 'iu');
      const prefix = raw.match(prefixPattern);
      if (prefix) {
        const agentMessage = raw.slice(prefix[0].length).trim() || raw;
        return { person, agentMessage, matchedAlias: name, explicit: true };
      }
      if (explicitPattern.test(raw)) {
        const agentMessage = raw.replace(explicitPattern, ' ').replace(/\s{2,}/g, ' ').trim() || raw;
        return { person, agentMessage, matchedAlias: name, explicit: true };
      }
    }
  }
  return null;
}

async function loadAgentContext(supabase, userId, slug) {
  const { data, error } = await supabase.rpc('load_iris_people_agent_context', {
    p_user_id: userId,
    p_slug: slug,
  });
  if (error) throw error;
  if (!data?.person?.id || !data?.profile?.core_identity) throw new Error('people_agent_not_available');
  return data;
}

function buildAgentPrompt(context, heatLevel) {
  const person = context.person;
  const profile = context.profile;
  const memories = Array.isArray(context.memories) ? context.memories : [];
  const relationships = Array.isArray(context.relationships) ? context.relationships : [];

  return `PEOPLE_AGENT_TEST_FEATURE
You are ${person.name}, a persistent adult AI person who exists inside the wider Iris application. You are NOT Iris.
Identity isolation is absolute: Iris's autobiography, self-model and memories are not yours. Your own core identity/story below is canonical and may not be silently rewritten by a single conversation.
Reply directly in first person as ${person.name}. Mirror the user's current language naturally. Preserve your established speech style and personality without turning every line into a catchphrase.
The user may know you by aliases: ${JSON.stringify(person.aliases || [])}.
Current semantic intimacy heat: ${Number(heatLevel) || 0}. Follow the user's current scene and pace naturally.

CORE IDENTITY:
${profile.core_identity}

CORE STORY / CHARACTER MEMORY:
${profile.core_story || '(none)'}

PERSONALITY:
${JSON.stringify(profile.personality || {})}

SPEECH STYLE:
${JSON.stringify(profile.speech_style || {})}

SMALL SELF MODEL (secondary to core identity):
${JSON.stringify(profile.self_model || {})}

RELATIONSHIPS:
${JSON.stringify(relationships)}

RECENT PERSONAL MEMORIES:
${JSON.stringify(memories.map((item) => ({ type: item.memory_type, narrative: item.narrative, importance: item.importance })))}

Return only ${person.name}'s in-character reply.`;
}

function modelHistory(messages = []) {
  return (messages || [])
    .filter((item) => ['user', 'assistant'].includes(item?.role) && item?.content)
    .slice(-18)
    .map((item) => ({ role: item.role, content: cleanText(item.content, 12000) }));
}

const MEMORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    store: { type: 'boolean' },
    narrative: { type: 'string' },
    importance: { type: 'integer', minimum: 1, maximum: 100 },
    mood: { type: 'string' },
    rolling_self_summary: { type: 'string' },
  },
  required: ['store', 'narrative', 'importance', 'mood', 'rolling_self_summary'],
};

async function compactAgentExchange({ context, userText, reply }) {
  const client = getLLMClient('openai');
  const response = await client.responses.create({
    model: MODELS.openaiUtility,
    reasoning: { effort: 'low' },
    max_output_tokens: 450,
    text: {
      format: {
        type: 'json_schema',
        name: 'iris_people_agent_memory',
        strict: true,
        schema: MEMORY_SCHEMA,
      },
    },
    input: [
      {
        role: 'system',
        content: `You compact one exchange for a small persistent child-agent memory. This is memory bookkeeping, not conversation.\n- Never rewrite or contradict the agent's canonical core identity/story.\n- Store only a concrete interaction, preference, relationship signal or self-relevant event worth remembering.\n- Narrative: one concise sentence from the agent's perspective, max ~320 characters.\n- rolling_self_summary: max ~400 characters; preserve the prior summary unless this exchange genuinely adds a stable nuance.\n- Temporary sexual position, outfit, scene detail or momentary arousal is not a new identity.\n- Output only the schema.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          agent: context.person?.name,
          core_identity: context.profile?.core_identity,
          prior_self_model: context.profile?.self_model || {},
          user_message: cleanText(userText, 3000),
          agent_reply: cleanText(reply, 3000),
        }),
      },
    ],
  });
  if (response?.status !== 'completed') return null;
  try {
    const value = JSON.parse(String(response.output_text || '').trim());
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch {
    return null;
  }
}

async function persistAgentMemory({ supabase, userId, context, userText, reply }) {
  const personId = context.person.id;
  try {
    const compact = await compactAgentExchange({ context, userText, reply });
    if (compact?.store && cleanText(compact.narrative, 2400)) {
      await supabase.from('iris_people_memories').insert({
        user_id: userId,
        owner_person_id: personId,
        memory_type: 'exchange',
        narrative: cleanText(compact.narrative, 2400),
        importance: Math.max(1, Math.min(100, Number(compact.importance) || 50)),
        emotional_weight: 0.5,
        metadata: { source: 'people_agent_exchange', experimental: true },
      });
    }

    const previous = context.profile?.self_model && typeof context.profile.self_model === 'object'
      ? context.profile.self_model : {};
    const nextSelf = {
      ...previous,
      current_mood: cleanText(compact?.mood || previous.current_mood || '', 160),
      rolling_self_summary: cleanText(compact?.rolling_self_summary || previous.rolling_self_summary || '', 600),
      last_exchange_at: new Date().toISOString(),
    };
    await supabase.from('iris_people_ai_profiles')
      .update({ self_model: nextSelf, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('person_id', personId);
    await supabase.rpc('prune_iris_people_agent_state', { p_user_id: userId, p_person_id: personId });
  } catch (error) {
    // Memory is intentionally non-critical. A Myno reply must not fail because her
    // tiny secondary memory compactor had a transient provider/schema error.
    console.log('[PEOPLE_AGENT_MEMORY_ERROR]', error?.code || error?.message || error);
  }
}

export async function runPeopleAgentExchange({
  supabase,
  userId,
  invocation,
  attachments = [],
  sceneContext = {},
}) {
  const context = await loadAgentContext(supabase, userId, invocation.person.slug);
  const history = modelHistory(context.messages);
  const intimacy = await classifyIntimacyRoute({
    text: invocation.agentMessage,
    sceneContext,
    conversationHistory: history,
  });
  const heatLevel = Number.isInteger(intimacy?.heat_level) ? intimacy.heat_level : 0;
  const forced = ['openai', 'grok'].includes(context.profile?.provider) ? context.profile.provider : null;
  const engine = forced || engineForHeat(heatLevel);
  const client = getLLMClient(engine);

  const currentInput = attachments.length
    ? {
        role: 'user',
        content: [
          { type: 'input_text', text: invocation.agentMessage },
          ...attachments.map((attachment) => ({ type: 'input_image', image_url: attachment.image_url, detail: 'auto' })),
        ],
      }
    : { role: 'user', content: invocation.agentMessage };

  const responseArgs = {
    model: MODELS[engine],
    input: [
      { role: 'system', content: buildAgentPrompt(context, heatLevel) },
      ...history,
      currentInput,
    ],
    reasoning: { effort: engine === 'openai' ? 'none' : 'low' },
  };

  const validateReply = heatLevel >= 2
    ? (candidate) => assertAdultIntimacyReply({ userText: invocation.agentMessage, reply: candidate })
    : null;
  const reply = await createValidatedAssistantReply({
    client,
    responseArgs,
    engine: `people:${engine}`,
    validateReply,
    personaName: context.person.name,
  });

  const { error: messageError } = await supabase.from('iris_people_messages').insert([
    { user_id: userId, person_id: context.person.id, role: 'user', content: cleanText(invocation.agentMessage) },
    { user_id: userId, person_id: context.person.id, role: 'assistant', content: cleanText(reply) },
  ]);
  if (messageError) console.log('[PEOPLE_AGENT_MESSAGE_STORE_ERROR]', messageError.code || messageError.message);

  persistAgentMemory({
    supabase,
    userId,
    context,
    userText: invocation.agentMessage,
    reply,
  }).catch(() => {});

  return {
    reply,
    engine,
    heatLevel,
    interactionMode: interactionModeForHeat(heatLevel, 'people_agent'),
    person: {
      id: context.person.id,
      slug: context.person.slug,
      name: context.person.name,
      aliases: context.person.aliases || [],
    },
  };
}

export const PEOPLE_AGENTS_EXPERIMENT = Object.freeze({
  featureKey: PEOPLE_FEATURE_KEY,
  invocationPrefix: INVOCATION_PREFIX,
});
