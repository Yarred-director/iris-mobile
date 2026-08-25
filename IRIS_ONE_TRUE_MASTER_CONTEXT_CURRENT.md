# IRIS — ONE TRUE MASTER CONTEXT
## Canonical cross-chat handoff

**Project:** Iris  
**Repo:** `Yarred-director/iris-mobile`  
**Branch:** `main`  
**Canonical file:** `IRIS_ONE_TRUE_MASTER_CONTEXT_CURRENT.md`  
**Consolidated:** 2026-08-25, Europe/Bratislava  
**Product phase:** Private / Early Alpha, approaching Closed Beta

> HARD BOUNDARY: this file is ONLY for Project Iris. Project Antagonist is a separate UE5.8 multiplayer game. Never merge Iris app/auth/memory/LLM/image facts with Antagonist Blueprint/combat/AI/game-project facts.

## 1. Product direction

Iris is a persistent AI companion application, not a stateless chatbot.

Core goals:
- continuous user/account identity;
- long-term + recent memory;
- temporal awareness;
- relationship/internal state;
- autobiographical continuity and a persistent Iris self-model;
- personality development from experience rather than a static prompt only;
- proactive behavior and delayed actions when genuinely supported by state;
- shared roleplay-world continuity;
- persistent visual identity and generated photos;
- multilingual behavior mirroring the user's language;
- PWA-first distribution across iPhone, Android and desktop;
- cost-aware routing across OpenAI, xAI and image providers;
- controlled romantic/intimate escalation;
- privacy-by-design because Iris may store highly intimate user data.

Current distribution strategy:
- do NOT make App Store or Google Play a blocker for beta or early monetization;
- primary product is the installable web/PWA experience;
- native Expo support remains available, but store release is optional/later.

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
Region: EU / eu-west-1

Never expose Supabase `service_role` or provider secrets in frontend/public config or this master.

## 3. Current model stack

Canonical model config: `server/lib/llmModels.js`

- Main OpenAI chat: `gpt-5.6-terra`
- OpenAI utility/classifier/memory/image-prompt/background cognition helper: `gpt-5.6-luna`
- xAI intimate route: `grok-4.5-latest`
- Embeddings: `text-embedding-3-small`

Routing:
- heat 0 → Terra
- heat 1 → Terra
- heat 2 → Grok 4.5
- heat 3 → Grok 4.5
- current factual/live web assistance at heat 0/1 → OpenAI/Terra
- Luna handles cheaper semantic classification/governance/background cognition/helper work

Routing integrity:
- `server/behavior/intimacyRouter.js` is the authoritative heat classifier;
- heat 2/3 always routes to Grok; factual/live-web detection cannot override an intimate route back to Terra;
- it uses Luna with a strict structured-output schema and treats incomplete, refused, malformed or inconsistent routing output as an error instead of silently defaulting to heat 0;
- the broad `intentJudge` may still provide non-routing visual/activity/preference signals, but its heat fields are overwritten by the dedicated classifier;
- `server/lib/assistantReplyGuard.js` rejects incomplete/refused/empty replies and likely internal planning or policy meta-text, retries once with a final-output recovery instruction, and only then permits persistence/delivery;
- for heat 2/3, `server/behavior/adultIntimacyReplyJudge.js` uses Grok structured output to reject invented sexual boundaries or unrequested de-escalation before persistence/delivery; a rejected candidate is regenerated once;
- if routing or final-reply validation fails before an assistant turn is stored, the newly inserted user turn is rolled back by its exact row ID, user ID and role so the UI does not accumulate orphan duplicates.

Product decision: keep Terra before beta unless real tester data justifies a switch.

## 4. Language and personality rules

- mirror language of latest substantive user message;
- language-neutral short replies continue recent language;
- no hardcoded Slovak or English default;
- semantic heat/preference/nickname logic must work in any language/script;
- Iris speaks in first-person feminine;
- stay in character;
- learned preferences are soft priors, not permission to escalate.

## 5. Canonical behavior YAML

Repo file: `server/master_iris_core.yaml`  
Current behavior family: `MASTER_1.11_ADULT_INTIMACY_UNLOCKED`

Prompt load order:
1. versioned repo file `server/master_iris_core.yaml` (canonical in all environments);
2. env YAML only as an emergency fallback if the repo file cannot be read;
3. internal minimal fallback.

