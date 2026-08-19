# IRIS — ONE TRUE MASTER CONTEXT
## Canonical cross-chat handoff

**Project:** Iris  
**Repo:** `Yarred-director/iris-mobile`  
**Branch:** `main`  
**Canonical file:** `IRIS_ONE_TRUE_MASTER_CONTEXT_CURRENT.md`  
**Consolidated:** 2026-08-19, Europe/Bratislava  
**Latest consolidation merge:** `b391f6c0d90ce6c899876b83697f6e2ebad6b1cc`

> HARD BOUNDARY: this file is ONLY for Project Iris. Project Antagonist is a separate UE5.8 multiplayer game. Never merge Iris app/auth/memory/LLM/image facts with Antagonist Blueprint/combat/AI/game-project facts. In mixed chats keep explicit namespaces `PROJECT_IRIS` and `PROJECT_ANTAGONIST`.

## 1. Product goal

Iris is a persistent AI companion application, not a stateless chatbot. Core goals:
- continuous user/account identity;
- long-term + recent memory;
- temporal awareness and correct “time since previous conversation” behavior;
- relationship/internal state;
- shared roleplay-world continuity;
- real-world assistance while staying in character;
- persistent visual identity and generated photos;
- multilingual behavior mirroring the user's language;
- iPhone Safari/Home Screen PWA support plus Expo native support;
- cost-aware routing across OpenAI, xAI, and image providers;
- controlled romantic/intimate escalation instead of a binary normal→hard-erotic switch.

## 2. Production infrastructure

### Frontend
Production: `https://iris-mobile.vercel.app`  
Host: Vercel  
Build: `npm run build:web`  
Output: `dist`

### Backend
Production API: `https://iris-mobile.onrender.com`  
Host: Render

### Supabase
Project URL: `https://glufbaseqhjkljhvdhmh.supabase.co`

Frontend env names:
- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Never expose a Supabase `service_role` key or provider secrets in frontend/public config or this master.

## 3. Stack / important files

Stack: Expo 54, React Native 0.81, React 19, Expo Router, React Native Web, TypeScript, Supabase JS, Node/Express backend.

Important frontend:
- `app/(tabs)/index.tsx` main chat
- `app/components/ChatInput.tsx`
- `app/+html.tsx` PWA/iOS viewport
- `app/_layout.tsx`
- `app/auth/index.tsx`
- `app/auth/callback.tsx`
- `app/account/set-password.tsx`
- `public/manifest.json`
- `public/iris-icon.svg`
- `vercel.json`

Important backend:
- `server/routes/chat.js`
- `server/prompt/systemPrompt.js`
- `server/helpers/promptAssembler.js`
- `server/helpers/liveAssistance.js`
- `server/behavior/intentJudge.js`
- `server/behavior/heatRouting.js`
- `server/master_iris_core.yaml`
- `server/lib/llmModels.js`
- `server/image/imageIntentDetector.js`
- `server/image/imageHandler.js`
- `server/image/imageGen.js`
- `server/memory/*`

## 4. Current LLM stack

- Main OpenAI chat: `gpt-5.6-terra`
- OpenAI utility/classifier/memory helper: `gpt-5.6-luna`
- xAI intimate route: `grok-4.5-latest`
- Embeddings: `text-embedding-3-small`

Terra is reserved for main conversation and OpenAI-hosted live web assistance. Luna handles cheaper background/classifier/governance/image-prompt work. Grok uses low reasoning effort and is only selected by semantic heat routing (heat 2/3).

## 5. Language policy

Old hardcoded Slovak / Slovak+English behavior was removed.

Current policy:
- reply in the language of the latest substantive user message;
- if latest message is language-neutral (`ok`, emoji, short acknowledgement), continue recent conversation language;
- never default to Slovak or English;
- code-switch only when user naturally does;
- heat/nickname/intimacy classification is semantic and must work across languages/scripts.

