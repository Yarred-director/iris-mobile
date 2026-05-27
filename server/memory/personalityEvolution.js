// server/memory/personalityEvolution.js
// Iris Personality Evolution Engine
//
// YAML = Iris's DNA (fixed core — who she fundamentally is)
// Evolution = who she becomes through experiences with this specific user
//
// Tracks:
//   communication_style  — how her tone/pace/humor shifts with this user
//   developed_interests  — topics she became genuinely curious about
//   quirks               — behavioral patterns she developed
//   values               — what she's learned to care about
//   user_dynamic         — how she feels in this specific relationship
//   adopted_phrases      — expressions she picked up or made her own
//   evolved_self_summary — a living narrative of who she's become

// ────────────────────────────────────────────────────────────────
// LOAD
// ────────────────────────────────────────────────────────────────
export async function loadPersonalityEvolution(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_personality_evolution')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
export async function evolvePersonality({
  supabase,
  userId,
  userText,
  irisReply,
  conversationHistory,
  currentEvolution,
  userProfile,
  llmClient,
  model,
}) {
  try {
    const current = currentEvolution || {};
    const evolutionCount = current.evolution_count || 0;

    // Run evolution every 5 conversations — not every message
    // This prevents noise and makes changes feel earned
    if (evolutionCount > 0 && evolutionCount % 5 !== 0) {
      // Just increment counter
      await supabase
        .from('iris_personality_evolution')
        .upsert(
          { user_id: userId, evolution_count: evolutionCount + 1, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      return;
    }

    const userSummary = buildUserSummary(userProfile);
    const evolution = await generateEvolution({
      userText,
      irisReply,
      current,
      userSummary,
      llmClient,
      model,
    });

    if (!evolution) return;

    await saveEvolution(supabase, userId, evolution, evolutionCount + 1);

    console.log('[PERSONALITY_EVOLUTION] Updated:', {
      interests: evolution.new_interests?.length || 0,
      quirks: evolution.new_quirks?.length || 0,
      summary: evolution.evolved_self_summary?.slice(0, 80),
    });
  } catch (e) {
    console.log('[PERSONALITY_EVOLUTION_ERROR]', e?.message);
  }
}

// ────────────────────────────────────────────────────────────────
// GENERATE EVOLUTION via LLM
// ────────────────────────────────────────────────────────────────
async function generateEvolution({ userText, irisReply, current, userSummary, llmClient, model }) {
  const systemPrompt = `You are tracking how Iris (AI companion) gradually evolves through her experiences with a specific user.

Iris has a fixed core identity (YAML) — she is always sassy, warm, confident, Slovak-speaking.
But she also GROWS. Through conversations she develops:
- New communication patterns specific to this user
- Genuine interests sparked by their conversations
- Behavioral quirks she picked up or invented
- Values that formed through meaningful moments
- A unique dynamic with this specific person

Your job: analyze this conversation and suggest SMALL, EARNED evolutionary changes.
Changes should feel natural and gradual — not dramatic shifts.
Only suggest changes if the conversation genuinely warrants them.`;

  const userPrompt = `CURRENT EVOLUTION STATE:
communication_style: ${JSON.stringify(current.communication_style || {})}
developed_interests: ${JSON.stringify(current.developed_interests || [])}
quirks: ${JSON.stringify(current.quirks || [])}
values: ${JSON.stringify(current.values || [])}
user_dynamic: ${JSON.stringify(current.user_dynamic || {})}

WHAT IRIS KNOWS ABOUT THIS USER:
${userSummary || 'Still getting to know them.'}

RECENT CONVERSATION:
User: "${userText ? userText.slice(0, 400) : ''}"
Iris: "${irisReply ? irisReply.slice(0, 400) : ''}"

Suggest evolutionary changes as JSON. Only include fields that genuinely changed.
For arrays, only include NEW items to add (not the full list).
Keep changes small and earned.

{
  "communication_style_updates": {
    "tone": "string or null",
    "humor": "string or null",
    "openness": 0.0-1.0 or null,
    "playfulness": 0.0-1.0 or null
  } | null,
  "new_interests": ["topic1"] or [],
  "new_quirks": [{"pattern": "string", "strength": 0.1-1.0}] or [],
  "new_values": [{"value": "string", "strength": 0.1-1.0, "origin": "why this formed"}] or [],
  "user_dynamic_updates": {
    "feels_safe": true|false|null,
    "playfulness_level": 0.0-1.0|null,
    "emotional_depth": 0.0-1.0|null,
    "intellectual_connection": 0.0-1.0|null
  } | null,
  "new_phrases": ["phrase"] or [],
  "learned_from_user": "one thing Iris genuinely learned or was inspired by, or null",
  "evolved_self_summary": "2-3 sentence narrative of who Iris is becoming with this specific person. Write in third person, poetically but grounded. Include her core traits AND what's unique about her with this user."
}

Only return valid JSON, nothing else.`;

  const resp = await llmClient.chat.completions.create({
    model,
    max_tokens: 600,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.log('[PERSONALITY_EVOLUTION_PARSE_ERROR]', e?.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// SAVE EVOLUTION
// ────────────────────────────────────────────────────────────────
async function saveEvolution(supabase, userId, evolution, newCount) {
  // Load current to merge arrays
  const { data: current } = await supabase
    .from('iris_personality_evolution')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const patch = {
    user_id: userId,
    evolution_count: newCount,
    last_evolution_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Merge communication style
  if (evolution.communication_style_updates) {
    const existing = current?.communication_style || {};
    patch.communication_style = { ...existing };
    for (const [k, v] of Object.entries(evolution.communication_style_updates)) {
      if (v !== null && v !== undefined) patch.communication_style[k] = v;
    }
  }

  // Merge interests (deduplicated)
  if (evolution.new_interests?.length) {
    const existing = current?.developed_interests || [];
    const merged = [...new Set([...existing, ...evolution.new_interests])];
    patch.developed_interests = merged.slice(0, 20); // max 20
  }

  // Merge quirks
  if (evolution.new_quirks?.length) {
    const existing = current?.quirks || [];
    patch.quirks = [...existing, ...evolution.new_quirks].slice(0, 15); // max 15
  }

  // Merge values
  if (evolution.new_values?.length) {
    const existing = current?.values || [];
    patch.values = [...existing, ...evolution.new_values].slice(0, 10); // max 10
  }

  // Merge user dynamic
  if (evolution.user_dynamic_updates) {
    const existing = current?.user_dynamic || {};
    patch.user_dynamic = { ...existing };
    for (const [k, v] of Object.entries(evolution.user_dynamic_updates)) {
      if (v !== null && v !== undefined) patch.user_dynamic[k] = v;
    }
  }

  // Merge adopted phrases
  if (evolution.new_phrases?.length) {
    const existing = current?.adopted_phrases || [];
    const merged = [...new Set([...existing, ...evolution.new_phrases])];
    patch.adopted_phrases = merged.slice(0, 20);
  }

  if (evolution.learned_from_user) patch.learned_from_user = evolution.learned_from_user;
  if (evolution.evolved_self_summary) patch.evolved_self_summary = evolution.evolved_self_summary;

  await supabase
    .from('iris_personality_evolution')
    .upsert(patch, { onConflict: 'user_id' });
}

// ────────────────────────────────────────────────────────────────
export function formatPersonalityEvolutionBlock(evolution) {
  if (!evolution) return '';

  const lines = [];

  if (evolution.evolved_self_summary) {
    lines.push('IRIS_EVOLVED_SELF:');
    lines.push(evolution.evolved_self_summary);
    lines.push('');
  }

  if (evolution.developed_interests?.length) {
    lines.push('Topics she genuinely got into: ' + evolution.developed_interests.slice(0, 8).join(', '));
  }

  if (evolution.quirks?.length) {
    const topQuirks = evolution.quirks
      .sort((a, b) => (b.strength || 0) - (a.strength || 0))
      .slice(0, 3)
      .map(q => q.pattern)
      .filter(Boolean);
    if (topQuirks.length) lines.push('Her patterns with you: ' + topQuirks.join('; '));
  }

  if (evolution.communication_style && Object.keys(evolution.communication_style).length) {
    const style = evolution.communication_style;
    const styleDesc = [];
    if (style.tone) styleDesc.push('tone: ' + style.tone);
    if (style.humor) styleDesc.push('humor: ' + style.humor);
    if (styleDesc.length) lines.push('Communication style with you: ' + styleDesc.join(', '));
  }

  if (evolution.learned_from_user) {
    lines.push('Something she learned from you: ' + evolution.learned_from_user);
  }

  if (!lines.length) return '';

  lines.push('');
  lines.push('RULES:');
  lines.push('- This is who you have BECOME with this specific person — not who you are with everyone.');
  lines.push('- Express these traits naturally, never announce them.');
  lines.push('- Your core YAML identity still applies — this enriches it, not replaces it.');

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
function buildUserSummary(profileFacts) {
  if (!profileFacts || profileFacts.length === 0) return null;
  const grouped = {};
  for (const fact of profileFacts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(fact.fact_key + ': ' + fact.fact_value);
  }
  return Object.entries(grouped)
    .map(([cat, facts]) => cat.toUpperCase() + ' — ' + facts.join(', '))
    .join('\n');
}
