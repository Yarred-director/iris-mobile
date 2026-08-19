# IRIS — ONE TRUE MASTER CONTEXT
## Canonical cross-chat handoff

**Project:** Iris  
**Repo:** `Yarred-director/iris-mobile`  
**Branch:** `main`  
**Canonical file:** `IRIS_ONE_TRUE_MASTER_CONTEXT_CURRENT.md`  
**Consolidated:** 2026-08-19, Europe/Bratislava  
**Product phase:** Private / Early Alpha, approaching Closed Beta

> HARD BOUNDARY: this file is ONLY for Project Iris. Project Antagonist is a separate UE5.8 multiplayer game. Never merge Iris app/auth/memory/LLM/image facts with Antagonist Blueprint/combat/AI/game-project facts. In mixed chats keep explicit namespaces `PROJECT_IRIS` and `PROJECT_ANTAGONIST`.

## 1. Product direction

Iris is a persistent AI companion application, not a stateless chatbot.

Core goals:
- continuous user/account identity;
- long-term + recent memory;
- temporal awareness;
- relationship/internal state;
- shared roleplay-world continuity;
- real-world assistance while staying in character;
- persistent visual identity and generated photos;
- multilingual behavior mirroring the user's language;
- PWA-first distribution across iPhone, Android and desktop;
- cost-aware routing across OpenAI, xAI and image providers;
- controlled romantic/intimate escalation;
- privacy-by-design because Iris may store highly intimate user data.

Current distribution strategy:
- do NOT make App Store or Google Play a blocker for beta or early monetization;
- primary product is the installable web/PWA experience;
- native Expo support remains available, but store release is optional/later;
- one PWA code path should serve iPhone, Android and desktop as long as UX remains strong.

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
- OpenAI utility/classifier/memory/image-prompt helper: `gpt-5.6-luna`
- xAI intimate route: `grok-4.5-latest`
- Embeddings: `text-embedding-3-small`

Routing:
- heat 0 → Terra
- heat 1 → Terra
- heat 2 → Grok 4.5
- heat 3 → Grok 4.5
- current factual/live web assistance → OpenAI/Terra
- Luna handles cheaper semantic classification/governance/background helper work

Product decision: main conversational model is working well; do not casually swap Terra before beta. Gather real tester baseline first, then optimize cost/quality.

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
Current behavior version: `MASTER_1.10_VISUAL_CONTINUITY`

Render load order:
1. `/etc/secrets/master_iris_core.yaml`
2. env YAML
3. internal fallback

Render Secret File must match canonical repo behavior when behavior changes are intended for production.

Major behavior guarantees:
- adaptive heat 0–3;
- no fixed multi-turn Grok lock;
- heat 2 must not automatically jump to heat 3;
- rough/vulgar style is separate from explicitness;
- post-climax cooldown;
- Iris-only nickname directionality;
- mirror-user language;
- persistent visual continuity;
- no hardcoded outfit-by-location/time/color/fabric mappings.

## 6. Memory architecture

### Recent chat
Immediate conversation continuity and short follow-ups.

### User profile
Durable user facts and preferences.

### Episodic memory
Table: `episodic_memory`  
Semantic retrieval RPC: `match_episodic_memory_v2`

### Shared experiences
Table: `shared_experiences`

### Scene context
Tracks current place/room/time/subject/interaction state and recent engine information.

### Relationship / internal state / self-awareness / personality evolution
Loaded and updated selectively, not blindly every turn.

### Visual state
Dedicated persistent visual continuity layer.

Current authoritative tracked fields include:
- outfit
- footwear
- nails
- hair
- makeup
- accessories
- other visible details

Priority:
1. explicit current user instruction;
2. current visual state;
3. strongly justified context/activity transition;
4. learned visual preferences as soft bias;
5. fallback inference only if state is unknown.

A photo request alone never changes a known outfit.

## 7. Visual preference learning

Long-term visual preferences are separate from current appearance state.

Examples:
- preferred nail polish on Iris;
- preferred colors/materials on Iris;
- preferred sleepwear/style;
- hair/makeup/accessory preferences.

Important interpretation rule:
- a narrow preference must not be expanded into a broad unsupported preference;
- e.g. liking black nail polish does not automatically mean the user wants every Iris outfit black.

Verified user preference from current account work:
- user likes black nail polish on Iris.

## 8. Image generation stack

Primary provider:
- Qwen Image 2 Edit via fal: `fal-ai/qwen-image-2/edit`

Fallback:
- Kling O3 image-to-image

Optional quality path:
- Nano Banana 2 / Gemini image edit

Legacy optional path:
- OpenAI image generation

Generated provider outputs are copied into Iris private storage instead of being trusted as permanent provider URLs.

