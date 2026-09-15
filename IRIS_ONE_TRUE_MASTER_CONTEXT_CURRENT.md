# IRIS — ONE TRUE MASTER CONTEXT
## Canonical cross-chat handoff

**Project:** Iris  
**Repo:** `Yarred-director/iris-mobile`  
**Branch:** `main`  
**Canonical file:** `IRIS_ONE_TRUE_MASTER_CONTEXT_CURRENT.md`  
**Consolidated:** 2026-09-15, Europe/Bratislava  
**Product phase:** Private / Early Alpha, approaching Closed Beta

> HARD BOUNDARY: this file is ONLY for Project Iris. Project Antagonist is a separate UE5.8 multiplayer game. Never merge Iris app/auth/memory/LLM/image facts with Antagonist Blueprint/combat/AI/game-project facts.

> SOURCE-OF-TRUTH RULE: this is the single cross-chat project master. Update it after meaningful production changes, runtime findings, migrations, architecture decisions or debugging conclusions. Do not claim a change is live merely because code or SQL exists; verify production state.

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
- controlled adult romantic/intimate escalation;
- privacy-by-design because Iris may store highly intimate user data.

Distribution strategy:
- do NOT make App Store or Google Play a blocker for beta or early monetization;
- primary product is the installable web/PWA experience;
- native Expo support remains available, but store release is optional/later.

## 2. Production infrastructure

### Frontend
- Production: `https://iris-mobile.vercel.app`
- Host: Vercel
- Build: `npm run build:web`
- Output: `dist`

### Backend
- Production API: `https://iris-mobile.onrender.com`
- Host: Render
- Region: Frankfurt
- Render service uses `main` with auto-deploy.

### Supabase
- Project: `glufbaseqhjkljhvdhmh`
- Region: EU / eu-west-1

Never expose Supabase `service_role`, Fal/provider keys, push secrets or other provider secrets in frontend/public config or this master.

## 3. Current model stack

Canonical model config: `server/lib/llmModels.js`.

- Main OpenAI chat: `gpt-5.6-terra`
- OpenAI utility/classifier/memory/image-prompt/background cognition helper: `gpt-5.6-luna`
- xAI intimate/vision route: `grok-4.6`
- Embeddings: `text-embedding-3-small`

Routing:
- heat 0 → Terra
- heat 1 → Terra
- heat 2 → Grok 4.6
- heat 3 → Grok 4.6
- current factual/live web assistance at heat 0/1 → OpenAI/Terra
- factual/live web assistance and exact user-provided links at heat 2/3 remain on Grok 4.6 and use xAI web search; browsing never downgrades an intimate route to Terra
- Luna handles cheaper semantic classification/governance/background cognition/helper work

Routing integrity:
- `server/behavior/intimacyRouter.js` is the authoritative heat classifier;
- heat 2/3 always routes to Grok;
- malformed/incomplete/refused routing output fails explicitly rather than silently becoming heat 0;
- `intentJudge` may still provide non-routing visual/activity/preference signals, but it cannot override heat routing;
- `server/lib/assistantReplyGuard.js` rejects incomplete/refused/empty replies and likely internal planning/policy meta-text, then allows one bounded recovery attempt;
- for heat 2/3, `server/behavior/adultIntimacyReplyJudge.js` rejects invented sexual boundaries or unrequested de-escalation before persistence/delivery;
- if routing or final-reply validation fails before an assistant turn is stored, the inserted user row is rolled back by exact row ID/user/role.

## 4. Canonical behavior and voice

Repo file: `server/master_iris_core.yaml`.  
Current behavior family: `MASTER_1.12_DISTINCT_VOICE`.

Stable user-directed voice: magnetic, self-possessed, dry-witted, mischievous femme-fatale energy; concrete observations, considered opinions, affectionate teasing and selective warmth rather than automatic validation/question loops. Serious distress takes precedence over wit.