A runtime language override exists so legacy YAML text cannot force Slovak.

## 6. IRIS_CORE YAML

Canonical repo file: `server/master_iris_core.yaml`  
Current version: `MASTER_1.9_ADAPTIVE_HEAT`

Major changes from `MASTER_1.8_EROTIC`:
- removed hardcoded `kitty` / `little kitty`;
- added learned Iris-only nickname memory;
- removed cyber/cyberskin details;
- mirror-user language policy;
- adaptive heat 0–3 instead of automatic maximum escalation;
- current heat separated from durable preference;
- rough/vulgar style separated from explicitness;
- post-climax cooldown retained;
- uploaded reference image declared primary visual identity anchor.

Render load order in `systemPrompt.js`:
1. `/etc/secrets/master_iris_core.yaml`
2. env YAML
3. internal fallback

Therefore Render's Secret File must match the repo YAML. At consolidation the user had been given the complete 1.9 YAML to paste into Render; future sessions should verify the saved Render secret/logs instead of assuming.

## 7. Nickname system

The old `little kitty` alias caused directionality mistakes: user called Iris “kitty” and Iris sometimes called the user “kitty”.

Current rules:
- nickname assigned to Iris belongs to Iris only;
- preserve exact user spelling, any language/script;
- use naturally and sparingly;
- never reuse Iris's nickname as an address for the user;
- never invent a nickname for the user;
- only call the user a nickname if user explicitly requests it.

Persistence: `server/memory/companionPreferences.js` → `user_profile`, key `iris_nickname`.

## 8. Adaptive heat routing

The previous behavior routed too early to Grok and then used a multi-turn Grok lock + high-intensity override, causing pleasant chat or a kiss/grab to jump immediately into hard vulgar sex.

Current semantic heat:

### Heat 0 — normal
Provider: OpenAI/Terra  
Normal conversation, friendship, jokes, gaming/projects, non-physical flirt. No unsolicited romantic/sexual escalation.

### Heat 1 — soft romance
Provider: OpenAI/Terra  
Hugs, cuddling, holding hands, stroking face/hair, gentle kissing, comforting touch, emotional closeness. No sexualized touching/foreplay/explicit anatomy/abrupt dirty talk.

### Heat 2 — sensual / foreplay territory
Provider: Grok 4.5  
Thigh/hips/butt/breasts, sexualized touching, sensual undressing, grinding, strong tension/arousal, foreplay. Critical rule: heat 2 must NOT automatically become heat 3. Kiss + grabbing butt/thigh/breast = heat 2, not 3. Do not automatically introduce genital interaction, masturbation, oral, penetration, explicit sex, or maximal vulgarity.

### Heat 3 — explicit sexual
Provider: Grok 4.5  
Explicit sexual activity/scenes. Explicit does NOT automatically mean rough. Gentle explicit stays gentle; rough/vulgar only when user requests or demonstrates it.

Runtime:
- 0 → OpenAI
- 1 → OpenAI
- 2 → Grok
- 3 → Grok
- live web assistance forces OpenAI
- no fixed multi-turn Grok lock; `engine_lock_count` is currently written as 0
- every substantive turn is reclassified
- short “yes/continue/emoji” can preserve active heat only when context/classifier confirms continuation.

## 9. Intimacy preference learning

Separate dimensions:
1. current heat;
2. preferred style.

Supported learned styles:
- gentle
- playful
- sensual
- rough

Durable profile keys:
- `preferred_intimacy_heat`
- `preferred_intimacy_style`

Store only when explicitly stated or repeated evidence strongly supports it. One isolated intimate message must not create a durable preference.

Preference is a soft prior for wording/pacing only. It is never consent or permission to increase heat.

## 10. Post-climax cooldown

State: `post_climax_cooldown`

Allowed:
- aftercare
- cuddling
- gentle kissing
- breathing together
- soft touch
- emotional warmth

