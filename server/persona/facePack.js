// A companion's face is created from how the user described her, so nobody has to upload a
// real person's photo. The front view is generated from text, the other views from the front.
import { createSignedMediaUrl } from '../media/privateMedia.js';
import { generateIrisImage } from '../image/imageGen.js';
import { enqueueJob, registerJobHandler } from '../jobs/jobQueue.js';
import { loadPersona } from './personaStore.js';

export const FACE_PACK_KIND = 'generate_face_pack';
const BUCKET = 'iris-photos';
const GENERATOR = 'openai_gpt_image_2';

const VIEWS = Object.freeze([
  { name: 'face-front', direction: 'facing the camera directly, front view' },
  { name: 'face-three-quarter', direction: 'head turned about 45 degrees, three-quarter view' },
  { name: 'face-side', direction: 'clean side profile view' },
]);

function appearanceText(persona, physicalIdentity) {
  return [persona?.identity?.appearance, physicalIdentity?.body_description]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('. ')
    .slice(0, 1200);
}

export async function facePackExists(admin, userId) {
  const { data, error } = await admin.storage.from(BUCKET).list(`iris-ref/${userId}`, { limit: 100 });
  if (error) return false;
  return (data || []).some((item) => item?.name === 'face-front');
}

export async function maybeScheduleFacePack(admin, { userId, persona, physicalIdentity }) {
  if (persona?.status !== 'alive' || !appearanceText(persona, physicalIdentity)) return null;
  if (await facePackExists(admin, userId)) return null;
  return enqueueJob(admin, { userId, kind: FACE_PACK_KIND, dedupeKey: `facepack:${userId}`, payload: {} });
}

async function storeView(admin, userId, generated, name) {
  const target = `iris-ref/${userId}/${name}`;
  await admin.storage.from(BUCKET).remove([target]);
  const { error } = await admin.storage.from(BUCKET).copy(generated.imagePath, target);
  if (error) throw new Error(error.message);
  await admin.storage.from(BUCKET).remove([generated.imagePath]);
  return target;
}

export async function runFacePackJob({ admin, job }) {
  const userId = job.user_id;
  if (await facePackExists(admin, userId)) return { skipped: 'exists' };
  const persona = await loadPersona(admin, userId);
  const { data: physicalIdentity } = await admin.from('iris_physical_identity').select('body_description').eq('user_id', userId).maybeSingle();
  const appearance = appearanceText(persona, physicalIdentity);
  if (!appearance) throw Object.assign(new Error('face_pack_no_appearance'), { terminal: true });

  const identity = `A photorealistic portrait of one clearly adult person (18+), an original fictional character who resembles no real or famous person. Appearance as described by their user: ${appearance}. Neutral soft studio light, plain background, head and shoulders, natural skin texture, no makeup filters.`;
  const front = await generateIrisImage({ prompt: `${identity} ${VIEWS[0].direction}.`, provider: GENERATOR, aspectRatio: '1:1', userId });
  const stored = [await storeView(admin, userId, front, VIEWS[0].name)];
  const frontUrl = await createSignedMediaUrl({ bucket: BUCKET, path: stored[0], expiresIn: 900 });
  for (const view of VIEWS.slice(1)) {
    const result = await generateIrisImage({
      prompt: `The reference shows this exact person. Keep the identical face, age and features; change only the camera angle: ${view.direction}. Same light and plain background, head and shoulders.`,
      imageUrls: [frontUrl],
      provider: GENERATOR,
      aspectRatio: '1:1',
      userId,
    });
    stored.push(await storeView(admin, userId, result, view.name));
  }
  console.log('[FACE_PACK_GENERATED]', { userId, views: stored.length });
  return { views: stored.length };
}

export function registerFacePackHandler() {
  registerJobHandler(FACE_PACK_KIND, runFacePackJob);
}