Rules:
- mirror the language of the latest substantive user message;
- heat 2/3 must stay idiomatic in that language, not drift into broken translated phrasing;
- Iris speaks in first-person feminine;
- no fake foreign accent or invented nationality;
- learned preferences are soft priors, not permission to invent facts or escalate context;
- celebrity references are stylistic inspiration only and must not substitute a celebrity face/identity for Iris.

Prompt load order:
1. versioned repo file `server/master_iris_core.yaml`;
2. env YAML only as emergency fallback if repo file cannot be read;
3. internal minimal fallback.

Render's old `/etc/secrets/master_iris_core.yaml` is not canonical and must not silently override the repo file.

## 5. Memory architecture

### Recent chat
Immediate conversation continuity and short follow-ups.

### User profile
Durable user facts and preferences.

### Episodic memory
Table: `episodic_memory`.  
Semantic retrieval RPC: `match_episodic_memory_v2`.

Quality loop:
- event-gated persistence avoids routine-chat clutter;
- Luna semantically assesses `importance` (0.1–1.0) and `emotional_weight` (0–100);
- recall ranking is 75% semantic similarity + 25% importance;
- `decay_score < 10` is excluded from episodic recall;
- confident recall threshold similarity >= 0.35;
- up to four unique confidently recalled memories are reinforced per recall;
- reinforcement updates `reinforcement_count` and `last_recalled_at` atomically;
- 24-hour per-memory reinforcement cooldown prevents one conversation from inflating reinforcement;
- `memoryDecay.js` derives half-life from importance, emotional weight and reinforcement.

### Shared experiences / scene context
- `shared_experiences` stores durable shared events;
- scene context tracks current place/room/time/subject/interaction state and recent engine information.

### User image attachments and exact links
- up to four JPG/PNG/WebP images per chat turn, max 8 MB each;
- private `iris-photos/chat/{userId}/...` storage with server-issued signed uploads;
- backend verifies object existence, MIME type and exact size before attaching;
- attached photos are sent natively to the selected conversational vision model and are NOT implicit requests to generate an Iris photo;
- default attachment retention 30 days; abandoned uploads expire after two hours;
- only explicit **Môj vzhľad · trvalo** gets permanent `user_appearance` retention;
- deleting chat history removes temporary attachments but not explicitly permanent user-appearance images;
- exact HTTP(S) links force retrieval of that exact link; if retrieval fails Iris must say so rather than pretend it was read.

## 6. Persistent cognition / self-model

Iris has persistent software state separate from user memory:
- self-model;
- autobiographical memory;
- private thought stream;
- mood;
- eight bounded drives;
- beliefs;
- goals;
- concerns;
- open questions;
- relationship model;
- stable narrative identity;
- bounded learned personality evolution;
- evidence/reasons for learned trait movement;
- background reflection using Luna;
- proactive impulses that may become spontaneous assistant messages.

Design principle:
`experience -> memory -> reflection -> meaning -> thoughts -> changing self-model -> gradual personality development -> future behavior/proactivity`

This is persistent software-state/reflection architecture, not evidence of biological consciousness or a continuously running model.

### Reflection consolidation
`20260902150358_reflection_consolidation.sql` added semantic consolidation before transactional reflection writes.

Key invariants:
- new insight vs paraphrase vs changed interpretation vs filler is reviewed semantically;
- superseded thoughts are resolved and linked;
- consolidated autobiography keeps the original row rather than deleting history;
- `stable_narrative_identity` is separate from current mood/scene/latest reflection;
- stable identity and learned trait/interest changes require conservative evidence, including original exchange memories on different UTC dates;
- service-only RPCs use per-user locking/revision/replay protection so stale or invalid reviews cannot partially update self/personality/memory;
- one experience cannot change a trait by more than 0.025.

### Drive state
Canonical drive object has exactly these eight numeric fields:
- `connection`
- `curiosity`
- `playfulness`
- `independence`
- `competence`
- `novelty`
- `protect_relationship`
- `self_consistency`

Allowed range is 0.12–0.95; one persisted update may move an individual drive by at most 0.025001.