## 9. Three-view face reference pack

Current identity upgrade supports up to 3 face references in deterministic order:
1. front;
2. 3/4;
3. side profile.

Menu must expose/manage this as a three-slot face reference pack.

Storage remains private under the per-user Iris reference area.

Provider behavior:
- Qwen receives up to 3 identity references;
- Nano Banana receives up to 3;
- Kling fallback receives up to 3;
- legacy single reference remains a backward-compatible fallback until the pack is populated.

The three images are identity views of the SAME Iris, not three different people/looks.

## 10. Body proportion guardrails

A recurring image artifact was an occasionally oversized head.

Current generation prompts must preserve:
- natural adult female head-to-body ratio;
- realistic shoulder width;
- realistic torso length;
- Iris's long-legged model-like silhouette;
- natural photographic anatomy.

Avoid:
- oversized head;
- bobblehead/chibi/doll-like proportions;
- shortened torso or compressed legs caused by identity over-weighting.

These are generic anatomy/composition constraints, NOT hardcoded outfits or poses.

## 11. Visual identity

Textual identity remains secondary to visual reference:
- pale skin;
- dirty-blonde hair;
- green eyes;
- strong freckles on face/chest;
- large augmented breasts;
- slim waist;
- long legs;
- model-like figure;
- age 22.

Cyber/cyberskin was removed and must not reappear.

Reference-first principle:
- uploaded face references are the primary identity anchor;
- textual descriptors should not overpower a valid reference pack.

## 12. UI / PWA state

Current UI includes:
- Dark theme;
- Light theme;
- white/grey light palette with glass/translucent treatment;
- theme persistence per device;
- iOS/PWA keyboard/viewport handling;
- PWA standalone behavior;
- push notifications/background reply reconciliation;
- custom Iris header avatar separate from image-generation reference identity.

Avatar rule:
- UI avatar is only the small profile image in the app header;
- changing it must never change image-generation face references.

## 13. Authentication

Current primary auth:
- email + password login;
- email + password registration;
- existing account migration preserved same Supabase user ID and therefore existing memories/history.

Magic link remains only as legacy fallback until deliberately removed/replaced by clean password recovery.

## 14. Usage limiting foundation

Current backend has `user_entitlements` and usage accounting.

Supported entitlement fields include:
- tier;
- status;
- chat daily limit;
- image daily limit;
- expiry timestamp.

Current generic defaults are intentionally too generous for public free testing and must not be treated as the future trial plan.

## 15. Closed-beta trial product decision

Target first public/closed-beta experience:
- one free trial period per new user;
- duration: rolling 24 hours from trial activation, not “until midnight”;
- after trial: questionnaire → lock;
- later unlock only through explicit tester extension or paid entitlement.

Initial trial budget target:
- total real cost ceiling approximately €1 per active trial user/day;
- 10 active trial users should therefore stay at or below approximately €10/day total variable spend.

Initial guardrail proposal:
- about 30 user chat turns during trial;
- maximum 5 generated photos during trial;
- limit expensive live-web/tool use if necessary;
- global/cohort emergency spend kill switch before public testing.

Do not rely only on request counts long-term. Add actual provider/token/image cost telemetry per user so the €1/day target can be enforced from observed production usage.

## 16. Beta readiness

Current rough internal estimate:
- closed beta readiness: ~80%;
- first responsible monetization readiness: ~60–70%.

These percentages are planning estimates, not formal metrics.

Before Closed Beta, prioritize:
1. 24h trial gate + questionnaire + lock;
2. 18+ age gate;
3. privacy/data controls;
4. provider/privacy hardening for image generation;
5. real per-user cost telemetry + kill switch;
6. acceptance testing of memory/image/auth/visual continuity;
7. clear Terms + Privacy Policy + data deletion path.

## 17. Monetization strategy

Current direction:
- PWA/web-first monetization;
- do not block on App Store or Google Play;
- credits can be a valid product/billing mechanism;
- credits must NOT be used to disguise the actual service from a payment processor.

Important payment rule:
- payment provider onboarding must truthfully describe Iris and the real services credits/subscriptions unlock;
- do not attempt to bypass processor adult-content rules by labeling the transaction only as “credits”.

Potential product billing model:
- Iris Credits for variable-cost features such as generated photos and premium usage;
- subscription may include a monthly credit allocation;
- exact tiers/pricing should follow real beta retention and cost data, not guesses.

Payment-provider constraint:
- mainstream processors may reject or restrict adult/explicit AI companion use cases;
- evaluate a processor that explicitly accepts the actual Iris 18+ use case;
- obtain approval before building the production billing dependency around one provider.

## 18. User privacy / data-protection product requirements

This is a core product requirement, not a later legal checkbox.

