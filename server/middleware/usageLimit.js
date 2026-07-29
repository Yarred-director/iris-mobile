const DEFAULT_CHAT_DAILY_LIMIT = 500;
const DEFAULT_IMAGE_DAILY_LIMIT = 25;

function parseLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 100000));
}

export function getDefaultDailyLimit(kind) {
  if (kind === 'image') return parseLimit(process.env.IRIS_DAILY_IMAGE_LIMIT, DEFAULT_IMAGE_DAILY_LIMIT);
  return parseLimit(process.env.IRIS_DAILY_CHAT_LIMIT, DEFAULT_CHAT_DAILY_LIMIT);
}

export async function getEffectiveDailyLimit(supabase, userId, kind) {
  const fallback = getDefaultDailyLimit(kind);
  const { data, error } = await supabase
    .from('user_entitlements')
    .select('tier, status, chat_daily_limit, image_daily_limit, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.log('[ENTITLEMENTS] load error:', error.message);
    return { tier: 'free', limit: fallback };
  }
  const expired = data?.expires_at && new Date(data.expires_at).getTime() <= Date.now();
  const active = data?.status === 'active' && !expired;
  if (!active) return { tier: 'free', limit: fallback };
  const custom = kind === 'image' ? data.image_daily_limit : data.chat_daily_limit;
  return { tier: data.tier || 'free', limit: parseLimit(custom, fallback) };
}

export async function consumeDailyUsage(supabase, userId, kind) {
  const entitlement = await getEffectiveDailyLimit(supabase, userId, kind);
  const { data, error } = await supabase.rpc('consume_daily_usage', {
    p_user_id: userId,
    p_kind: kind,
    p_limit: entitlement.limit,
  });
  if (error) {
    console.log('[USAGE_LIMIT] RPC error:', error.message);
    throw new Error('usage_limit_unavailable');
  }
  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(result?.allowed),
    used: Number(result?.used || 0),
    limit: Number(result?.limit_value || entitlement.limit),
    tier: entitlement.tier,
    resetsAt: result?.resets_at || null,
  };
}