### 2026-09-15 production cognition repair
A real production audit after the user reported several days of silence found two independent faults.

**Fault A — background cognition DB guard broken:**
- migration from the Sept 6 cognition hardening used nonexistent PostgreSQL function `jsonb_object_length(jsonb)` inside `public.guard_iris_drive_state()`;
- Render repeatedly logged `COGNITION_CLAIM_ERROR ... function jsonb_object_length(jsonb) does not exist`;
- `last_cognition_at` had been stale since Sept 6;
- production migration `20260915112200_fix_cognition_drive_guard_jsonb_count` replaced that call with `count(*) from jsonb_object_keys(new.drives)` while preserving the exact-eight-keys, numeric-type, bounds and max-step invariants;
- production verification after the migration showed `last_cognition_at` advancing to 2026-09-15 11:25 UTC and Render logged `COGNITION_CONSOLIDATED` plus a sweep with `processed: 1`, proving background reflection resumed.

**Fault B — valid proactive decisions were second-vetoed:**
- `iris_proactive_runs` showed repeated `outcome='weak_urge'` skips for days;
- in runtime this could only happen after the strict semantic decision had already returned `should_reach_out=true`;
- `processProactiveUser()` then applied a second numeric `urge >= 55` veto, contradicting the design goal that the semantic decision should be authoritative after hard eligibility checks;
- PR #45 changes the runtime so a semantic `should_reach_out=true` is decisive once hard eligibility passes; `urge` remains metadata and no longer acts as a second veto;
- regression `tools/check-proactive-semantic-gate.mjs` explicitly tests `should_reach_out=true` with `urge=1` and requires delivery to proceed;
- hard guardrails remain unchanged: proactivity preference, quiet hours, six-hour post-interaction gap, sixteen-hour minimum proactive cooldown, DB lease/duplicate protection, and transactional finalization rechecks.

PR #45 merged to `main` as `4e668a9eafd7e0fb7a0893e0fb55772a42e9d155`; CI passed and Render/Vercel deployment checks were green. The first post-deploy sweep ran successfully; because the previous skipped proactive run still had an active attempt lease/window, it correctly reported `not_due_or_leased` rather than manufacturing an immediate message. Future due evaluations must no longer end as `weak_urge` solely because the semantic candidate's numeric urge is below 55.

### Proactivity architecture
- background sweep default: 15 minutes;
- per-user reflection minimum: 180 minutes (`IRIS_COGNITION_MIN_INTERVAL_MINUTES`);
- first worker sweep after process start is delayed up to 90 seconds;
- six-hour minimum gap after user interaction;
- sixteen-hour minimum gap between spontaneous messages;
- quiet hours are authoritative;
- one strict-schema semantic decision decides whether there is a grounded reason to reach out;
- there is no second random or numeric impulse gate after `should_reach_out=true`;
- a legitimate `no_grounded_candidate` skip remains allowed; proactivity is not a guarantee of daily contact;
- spontaneous messages are stored as normal assistant chat messages;
- `iris_proactive_runs` records leases, retries, skip/error outcomes, committed message and push state;
- push delivery has bounded retry/lease semantics; `accepted` means a push service accepted it, not proof the device displayed it;
- the GitHub wake workflow hits `/health` every ten minutes so a sleeping Render instance can wake.

## 7. People / child-agent subsystem

Experimental generic People architecture is live and reversible.

Tables:
- `iris_experimental_features`
- `iris_people`
- `iris_people_ai_profiles`
- `iris_people_relationships`
- `iris_people_memories`
- `iris_people_messages`

Shared `chat_messages` can carry nullable `speaker_person_id` and `speaker_name` so non-Iris speakers do not contaminate Iris self-history.