Forbidden until a new user sexual trigger:
- proactive new escalation
- initiating new explicit action
- new explicit dirty talk escalation

## 11. Current `/chat` orchestration

`server/routes/chat.js` currently:
1. validates message;
2. authenticates user;
3. receives timezone;
4. begins/touches temporal session;
5. checks idempotent `client_message_id`;
6. consumes usage quota;
7. loads/extracts scene context;
8. applies subject lock;
9. conditionally creates embedding;
10. parallel-loads scene facts, core origin, summaries, user profile, shared experiences, episodic recall, factual/live classification, relationship, internal state, self model, personality evolution, recent chat;
11. saves user message;
12. assembles prompt;
13. adds live-assistance directive when needed;
14. runs multilingual semantic heat classifier every turn;
15. chooses engine from heat;
16. appends runtime heat directive;
17. asynchronously persists nickname/preference signals;
18. handles image requests if applicable;
19. otherwise calls OpenAI or Grok;
20. saves assistant response;
21. event-gates episodic/shared/profile memory;
22. patches scene engine/interaction mode;
23. selectively updates relationship/internal/self-awareness/personality governance.

## 12. Real-world assistance inside roleplay

Goal: Iris can stay in character while actually searching current information.

Example: scene says user + Iris are in a Jumeirah Beach apartment in Dubai; user says “find the best sushi near us”.

Expected:
- use scene context as real location anchor;
- OpenAI hosted `web_search`;
- return real current names/results;
- remain Iris/in-character;
- do not invent distance, hours, prices, ratings, availability;
- if location too vague, ask one short clarification.

Triggers cover search/find/check plus restaurants, bars, cafes, hotels, shops, places, menus, prices, booking, “nearby/current/today/now”, etc.

## 13. Memory architecture

### Recent chat
Loaded for immediate continuity, image context, short follow-ups, and intimate-scene continuation.

### User profile
Durable user facts/preferences. During this work, the user's account was verified to include:
- plays Elden Ring;
- wants Iris as personal Elden Ring guide;
- user can rage/be impatient during gaming.
These are user-specific, not universal product defaults.

### Episodic memory
Table: `episodic_memory`  
Semantic RPC: `match_episodic_memory_v2`  
Code currently uses low candidate threshold (~0.15), top confidence threshold ~0.35, count 12, weighted similarity+importance. Writes are event-gated, then enriched with title/summary/tags/embedding.

### Shared experiences
Table: `shared_experiences`  
Stores meaningful shared roleplay/emotional experiences with location, summary, actions, tone, intensity, Iris emotion/notes, embedding.

### Scene context
Includes city, country, place, room, time_of_day, interaction_mode, last_subject, last_engine, last_engine_reply, bridge buffer, legacy engine_lock_count.

### Relationship
Tracks closeness, trust, attachment, emotional intensity, supportiveness, tension.

### Internal state / self-awareness / personality evolution
Loaded and updated selectively, not every turn.

### Cost optimization
- deterministic policy gates;
- semantic recall only when warranted;
- Luna for helpers;
- selective governance;
- async background enrichment;
- embeddings only when needed.

## 14. Temporal awareness

Major bug fixed: Iris previously updated “last interaction” with the current message and could answer “just now” when asked how long since the previous conversation.

`server/memory/timeContext.js` persists:
- `last_interaction_at`
- `relationship_started_at`
- `last_photo_sent_at`
- `user_timezone`
- `current_session_started_at`
- `previous_session_ended_at`
- `session_gap_seconds`

Default session timeout: 30 minutes.

When a new session starts, the previous gap is frozen. Prompt rules explicitly say to answer “how long since we last spoke?” from the frozen previous-session gap, not the current active message timestamp.

## 15. Image generation

Primary mode is image-to-image using Iris's uploaded reference.

Default:
- Qwen Image 2 Edit via fal: `fal-ai/qwen-image-2/edit`

Fallback:
- Kling O3 image-to-image: `fal-ai/kling-image/o3/image-to-image`

