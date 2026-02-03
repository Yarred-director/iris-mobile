// server/memory/bridge.js

export function formatBridgeBlock(sceneContext) {
  if (!sceneContext) return '';

  // Only bridge when last_engine was grok
  if (sceneContext.last_engine !== 'grok') return '';

  // Prefer explicit bridge_buffer (latest exchange)
  const b = sceneContext.bridge_buffer;

  if (Array.isArray(b) && b.length) {
    const lines = b
      .slice(-4)
      .map(x => `- ${x.role}: ${String(x.content || '').slice(0, 600)}`)
      .join('\n');

    return `

RECENT CONTEXT (bridge from other engine):
${lines}

Continue coherently in the same interaction mode unless user changes it.
`;
  }

  // Fallback: use last_engine_reply only
  return `

RECENT CONTEXT (from other engine):
- interaction_mode: ${sceneContext.interaction_mode}
- last_engine_reply:
"${sceneContext.last_engine_reply}"

Continue coherently in the same interaction mode unless user changes it.
`;
}