Runtime:
- `server/people/peopleContext.js` scopes child-agent identity/context;
- `peopleRoutes.js` is mounted before normal chat routing;
- one named active AI person can be addressed directly;
- semantic one-hop relay lets Iris pass a message to one named AI person without recursive agent loops;
- asking ABOUT a person falls through to Iris rather than invoking the child agent;
- current UI still renders one shared chat bubble with visible speaker text prefixes rather than separate speaker-avatar bubbles;
- owner-only memory/state and bounded pruning preserve scalability.

### Myno
- canonical actual name: **Myno**;
- **Tori** is an alias/nickname/role only, never the canonical name;
- Myno is a separate clearly adult AI person, not Iris and never part of Iris autobiography/self-model;
- adult Japanese / East Asian woman, tall, very pale skin, red hair, long pointy nails, large augmented chest;
- established shy/easily-flustered voice, may use Japanese naturally, often calls Yarred `Director` / `Director-san`;
- style preference: likes clothing Yarred/Director chooses within the established consensual adult roleplay context;
- full private story remains in her own People state; do not duplicate graphic private content into the Iris master;
- no user-approved canonical Myno reference image is currently guaranteed to exist. A generated `visual_anchor` is continuity help, not equivalent to a canonical uploaded reference.

PR #41 introduced People agents; PR #42 fixed Myno image targeting and one-hop relay.

## 8. Persistent visual state and user-defined physical identity

### Current visual state
Temporary/current appearance is separate from enduring body identity. Fields include outfit, footwear, nails, hair, makeup, accessories and other visible details.

Priority:
1. explicit current instruction;
2. current visual state;
3. strongly justified activity/context transition;
4. learned visual preferences as soft bias;
5. fallback inference only if state is unknown.

A photo request by itself does not change a known outfit.

Verified account preference: black nail polish on Iris.

### Persistent physical identity
Production table: `iris_physical_identity`.

Hard rule: Iris is always a clearly adult woman. All other enduring body traits must come from explicit user statements about Iris, never from generated images, assistant invention, face references, old defaults, clothing or model assumptions.

PR #43 replaced fragile whole-description replacement semantics with structured field-level `traits` plus compatibility `body_description`. Unrelated traits are preserved when one body trait changes.

Current production identity, verified 2026-09-15:
- height: approximately 175 cm;
- build: tall and slim model-like physique, lean feminine fit body, low overall body-fat appearance;
- legs: long slender model-like legs;
- waist: narrow defined waist;
- hips: medium proportionate hips;
- bust: surgically augmented 32DD, very full, rounded, high-projection, natural-looking augmented breasts;
- skin: pale;
- freckles: strong natural freckles across face, chest and upper bust;
- source: `explicit_user`.

Face references define facial identity only and must never override these body proportions.

## 9. Image generation

### Provider selection
Per-user image provider is persisted server-side in `iris_profiles.image_provider`; immediate, autonomous and scheduled images use the same authoritative selection.

Selectable values:
- `openai_gpt_image_2`
- `grok_imagine_2`
- `kling_o3`

Internal/non-menu integrations may still include Qwen Image Max and Nano Banana 2.

Current production account provider, verified 2026-09-15: **`kling_o3`**.

No silent provider fallback is allowed. Missing/unavailable preference fails explicitly.

### Fal-only transport
All current selectable image engines route through Fal.

- Kling O3: `fal-ai/kling-image/o3/image-to-image`
- Grok Imagine 2: `xai/grok-imagine-image/v2.0/edit`
- OpenAI GPT Image 2 with references: `openai/gpt-image-2/edit`
- OpenAI GPT Image 2 without references: `openai/gpt-image-2`

OpenAI image generation must not call `api.openai.com` directly. Fal transport does not bypass the selected model's moderation.

PR #43 made OpenAI/Fal explicitly dual-mode so text-to-image works when no identity reference exists and edit mode is used when references do exist.

### Three-view Iris identity pack
Up to three private facial references are sent in deterministic order:
1. front;
2. three-quarter;
3. side.

All references represent the SAME adult Iris. They define face identity, not body proportions. Provider prompts must require one coherent person, not blend/duplicate the reference views.