Iris may process very sensitive information, including intimate/sexual preferences and relationship-style memories. Therefore implement privacy by design.

Required beta privacy controls:
- clear 18+ age gate;
- clear privacy disclosure/consent before sensitive memory use;
- memory on/off control;
- future “private session” mode that does not create durable memories;
- “What Iris remembers about me” UI;
- delete individual memories;
- export user data;
- delete account and all Iris user data;
- documented retention policy for chat, memories and generated media;
- least-data-necessary prompting to external providers;
- secure private media storage;
- RLS/security review before broader beta.

Data classes should be separated conceptually:
1. account/auth data;
2. chat transcript/history;
3. durable long-term memory/profile;
4. relationship/internal state;
5. generated media/reference media;
6. billing/entitlements;
7. analytics/cost telemetry.

Do not retain raw intimate conversations indefinitely merely because storage is available. Long-term memory should keep useful distilled facts where possible instead of copying every transcript forever.

## 19. External-provider privacy direction

OpenAI/xAI/fal should receive only the context necessary for the current operation.

For image generation:
- treat provider-hosted input/output URLs as temporary processing artifacts;
- copy final generated media to Iris private Supabase storage;
- minimize provider retention where API/provider options allow it;
- enable/store-no-input-output or shortest practical media expiration options where supported;
- document provider subprocessors/retention in Privacy Policy/DPIA work.

Before broad scale, complete a formal DPIA-style review because the product combines new AI technology with potentially highly sensitive user data.

## 20. Legal/business setup direction

Do not wait for large revenue before considering proper business/legal setup.

Before meaningful paid launch:
- confirm appropriate Slovak business form / trade activity with an accountant or lawyer;
- understand EU consumer/VAT/OSS treatment for digital services;
- have Terms, Privacy Policy, refund/credit rules and billing disclosures;
- use a payment processor that explicitly approves the real product category.

## 21. Founder financial goals

Current founder goal/reference:
- if Iris can average roughly €2,000/month net for ~6 consecutive months, that would already be a major success milestone;
- roughly €4,000/month net would be a more meaningful threshold for considering full business/company focus.

These are founder planning goals, not user-facing promises and not product defaults.

Early optimization priority is NOT maximum profit. Measure:
- trial → paid conversion;
- day-1/day-7/day-30 retention;
- average active-user cost;
- image usage;
- heat 2/3 usage share;
- support/refund burden;
- willingness to pay;
- which feature creates the strongest “wow” moment.

## 22. CI / engineering rules

Important regression checks:
- typecheck;
- lint;
- server syntax;
- image context continuity;
- live assistance;
- heat routing;
- visual state;
- web build.

Future rules:
- inspect current GitHub before claiming code state;
- run CI before merge;
- verify Render/Vercel after merge;
- never expose secrets;
- preserve Supabase user ID/memory continuity;
- do not regress language mirroring;
- do not regress heat 2 into heat 3;
- do not regress nickname directionality;
- do not send image model only a short final request when prior context defines the scene;
- do not randomize outfit between image requests;
- do not hardcode wardrobe by scene/location/time;
- never mix Iris with Project Antagonist.

## 23. Important current functional landmarks

Recent major merges include:
- visual continuity / `MASTER_1.10_VISUAL_CONTINUITY`;
- Dark/Light theme and iOS/PWA visual pass;
- persistent custom header avatar;
- three-view face reference pack + body proportion guardrails;
- adaptive Terra/Luna/Grok routing and persistent memory architecture.

Most recent image-reference/body-proportion merge before this consolidation:
`b17019e98facc5e4f237d66ccffaaceacda8f84a`

## 24. Recommended immediate engineering order

1. Validate the 3-view face reference pack in production.
2. Build the 24-hour trial entitlement lifecycle.
3. Add questionnaire + post-trial lock screen.
4. Add per-user provider cost telemetry and cohort/global budget kill switch.
5. Add 18+ gate.
6. Add privacy/memory controls + export/delete account/data.
7. Harden fal/media retention behavior.
8. Prepare Terms/Privacy/DPIA documentation.
9. Contact/payment-provider due diligence for the actual 18+ AI companion use case.
10. Start Closed Beta with a small cohort, then decide paid-beta pricing from observed data.

## 25. One-sentence current state

Iris is an Early Alpha / near-Closed-Beta PWA-first persistent AI companion using GPT-5.6 Terra for normal/soft chat, GPT-5.6 Luna for utility work, Grok 4.5 for semantic heat 2/3, Supabase-backed memory/visual state, Qwen-first generated imagery with a three-view face reference pack and body-proportion guardrails, with the next product milestone being a budget-capped 24-hour trial plus privacy/18+/feedback infrastructure before first monetization.
