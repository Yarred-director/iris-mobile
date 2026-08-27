const SUPPORTED_FAL_IMAGE_PROVIDERS = new Set(['openai_gpt_image_2', 'grok_imagine_2', 'qwen_image_max', 'kling_o3', 'nano-banana-2']);
const USER_SELECTABLE_IMAGE_PROVIDERS = new Set(['openai_gpt_image_2', 'grok_imagine_2', 'kling_o3']);

const configuredProvider = String(process.env.IRIS_IMAGE_PROVIDER || '').trim().toLowerCase();

// Production image traffic is Fal-only. An old Render value such as "openai"
// must not silently restore the direct OpenAI transport.
export const ACTIVE_IMAGE_PROVIDER = SUPPORTED_FAL_IMAGE_PROVIDERS.has(configuredProvider)
  ? configuredProvider
  : 'kling_o3';

export const IMAGE_PROVIDER_OPTIONS = Object.freeze([...USER_SELECTABLE_IMAGE_PROVIDERS]);

export function isFalImageProvider(provider) {
  return SUPPORTED_FAL_IMAGE_PROVIDERS.has(String(provider || '').trim().toLowerCase());
}

export function resolveFalImageProvider(provider) {
  const candidate = String(provider || '').trim().toLowerCase();
  if (candidate === 'kling') return 'kling_o3';
  if (candidate === 'qwen_max' || candidate === 'qwen-image-max') return 'qwen_image_max';
  if (candidate === 'grok' || candidate === 'grok_imagine' || candidate === 'grok-imagine-2') return 'grok_imagine_2';
  if (candidate === 'openai' || candidate === 'gpt-image-2') return 'openai_gpt_image_2';
  return isFalImageProvider(candidate) ? candidate : ACTIVE_IMAGE_PROVIDER;
}

export function resolveUserImageProvider(provider) {
  const resolved = resolveFalImageProvider(provider);
  return USER_SELECTABLE_IMAGE_PROVIDERS.has(resolved) ? resolved : ACTIVE_IMAGE_PROVIDER;
}

export async function loadUserImageProvider(supabase, userId) {
  if (!supabase || !userId) return ACTIVE_IMAGE_PROVIDER;
  const { data, error } = await supabase
    .from('iris_profiles')
    .select('image_provider')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.log('[IMAGE_PROVIDER_LOAD_ERROR]', error.message);
    return ACTIVE_IMAGE_PROVIDER;
  }
  return resolveUserImageProvider(data?.image_provider);
}

export async function saveUserImageProvider(supabase, userId, provider) {
  if (!supabase || !userId) throw new Error('image_provider_store_unavailable');
  const candidate = String(provider || '').trim().toLowerCase();
  if (!USER_SELECTABLE_IMAGE_PROVIDERS.has(candidate)) throw new Error('invalid_image_provider');
  const resolved = resolveUserImageProvider(candidate);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('iris_profiles')
    .upsert({
      user_id: userId,
      image_provider: resolved,
      updated_at: now,
    }, { onConflict: 'user_id' })
    .select('image_provider')
    .single();
  if (error) throw new Error(error.message);
  const persisted = resolveUserImageProvider(data?.image_provider);
  if (persisted !== resolved) throw new Error('image_provider_verify_failed');
  return persisted;
}
