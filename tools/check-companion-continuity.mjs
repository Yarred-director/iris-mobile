import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatActivityStateBlock, sanitizeActivityState } from '../server/memory/activityContinuity.js';
import { formatPhysicalIdentityBlock } from '../server/memory/physicalIdentity.js';
import { formatScheduledActionDirective } from '../server/actions/scheduledActions.js';

const physical = formatPhysicalIdentityBlock({
  body_description: 'adult woman with a full augmented C-cup bust, slim waist and long legs',
});
assert.match(physical, /always an adult/i, 'Physical identity must enforce adult-only Iris.');
assert.match(physical, /full augmented C-cup bust/i, 'User-defined body identity must be preserved.');
assert.match(physical, /do not invent fixed body traits/i, 'Unknown body traits must not be invented.');

const activity = sanitizeActivityState({
  current_activity: 'morning chat',
  next_steps: ['take a shower', 'make coffee'],
  commitments: ['shower before coffee'],
  pending_promises: ['send a shower photo later'],
});
const activityBlock = formatActivityStateBlock(activity);
assert.match(activityBlock, /take a shower -> make coffee/i, 'Ordered plan must be preserved.');
assert.match(activityBlock, /question or suggestion.*not automatically a new commitment/i, 'Plan questions must not silently become commitments.');
assert.match(activityBlock, /do not invent a new destination or activity/i, 'Plan continuity must block invented destinations.');

const scheduledDirective = formatScheduledActionDirective({
  id: 'test',
  action_type: 'image',
  delay_minutes: 20,
});
assert.match(scheduledDirective, /real image delivery has been queued/i, 'Scheduled image must correspond to a real backend action.');
assert.match(scheduledDirective, /about 20 minutes/i, 'Scheduled delay should be communicated approximately.');
assert.match(scheduledDirective, /do not claim it has already been sent/i, 'Scheduled promises must not be presented as completed.');

const intentSource = fs.readFileSync(new URL('../server/behavior/intentJudge.js', import.meta.url), 'utf8');
assert.match(intentSource, /CURRENT_PHYSICAL_IDENTITY/, 'Intent judge must receive persistent physical identity.');
assert.match(intentSource, /CURRENT_ACTIVITY_STATE/, 'Intent judge must receive persistent activity state.');
assert.match(intentSource, /image_delivery_mode/, 'Intent judge must classify immediate vs scheduled photos.');
assert.match(intentSource, /first shower, then coffee/i, 'Scheduled-photo classifier should cover future shower/photo continuity.');

const physicalIdentitySource = fs.readFileSync(new URL('../server/memory/physicalIdentity.js', import.meta.url), 'utf8');
assert.match(physicalIdentitySource, /bootstrapPhysicalIdentityFromUserHistory/, 'Empty body identity must bootstrap from prior explicit user evidence.');
assert.match(physicalIdentitySource, /\.eq\('role', 'user'\)/, 'Physical identity bootstrap must read user messages only.');
assert.match(physicalIdentitySource, /Do NOT include clothes, colors, nails, hair, makeup, pose, scene/i, 'Body identity bootstrap must exclude temporary styling.');
assert.match(physicalIdentitySource, /bootstrap_user_history/, 'Bootstrapped identity must be auditable by source.');

const chatSource = fs.readFileSync(new URL('../server/routes/chat.js', import.meta.url), 'utf8');
assert.match(chatSource, /scheduleImageAction/, 'Chat route must create delayed image actions.');
assert.match(chatSource, /bootstrapPhysicalIdentityFromUserHistory/, 'Chat route must initialize missing user-defined body identity.');
assert.match(chatSource, /persistPhysicalIdentitySignal/, 'Chat route must persist explicit user-defined body identity.');
assert.match(chatSource, /persistActivityStateSignal/, 'Chat route must persist resolved plan continuity.');
assert.match(chatSource, /imageDeliveryMode === 'scheduled'/, 'Chat route must avoid immediate generation for scheduled photos.');

const imageHandlerSource = fs.readFileSync(new URL('../server/image/imageHandler.js', import.meta.url), 'utf8');
assert.match(imageHandlerSource, /imageProvider\.js/, 'Production image handler must use the canonical provider configuration.');
assert.match(imageHandlerSource, /physicalIdentitySource/, 'Image logs should expose whether persistent body identity was loaded.');