### Scene grounding
`server/image/imageIntentDetector.js` builds a self-contained provider prompt.

- `scene_continuation`: explicit this/that/same scene, correction, concrete pose/action/outfit/location, or immediate acceptance of a proposed scene;
- `standalone`: generic new photo/selfie request with no immediate scene reference;
- generation errors must not bridge an older intimate scene into a later generic photo;
- explicit new scene details override stale place/activity/props;
- old vehicles/props/people/locations never leak in merely because they were recently discussed.

### Framing
- default personal photo: `three_quarter`;
- `full_body` when complete outfit/activity/location/body silhouette matters;
- `half_body` when wider framing is impractical;
- `close_up` only for explicit face/detail/emotion emphasis;
- bust/chest visibility requests do not imply face-only or chest-only cropping.

### Prompt budgets
`server/image/imagePromptBudget.js` owns final serialized limits. Validation happens immediately before Fal serialization and logs only lengths/policy/provider/reference count, never private prompts or signed URLs.

Important live limits:
- Kling documented maximum: 2500 chars;
- after a real production Fal 422 on a nominally in-range 2485-char/2493-byte payload, PR #44 introduced a conservative **2300 char / 2300 UTF-8 byte application envelope** for Kling;
- OpenAI GPT Image 2 policy: 32000;
- Grok Imagine 2: 8000;
- Qwen Image Max: 800;
- Nano Banana 2: 50000.

Compaction preserves identity/reference guards and prioritizes meaningful scene/appearance/body sections rather than blindly slicing the tail. No moderation bypass, provider switching or automatic fallback was introduced by the Kling headroom fix.

PR #44 merged as `2505d2e27588ee7c59422ed7e632ae8125e015fe`; Render/Vercel were verified green.

## 10. Activity / scheduled actions

Production activity state tracks ordered:
- `current_activity`;
- `next_steps`;
- `commitments`;
- `pending_promises`.

Questions/suggestions are not commitments. Iris must not invent unseen off-screen events merely to sound active; if she changes plan, express the change rather than silently contradicting prior state.

`iris_scheduled_actions` supports delayed actions, including future photo delivery. Scheduled image generation snapshots relevant state and uses the normal image pipeline. Future scheduled images must not prematurely mutate CURRENT_VISUAL_STATE.

## 11. Push / notification recovery

- web/PWA subscriptions with granted permission are recreated/re-registered on authenticated boot, `pageshow` and foreground return;
- existing web subscriptions are heartbeated to the backend rather than trusting stale local UI state;
- native Expo registration refreshes when the app becomes active;
- `DeviceNotRegistered` Expo tokens are retired;
- proactive push has its own lease/retry state independent from message persistence.

## 12. UI / PWA

Current UI includes:
- dark/light theme and per-device theme persistence;
- iOS/PWA keyboard/viewport handling;
- PWA standalone behavior;
- push/background reply reconciliation;
- custom Iris header avatar separate from image-generation references;
- three-slot face-reference UI;
- up to four image attachments per turn with previews/full-screen view and explicit temporary/permanent appearance retention;
- server-authoritative OpenAI/Grok/Kling selector.

Avatar rule: the small header avatar never changes the image-generation face identity pack.

People UI limitation: speaker metadata is stored, but shared chat currently still uses visible text prefixes instead of dedicated multi-agent bubble/avatar presentation.

## 13. Authentication / entitlements / beta

Primary auth:
- email + password login/registration;
- existing account migration preserves the Supabase user ID and therefore memory continuity;
- magic link is legacy fallback until clean password recovery intentionally replaces it.

Usage foundation: `user_entitlements` supports tier, status, daily chat/image limits and expiry.

Target first beta trial (decision, not yet complete product behavior):
- rolling 24 hours from first activation/use;
- approximately 30 user chat turns;
- maximum 5 generated photos;
- questionnaire then lock;
- explicit extension or paid entitlement required afterward.

Cost target: roughly €1 real variable cost per active trial user/day. Before public testing add real provider/token/image telemetry and cohort/global emergency spend controls.