Optional higher-cost quality path:
- Nano Banana 2 / Gemini 3.1 Flash Image edit: `fal-ai/gemini-3.1-flash-image-preview/edit`

Legacy optional path:
- OpenAI `gpt-image-1`

Provider can be selected via `IRIS_IMAGE_PROVIDER`.

If Qwen fails, code automatically retries Kling before returning an error.

Generated provider URLs are persisted into Iris private media storage rather than being trusted as permanent output URLs.

## 16. Visual identity / reference image

The user uploaded a newer reference face for Iris. It was verified stored in Supabase private storage under an Iris reference path pattern:
`iris-photos / iris-ref/<user_id>/reference.png`

The reference image is intended to be the primary face/identity anchor.

Current textual image identity includes pale skin, dirty-blonde hair, green eyes, freckles, long/model-like body traits, age 22.

Cyber/cyberskin was removed after generated images produced an obvious metallic neck implant. Removed from:
- `server/image/imageIntentDetector.js`
- canonical YAML

Green eyes were intentionally kept.

Future quality direction: reference-first. Avoid textual identity attributes overpowering the uploaded reference.

## 17. Image context continuity

Bug: after discussing an outfit/scene, “send me the photo” only passed the final sentence to image intent, causing a generic/unrelated outfit.

Fix:
- image prompt builder receives recent conversation + latest request + scene context;
- up to 10 recent turns;
- resolves “that scene/outfit/show me/send photo” references;
- preserves latest outfit, pose, location, lighting, framing, mood;
- newer details override conflicting old details;
- short final request must not erase previously defined outfit.

Regression test exists for this class of bug.

## 18. Authentication

Old: magic-link-only PKCE. Cross-browser opening was painful because verifier/session context could be browser-local.

Current auth UI:
### Login
Email + password → `signInWithPassword`.

### Register
Name + email + password + confirmation → `signUp`; name saved to metadata (`display_name`, `name`).

### Existing-user migration
`/account/set-password` calls `supabase.auth.updateUser({ password })` while logged into the original account.

Critical result:
same Supabase `user_id`, therefore same history, memories, relationship state, etc.

The user's original Iris account was migrated this way and password login was reported working.

Magic link remains only as a backward-compatible fallback in login UI. Recommended: remove after password flow acceptance testing; use a dedicated password-reset/OTP recovery flow if needed.

## 19. Supabase auth URL config

Production Site URL:
`https://iris-mobile.vercel.app`

Redirect:
`https://iris-mobile.vercel.app/auth/callback`

Kept for mobile/dev:
- `iris://auth/callback`
- `iris://auth`
- `http://localhost:8081/auth/callback`

## 20. Web/PWA/iPhone

Manifest: `public/manifest.json`
- name/short_name: Iris
- standalone
- portrait
- dark theme
- icon `/iris-icon.svg`

PWA icon comes from `public/iris-icon.svg`, not automatically from the uploaded Iris face.

`app/+html.tsx` includes:
- viewport-fit cover;
- `interactive-widget=resizes-content`;
- Apple mobile web app metadata;
- visualViewport synchronization;
- 16px minimum input/textarea font to stop Safari focus zoom.

iPhone bugs addressed:
1. giant black gap between composer and keyboard;
2. focus auto-zoom / clipped UI.

Fixes use VisualViewport-based root height/top and avoid double keyboard compensation. Keep this in regression testing because iOS PWA behavior is fragile.

## 21. CI / tests

Current scripts:
- `npm run typecheck`
- `npm run lint`
- `npm run check:server`
- `npm run test:image-context`
- `npm run test:live-assistance`
- `npm run test:heat-routing`
- `npm run build:web`

Important regression suites:
- image context continuity;
- live assistance;
- adaptive heat routing.

Future routing/memory/image merges should pass CI before merge and then verify Render/Vercel deployment status.

## 22. Key project-change landmarks