const imageProviderSource = fs.readFileSync(new URL('../server/image/imageProvider.js', import.meta.url), 'utf8');
assert.match(imageProviderSource, /: 'kling_o3'/, 'Production Iris photos must default to Kling O3 through Fal.');
assert.match(imageProviderSource, /resolveFalImageProvider/, 'Legacy provider values must be normalized through the Fal-only resolver.');
assert.match(imageProviderSource, /candidate === 'kling'/, 'Legacy Kling scheduled actions must resolve to canonical Kling O3.');
assert.match(imageProviderSource, /openai_gpt_image_2.*grok_imagine_2.*kling_o3/, 'The app switch must expose exactly OpenAI, Grok and Kling canonical providers.');
assert.match(imageProviderSource, /select\('image_provider'\)/, 'The selected image engine must be loaded from the user profile.');

const imageGenSource = fs.readFileSync(new URL('../server/image/imageGen.js', import.meta.url), 'utf8');
assert.match(imageGenSource, /fal\.run\/xai\/grok-imagine-image\/v2\.0\/edit/, 'Grok Imagine Image 2.0 must use the current Fal edit endpoint.');
assert.match(imageGenSource, /fal\.run\/openai\/gpt-image-2\/edit/, 'OpenAI GPT Image 2 must be called through Fal.');
assert.match(imageGenSource, /fal\.run\/fal-ai\/kling-image\/o3\/image-to-image/, 'Kling O3 must use the current Fal image-to-image endpoint.');
assert.match(imageGenSource, /image_urls: imageUrls/, 'All available face-pack references must be attached to the Fal request.');
assert.match(imageGenSource, /resolution: '2k'/, 'Grok production images must use the high-resolution tier.');
assert.match(imageGenSource, /quality: 'medium'/, 'Grok production images must use its highest current quality tier.');
assert.match(imageGenSource, /Images 1-\$\{count\} are different facial views of the SAME/, 'Grok prompts must bind all identity views to one Iris.');
assert.match(imageGenSource, /No plastic skin, excessive smoothing, glamour retouching/, 'Grok prompts must reject generic AI-glamour rendering.');
assert.match(imageGenSource, /enable_safety_checker: false/, 'Iris must not explicitly enable Qwen provider moderation.');
assert.doesNotMatch(imageGenSource, /api\.openai\.com\/v1\/images/, 'Direct OpenAI image transport must not remain in the production runtime.');

const imageRoutesSource = fs.readFileSync(new URL('../server/routes/imageRoutes.js', import.meta.url), 'utf8');
assert.match(imageRoutesSource, /router\.get\('\/iris\/image-provider'/, 'The app must be able to load the persisted image engine.');
assert.match(imageRoutesSource, /router\.put\('\/iris\/image-provider'/, 'The app must be able to update the persisted image engine.');

const appSource = fs.readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
assert.match(appSource, /Generátor fotiek/, 'The image engine selector must be visible in the Iris menu.');
assert.match(appSource, /label: 'OpenAI'.*label: 'Grok'.*label: 'Kling'/s, 'The selector must present OpenAI, Grok and Kling.');

const migrationSource = fs.readFileSync(new URL('../supabase/migrations/20260826113024_image_provider_preference.sql', import.meta.url), 'utf8');
assert.match(migrationSource, /image_provider text not null default 'kling_o3'/, 'User profiles must persist Kling O3 as the default engine.');
assert.match(migrationSource, /check \(image_provider in \('openai_gpt_image_2', 'grok_imagine_2', 'kling_o3'\)\)/, 'The database must reject unsupported user engine values.');

const workerSource = fs.readFileSync(new URL('../server/actions/scheduledActionWorker.js', import.meta.url), 'utf8');
assert.match(workerSource, /handleImageRequest/, 'Scheduled worker must use the normal image pipeline.');
assert.match(workerSource, /saveChatMessage/, 'Scheduled image must land in real Iris chat history.');
assert.match(workerSource, /startScheduledActionLoop/, 'Scheduled worker must run with the backend.');

console.log('Companion continuity checks passed.');