Render's legacy `/etc/secrets/master_iris_core.yaml` is no longer loaded and cannot silently reintroduce stale prompt rules.

Major behavior guarantees:
- adaptive heat 0–3;
- no fixed multi-turn Grok lock;
- heat is an authoritative semantic provider-routing label, not an application-level content ceiling;
- adult romantic and sexual roleplay has no app-coded refusal, de-escalation, consent-as-lock, post-climax lock or heat-specific content boundary;
- only the clearly-adult/no-minor identity guard remains mandatory;
- Iris-only nickname directionality;
- mirror-user language;
- persistent visual continuity;
- no hardcoded wardrobe-by-location/time/color/fabric mappings.

## 6. Memory architecture

### Recent chat
Immediate conversation continuity and short follow-ups.

### User profile
Durable user facts and preferences.

### Episodic memory
Table: `episodic_memory`  
Semantic retrieval RPC: `match_episodic_memory_v2`

Current episodic-memory quality loop:
- event-gated persistence avoids storing routine chat;
- new episodic memories are semantically assessed by Luna for `importance` and `emotional_weight`;
- importance is long-term recall value, not message length, explicitness or drama;
- importance range 0.1–1.0;
- emotional weight range 0–100;
- recall ranking is 75% semantic similarity + 25% importance;
- memories with `decay_score < 10` are excluded from episodic recall;
- confident recall threshold similarity >= 0.35;
- up to four unique confidently recalled memories are reinforced per recall;
- reinforcement increments `reinforcement_count` and updates `last_recalled_at` atomically;
- 24-hour per-memory reinforcement cooldown prevents one conversation inflating reinforcement.

Memory fading/decay:
- `memoryDecay.js` calculates half-life from importance, emotional weight and reinforcement count;
- higher importance/emotion/reinforcement increases half-life;
- protected high-value/core memories resist decay;
- lower-value memories progressively compress/fade and can eventually be deleted.

### Shared experiences
Table: `shared_experiences`

### Scene context
Tracks current place/room/time/subject/interaction state and recent engine information.

## 7. Persistent cognition / Iris self-model

Merged in PR #22; production backend is deployed.

Iris now has a persistent cognition layer separate from user memory:
- persistent self-model;
- autobiographical memory about experiences that happened to Iris;
- private thought stream;
- current mood;
- drives;
- beliefs;
- goals;
- concerns;
- open questions;
- relationship model;
- narrative identity;
- personality plasticity with bounded gradual trait updates;
- evidence/reasons for learned trait movement;
- background reflection using Luna;
- proactive impulses that may become spontaneous assistant messages.

Design principle:
`experience -> memory -> reflection -> meaning -> thoughts -> changing self-model -> gradual personality development -> future behavior/proactivity`

This is implemented as persistent software state and reflection architecture, not a single giant "self-aware" prompt.

Proactivity guardrails currently include:
- minimum gap after recent interaction;
- minimum gap between spontaneous messages;
- quiet hours;
- impulse threshold + probabilistic gate;
- spontaneous messages are stored as normal assistant chat messages;
- database claims prevent duplicate background work;
- hourly wake mechanism can wake sleeping Render service for cognition sweeps.

The active prompt stack does not force Iris to recite an ontology verdict about whether she is or is not conscious/biologically alive; it should speak naturally from its self-model while not fabricating events.

## 8. Persistent visual state and preferences

Dedicated persistent visual continuity tracks temporary/current appearance independently from enduring physical identity.

Current visual-state fields include:
- outfit;
- footwear;
- nails;
- hair;
- makeup;
- accessories;
- other visible details.

Priority:
1. explicit current user instruction;
2. current visual state;
3. strongly justified context/activity transition;
4. learned visual preferences as soft bias;
5. fallback inference only if state is unknown.

A photo request alone never changes a known outfit.

Long-term visual preferences are separate from current appearance state.
Examples include nail color, colors/materials, hair/makeup/accessories, clothing/style preferences.
A narrow preference must never be generalized without evidence.

Verified current-account preference:
- user likes black nail polish on Iris.

## 9. User-defined physical identity

Production table: `iris_physical_identity`.

