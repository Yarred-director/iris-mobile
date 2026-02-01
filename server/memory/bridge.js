// server/memory/bridge.js

export function formatBridgeBlock(sceneContext) {
  if (!sceneContext) return '';
  if (sceneContext.last_engine !== 'grok') return '';

  return `
RECENT CONTEXT (from other engine):
- interaction_mode: ${sceneContext.interaction_mode}
- last_engine_reply:
"${sceneContext.last_engine_reply}"

Continue coherently in the same interaction mode unless user changes it.
`;
}