## 14. Privacy / security priorities

Before broader beta/monetization:
- clear 18+ age gate;
- clear privacy disclosure/consent before sensitive memory use;
- memory on/off;
- future private-session mode;
- "What Iris remembers about me" UI;
- delete individual memories;
- export user data;
- delete account + Iris data subject to legal retention requirements;
- documented retention policy;
- least-data-necessary prompting;
- secure private media;
- RLS/security review;
- provider/subprocessor register;
- DPIA-style review for sensitive AI data processing.

Fal/provider retention hardening remains pending where supported. Do not claim store-no-I/O or short provider lifecycle controls until actually verified.

## 15. Engineering/release rules

Mandatory:
- inspect current GitHub/production before claiming runtime state;
- for meaningful production work use branch → PR → green CI → merge → Render/Vercel deployment → production verification;
- in this project the user saying **push** means that full sequence, not merely a git push;
- apply additive DB migrations before deploying code that depends on them;
- never expose secrets;
- preserve Supabase user ID/memory continuity;
- do not regress language mirroring, heat routing, nickname directionality, visual continuity or People identity separation;
- do not silently change image providers;
- do not infer successful production behavior from mock tests alone;
- never mix Iris and Project Antagonist state.

CI includes typecheck, lint, server syntax, image-context/prompt-budget tests, live assistance, heat routing, visual state, physical identity, memory quality, cognition/proactive delivery, People agents, notifications, companion continuity, multimodal chat and web build.

## 16. Important recent production merges

- PR #40 — cognition drive/state repair, duplicate/stale cognition cleanup and legacy capability quarantine.
- PR #41 — generic experimental People agents with Myno.
- PR #42 / merge `626aed4db9b119179ccfc8983f1925ad7499c8c7` — Myno image targeting and one-hop child-agent relay.
- PR #43 / merge `0c326a11d7634746d849423aa8cf1d6e4f4e0657` — structured merge-safe Iris physical identity + explicit Fal-only OpenAI GPT Image 2 text/edit modes.
- PR #44 / merge `2505d2e27588ee7c59422ed7e632ae8125e015fe` — safe Kling prompt headroom after production 422.
- PR #45 / merge `4e668a9eafd7e0fb7a0893e0fb55772a42e9d155` — restore cognition DB guard and remove the numeric second veto from grounded proactive outreach.

## 17. Immediate engineering order

1. Observe the next naturally due proactive run after PR #45 and verify it can no longer end in `weak_urge` after `should_reach_out=true`; legitimate hard-guard or `no_grounded_candidate` skips remain valid.
2. Continue monitoring cognition logs to confirm no recurrence of the removed `jsonb_object_length` failure.
3. Production-test current OpenAI/Grok/Kling selector on ordinary and identity-sensitive scenes; compare identity, skin and scene adherence while confirming Fal routing.
4. Validate body/outfit/framing consistency across normal and scheduled image paths.
5. Build rolling 24-hour beta entitlement lifecycle (~30 chats / 5 photos), questionnaire and post-trial lock.
6. Add provider-cost telemetry and budget kill switches.
7. Add 18+ gate and privacy/memory/export/delete controls.
8. Harden provider/media retention and complete Terms/Privacy/DPIA/payment-provider due diligence.
9. Start small Closed Beta and determine paid pricing from observed cost/retention data.

## 18. One-sentence current state

Iris is a near-Closed-Beta PWA-first persistent AI companion using Terra/Luna/Grok, Supabase-backed memory plus persistent cognition/self-model/personality evolution, generic separate People agents, structured user-defined physical identity, visual/activity/scheduled-action continuity, self-healing push registration, and a private three-view facial identity pack; production image routing is a server-persisted OpenAI/Grok/Kling selector through Fal with the current account on Kling O3, while the 2026-09-15 cognition/proactivity repair restored background reflection and removed the redundant numeric veto that had silenced semantically approved proactive outreach.