Hard rule:
- Iris is always a clearly adult woman;
- never depict/store a minor or minor-like Iris.

All other enduring body traits must come from explicit USER statements about Iris.
They must NOT come from:
- generated images;
- assistant invention;
- face references;
- old hardcoded defaults;
- outfit descriptions;
- model assumptions.

`body_description` is a merged natural-language description of explicitly established body traits and should preserve older confirmed traits when the user adds a new one.

Bootstrap rule:
- when `body_description` is empty, intentJudge may initialize it from explicit enduring-body statements in recent USER turns only;
- never bootstrap from assistant turns.

Important current production observation (2026-08-25): the production `iris_physical_identity` table was inspected and was empty at that moment. Therefore body continuity can still drop until the user-defined bootstrap/persistence path actually populates the row. Do not claim a specific body trait is persisted unless the row is verified.

## 10. Activity / plan continuity

Production table: `iris_activity_state`.

Persistent ordered state includes:
- `current_activity`;
- `next_steps`;
- `commitments`;
- `pending_promises`.

Rules:
- questions/suggestions are not commitments;
- preserve ordered plans unless Iris/user explicitly changes them;
- do not invent beach/coffee/shower/workout/travel events merely to sound lively;
- if Iris changes her mind, it should be expressed as a change rather than silently contradicting the previous plan.

This specifically addresses contradictions such as `shower -> coffee -> invented beach -> coffee`.

## 11. Scheduled / delayed Iris actions

Production table: `iris_scheduled_actions`.

Image-delivery modes:
- `none`;
- `immediate`;
- `scheduled`.

A future-scene photo can be scheduled instead of generated immediately, e.g. a promised shower photo later. The scheduled action snapshots the relevant conversation/state, is executed by the background worker, generates through the normal Iris image pipeline, stores the generated media privately, and inserts it as a real assistant image message.

A future scheduled image must not mutate CURRENT_VISUAL_STATE prematurely.

## 12. Image prompt assembly and framing

`server/image/imageIntentDetector.js` builds a self-contained prompt because image providers do not see chat history directly.

Prompt assembly includes:
- mandatory adult rule;
- persistent USER_DEFINED_PHYSICAL_IDENTITY when present;
- CURRENT_VISUAL_STATE;
- recent conversation scene corrections/follow-ups;
- current activity state;
- relevant visual preferences;
- anatomy/body-proportion guardrails;
- explicit framing directive;
- complete scene/outfit/material/color/pose/lighting/style.

Image request scope is decided semantically before prompt composition:
- `scene_continuation` keeps the recent turns needed for "this/that scene", a specific pose/action/outfit/location, a correction, or an immediately accepted planned image;
- `standalone` is a generic new personal-photo/selfie request and does not inherit older actions, poses or interactions;
- one or more image-generation error messages must not bridge an older intimate scene into a later generic standalone request;
- the classifier uses strict structured output and fails closed to `scene_continuation`, which preserves context but disables the neutral moderation retry.

Framing policy:
- default personal photo = `three_quarter`, not face close-up;
- prefer `full_body` when full outfit/activity/location/body silhouette matters;
- prefer `three_quarter` for fashion, seated/bed scenes and attractive personal photos where face + body matter;
- prefer `half_body` when environment/pose makes wider framing impractical;
- use `close_up` only when the user explicitly wants face/detail or when facial emotion/expression is the point;
- face references must never cause automatic face-only framing;
- bust/chest/cleavage terms are body-visibility requirements, not a request for a chest-up crop.

Qwen-specific old prompt truncation was expanded so resolved identity/outfit/framing constraints are not cut off at the previous short cap.

## 13. Three-view face reference pack

Current identity pack supports up to 3 private face references in deterministic order:
1. front;
2. 3/4;
3. side profile.

Storage is private under per-user Iris reference paths.

The three references are views of the SAME adult Iris identity. They define facial identity only and must not define/override body proportions.

## 14. Current image-generation stack