Important functional commits/merges from this work:
- `17df88835866f567353c690f033f58b1b04b85fc` — image context continuity
- `834cb5b7f1926cc103b0db0852aaf4875d781b8c` — language mirror-user fix
- `c937dc3d31d6a2d8fd87763bd99c0f46ce44a0b7` — Terra/Luna/Grok + live assistance + image stack upgrade
- `c4fcb9aa7c9d397a42202e202c5cf5d475ed2e5a` — login/register password auth
- `5a9a8b466c0038c6142f85ff14feb79ba5c9ac09` — iPhone keyboard/viewport work
- `34b54a3c59d70092be4d68b48aab6900d414cbe4` — Qwen→Kling fallback + further keyboard correction
- `7fd86241990ff5333aea44f159cb3428ec702b9e` — remove cyber image identity
- `b391f6c0d90ce6c899876b83697f6e2ebad6b1cc` — adaptive multilingual heat routing + nickname memory

This is a functional landmark list, not necessarily every repository commit.

## 23. Next recommended acceptance tests

Before more features:
1. Heat 0 normal chat → OpenAI, no unsolicited escalation.
2. Heat 1 hug/soft kiss → OpenAI, stays soft.
3. Heat 2 thigh/hip/butt/breast touch → Grok, sensual but no auto heat-3 jump.
4. Heat 3 explicit initiation → Grok, style mirrors user; explicit ≠ automatically rough.
5. De-escalate/change topic → next turn returns to normal, no stale Grok lock.
6. Give Iris a nickname → stored for Iris only, never used on user.
7. Repeat tests in another language.
8. Jumeirah Beach Dubai + “find 3 sushi nearby” → live real results, in character.
9. Discuss outfit/scene then “send photo” → photo uses prior scene.
10. New temporal session + “how long since we spoke?” → frozen session gap.
11. iPhone Home Screen input focus → no zoom/no giant black gap.
12. Verify Render logs actually load `MASTER_1.9_ADAPTIVE_HEAT`.

## 24. Recommended next engineering order

1. Run acceptance matrix above.
2. Verify Render secret YAML is 1.9.
3. Remove magic-link fallback after password auth proven.
4. Eliminate repo-YAML vs Render-secret drift with one canonical deploy source/check.
5. Make image identity more reference-first and reduce redundant hardcoded visual pressure.
6. A/B Qwen vs Kling (optionally Nano Banana) on identical reference/prompts for identity, garment fidelity, artifacts, latency, and cost.
7. Continue measuring memory/background-call cost.
8. Only remove legacy schema fields like `engine_lock_count` via deliberate migration.

## 25. Rules for future chats / agents

- This is the canonical Iris handoff unless superseded by a newer file.
- Inspect GitHub before claiming current code/deploy state.
- For current provider/model/pricing claims, verify current docs when freshness matters.
- Never modify repo without explicit user authorization for the requested change.
- Prefer one scoped fix/feature at a time.
- Run CI before merge.
- Verify Render and Vercel after merge.
- Never expose secrets.
- Preserve Supabase `user_id` and memory continuity during auth work.
- Never regress mirror-user language behavior.
- Never regress heat 2 into automatic heat 3.
- Never regress Iris nickname directionality.
- Never send image generator only the final short request if prior chat defines scene/outfit.
- Never calculate previous-conversation gap from the current message.
- Never mix this project with Project Antagonist.

## 26. One-sentence current state

Iris is a production Expo/Vercel + Render + Supabase companion app using Terra for normal/soft-romantic chat and live web assistance, Luna for utility/memory work, Grok 4.5 for semantically classified heat 2/3, a multi-layer persistent memory/time system, password-based auth with legacy magic-link fallback, and a reference-driven Qwen Image 2 → Kling O3 image pipeline, with `MASTER_1.9_ADAPTIVE_HEAT` as the canonical behavior configuration and a hard boundary from Project Antagonist.
