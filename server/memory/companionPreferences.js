function cleanNickname(value) {
  const nickname = String(value || '').trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, '');
  if (!nickname || nickname.length > 60) return null;
  return nickname;
}

function heatValue(level) {
  if (level === 1) return 'soft_romantic';
  if (level === 2) return 'sensual_gradual';
  if (level === 3) return 'explicit';
  return null;
}

async function upsertFact(supabase, userId, { category, factKey, factValue, confidence }) {
  if (!factKey || factValue == null) return false;
  const { error } = await supabase.from('user_profile').upsert({
    user_id: userId,
    category,
    fact_key: factKey,
    fact_value: String(factValue).slice(0, 500),
    confidence: Math.max(0.6, Math.min(1, Number(confidence || 0.8))),
    source: 'auto',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,fact_key' });
  if (error) {
    console.log('[COMPANION_PREF_UPSERT_ERROR]', factKey, error.message);
    return false;
  }
  return true;
}

export async function persistCompanionSignals({ supabase, userId, intent }) {
  if (!supabase || !userId || !intent) return;
  const jobs = [];

  const nickname = cleanNickname(intent.iris_nickname);
  if (nickname && Number(intent.nickname_confidence || 0) >= 0.75) {
    jobs.push(upsertFact(supabase, userId, {
      category: 'companion_preferences',
      factKey: 'iris_nickname',
      factValue: nickname,
      confidence: intent.nickname_confidence,
    }));
  }

  const preferredHeat = heatValue(Number(intent.preferred_heat_level));
  if (preferredHeat && Number(intent.preference_confidence || 0) >= 0.8) {
    jobs.push(upsertFact(supabase, userId, {
      category: 'preferences',
      factKey: 'preferred_intimacy_heat',
      factValue: preferredHeat,
      confidence: intent.preference_confidence,
    }));
  }

  if (['gentle', 'playful', 'sensual', 'rough'].includes(intent.preferred_style) && Number(intent.preference_confidence || 0) >= 0.8) {
    jobs.push(upsertFact(supabase, userId, {
      category: 'preferences',
      factKey: 'preferred_intimacy_style',
      factValue: intent.preferred_style,
      confidence: intent.preference_confidence,
    }));
  }

  if (jobs.length) await Promise.allSettled(jobs);
}