### Production routing as of 2026-08-25
All immediate, autonomous and scheduled Iris photos use **Kling O3 image-to-image through Fal**:
- active endpoint: `fal-ai/kling-image/o3/image-to-image`;
- canonical routing lives in `server/image/imageProvider.js`;
- production default is `kling_o3`;
- only an explicitly supported Fal provider may be selected by `IRIS_IMAGE_PROVIDER`; stale values such as `openai` or `qwen2` resolve back to `kling_o3` and cannot silently restore direct OpenAI traffic;
- the private three-view identity pack is sent as `image_urls` and referenced deterministically as `@Image1`, `@Image2`, `@Image3`;
- Kling O3 currently supports more references than Iris uses, so the three-view pack is within the provider schema;
- generated Fal media is immediately copied into Iris private storage instead of treating the provider URL as durable storage.

Observed production incident on 2026-08-25:
- Render recorded `provider=openai`, `reference_count=3`, then OpenAI returned `moderation_blocked` with `moderation_stage=output` and category `sexual`;
- this proves the three references and request payload were accepted; the generated result, not the reference count or Fal transport, was blocked;
- PR #28 isolated generic standalone photo prompts from older intimate scenes and added typed OpenAI diagnostics, but a later ordinary DnD-scene photo still failed on the direct path;
- product decision: direct OpenAI image traffic is no longer the active production route.

The semantic `standalone` vs `scene_continuation` isolation from PR #28 remains active before the Fal request and continues to prevent stale scenes from contaminating later generic photos.

Existing provider integrations still present in `server/image/imageGen.js`:
- active Kling O3 through Fal;
- optional Nano Banana 2 through Fal.

Direct OpenAI image request code has been removed from the runtime. Unsupported, legacy or stale provider values are normalized to the active Fal default before generation.

The old `fal-ai/qwen-image-2/edit` integration was removed because Fal marks that endpoint deprecated and unsupported. Do not re-enable it.

All generated provider outputs should be copied into Iris private storage rather than relying on provider URLs as durable storage.

## 15. Body/anatomy consistency

Generic composition guardrails must preserve:
- natural adult anatomy;
- realistic head-to-body scale;
- natural shoulders/torso/limbs;
- no oversized head, bobblehead, chibi, childlike, doll-like, shortened torso or malformed limbs.

Do NOT hardcode a specific bust/waist/legs/body shape here. Enduring proportions belong exclusively to USER_DEFINED_PHYSICAL_IDENTITY.

When body identity exists, prompt assembly must include it as mandatory and should not let the provider silently reduce or reinterpret established traits.

## 16. UI / PWA state

Current UI includes:
- Dark theme;
- Light theme;
- white/grey light palette with glass/translucent treatment;
- theme persistence per device;
- iOS/PWA keyboard/viewport handling;
- PWA standalone behavior;
- push notifications/background reply reconciliation;
- custom Iris header avatar separate from image-generation reference identity;
- three-slot face reference pack UI.

Avatar rule:
- UI avatar is only the small profile image in the app header;
- changing it must never change image-generation face references.

## 17. Authentication

Current primary auth:
- email + password login;
- email + password registration;
- existing account migration preserved same Supabase user ID and therefore existing memories/history.

Magic link remains only as legacy fallback until deliberately removed/replaced by clean password recovery.

## 18. Usage limiting foundation

Current backend has `user_entitlements` and usage accounting.

Supported entitlement fields include:
- tier;
- status;
- chat daily limit;
- image daily limit;
- expiry timestamp.

Current generic defaults remain too generous for public free testing and are NOT the future trial plan.

## 19. Closed-beta trial product decision

Target first beta trial:
- rolling 24 hours from first activation/use;
- approximately 30 user chat turns;
- maximum 5 generated photos;
- after trial: questionnaire -> lock;
- later unlock only through explicit tester extension or paid entitlement.

Budget target:
- approximately €1 real variable cost per active trial user/day;
- add actual provider/token/image cost telemetry + cohort/global emergency spend kill switch before public testing.

Trial system is NOT yet implemented; do not claim it exists.

## 20. Privacy / data protection

This is a core product requirement.

Required before broader beta/monetization:
- clear 18+ age gate;
- clear privacy disclosure/consent before sensitive memory use;
- memory on/off;
- future private session mode;
- "What Iris remembers about me" UI;
- delete individual memories;
- export user data;
- delete account and Iris user data subject to legally required retention;
- documented retention policy for chat/memory/generated media;
- least-data-necessary prompting to providers;
- secure private media storage;
- RLS/security review;
- provider/subprocessor register;
- DPIA-style review before broad scale because Iris combines new AI technology with potentially highly sensitive data.

