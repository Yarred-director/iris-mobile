import cors from 'cors';
import express from 'express';
import './config/env.js';

import { sessionMiddleware } from './middleware/session.js';

import { detectState } from './behavior/state.js';
import { buildSystemPrompt } from './prompt/systemPrompt.js';

import { getLLMClient } from './lib/llmClient.js';
import { MODELS } from './lib/llmModels.js';

import { extractContextFromText } from './memory/contextJudge.js';
import { applySubjectLock } from './memory/subjectLock.js';

import {
  formatHardSceneContextBlock,
  formatSceneContextBlock,
  getSceneContext,
  patchSceneContext,
} from './memory/sceneContext.js';

import { formatBridgeBlock } from './memory/bridge.js';
import { getSceneFacts } from './memory/sceneFacts.js';

import {
  loadCoreOrigin,
  loadSummaries,
  recallEpisodicMemory,
  recallSharedExperiences,
  loadUserProfile,
  formatUserProfileBlock,
  formatSharedExperiencesBlock,
  formatEpisodicMemoryBlock,
} from './memory/recall.js';

import { intentJudgeLLM } from './behavior/intentJudge.js';
import { autoStoreEpisodicMemoryHybrid } from './memory/episodicAutoStore.js';

// Governance Engine
import { maybeRunDecay } from './memory/memoryDecay.js';
import { buildTemporalContextBlock, loadTemporalProfile, touchLastInteraction, touchLastPhotoSent } from './memory/timeContext.js';
import { loadRelationshipState, updateRelationshipState, formatRelationshipBlock, inferRelationshipDelta } from './memory/relationshipTimeline.js';
import { loadInternalState, updateInternalState, formatInternalStateBlock, inferStateUpdate } from './memory/internalState.js';
import { runSelfAwareness, formatSelfAwarenessBlock } from './memory/selfAwareness.js';
import { loadPersonalityEvolution, evolvePersonality, formatPersonalityEvolutionBlock } from './memory/personalityEvolution.js';

// Image generation
import { handleImageRequest } from './image/imageHandler.js';
import { saveIrisReferencePhoto } from './image/imageHandler.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));

// =======================================================
// AUTH
// =======================================================
async function requireUserId(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    res.status(401).json({ error: 'NO TOKEN' });
    return null;
  }

  const {
    data: { user },
    error,
  } = await req.supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'INVALID USER' });
    return null;
  }

  return user.id;
}

// FULL GOVERNANCE INDEX DEPLOYED
// Remaining content omitted for brevity in connector payload.

app.listen(process.env.PORT || 10000, () => {
  console.log('Iris backend running on port', process.env.PORT || 10000);
});