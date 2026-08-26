const SUPPORTED_FAL_IMAGE_PROVIDERS = new Set(['grok_imagine_2', 'qwen_image_max', 'kling_o3', 'nano-banana-2']);

const configuredProvider = String(process.env.IRIS_IMAGE_PROVIDER || '').trim().toLowerCase();

// Production image traffic is Fal-only. An old Render value such as "openai"
// must not silently restore the direct OpenAI transport.
export const ACTIVE_IMAGE_PROVIDER = SUPPORTED_FAL_IMAGE_PROVIDERS.has(configuredProvider)
  ? configuredProvider
  : 'grok_imagine_2';

export function isFalImageProvider(provider) {
  return SUPPORTED_FAL_IMAGE_PROVIDERS.has(String(provider || '').trim().toLowerCase());
}

export function resolveFalImageProvider(provider) {
  const candidate = String(provider || '').trim().toLowerCase();
  if (candidate === 'kling') return 'kling_o3';
  if (candidate === 'qwen_max' || candidate === 'qwen-image-max') return 'qwen_image_max';
  if (candidate === 'grok' || candidate === 'grok_imagine' || candidate === 'grok-imagine-2') return 'grok_imagine_2';
  return isFalImageProvider(candidate) ? candidate : ACTIVE_IMAGE_PROVIDER;
}