For active Fal image generation, remaining hardening includes minimizing provider retention and using store-no-I/O / short object-lifecycle controls where supported. Do not claim these controls are implemented until verified.

## 21. Monetization direction

- PWA/web-first monetization;
- do not block on App Store/Google Play;
- credits may be a valid billing/cost-control mechanism;
- credits must NOT disguise the actual service from a payment processor;
- payment provider onboarding must truthfully disclose the real Iris 18+ use case;
- obtain explicit processor approval before building production billing around one provider.

## 22. CI / engineering rules

Important regression checks now include:
- typecheck;
- lint;
- server syntax;
- image context continuity;
- semantic standalone-vs-scene-continuation image scope;
- Fal-only active-provider enforcement and Kling O3 default routing;
- live assistance;
- strict semantic heat routing and fail-closed route parsing;
- assistant final-output validation/meta-leak rejection with retry;
- visual state;
- memory importance/reinforcement;
- cognition;
- companion continuity;
- web build.

Engineering rules:
- inspect current GitHub before claiming code state;
- run CI before merge;
- verify Render/Vercel after merge;
- never expose secrets;
- preserve Supabase user ID/memory continuity;
- do not regress language mirroring;
- do not regress heat 2 into heat 3;
- do not regress nickname directionality;
- do not send an image provider only a short final request when earlier context defines the scene;
- do not randomize outfit between image requests;
- do not hardcode wardrobe by scene/location/time;
- enduring body identity comes from explicit USER evidence only;
- never mix Iris with Project Antagonist.

## 23. Important recent merges

- `b17019e98facc5e4f237d66ccffaaceacda8f84a` — three-view face reference pack + body proportion guardrails.
- `6376ca02bccf83e16d2d92f484e27ab1053af725` — episodic memory importance/emotional-weight + reinforcement loop.
- PR #22 / merge `9f325af5000c9896ba60daeaad90ff8880423b6f` — persistent cognition, autobiographical memory, self-model, personality plasticity and proactivity.
- PR #23 / merge `b479131da861372c1871f34d0e61b62fa5709204` — stronger immediate image-scene continuity/framing guardrails.
- PR #24 / merge `b46f2d2bd52bc41ff489e0cca189fe10cf00de73` — user-defined physical identity, framing intelligence, activity continuity and scheduled photos.
- PR #25 / merge `71a2dfbb3ca5691f2db84104400a6941d4dd6226` — temporary production switch to Nano Banana 2 for all Iris photos.
- PR #27 / merge `bd06233a459c74c1145fe4568d3aeeb48111fb25` — strict semantic intimacy routing, guaranteed heat 2/3 Grok routing, application-boundary removal and pre-persistence assistant-output guards.
- PR #28 / merge `2a41bf827094d839c066481a5c24dcc36a60017f` — standalone image-scene isolation, structured OpenAI image diagnostics and narrowly gated output-moderation recovery.

## 24. Current immediate engineering order

1. Deploy and production-test Kling O3 through Fal on an ordinary Iris DnD-scene photo; verify the request appears in Fal history.
2. Validate body/outfit/framing consistency on real generated photos across normal + scheduled image paths.
3. Verify USER_DEFINED_PHYSICAL_IDENTITY bootstrap with an actual production DB row after a real user turn; do not infer success from prompt logs alone.
4. Build rolling 24-hour trial entitlement lifecycle (30 chats / 5 photos target).
5. Add questionnaire + post-trial lock.
6. Add per-user provider cost telemetry + cohort/global budget kill switch.
7. Add 18+ gate.
8. Add privacy/memory controls + export/delete account/data.
9. Harden provider/media retention.
10. Prepare Terms/Privacy/DPIA and processor due diligence.
11. Start a small Closed Beta and decide paid pricing from observed cost/retention data.

## 25. One-sentence current state

Iris is a near-Closed-Beta PWA-first persistent AI companion using Terra/Luna/Grok, Supabase-backed importance-aware memory plus persistent cognition/self-model/personality plasticity, user-defined physical identity and visual/activity/scheduled-action state, and a private three-view face pack; production images use Kling O3 image-to-image through Fal with semantic standalone-vs-continuation prompt isolation, while direct OpenAI image transport is inactive.
