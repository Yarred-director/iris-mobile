// server/memory/timeContext.js
// Temporal awareness with persistent, atomic chat-session boundaries.

const DEFAULT_SESSION_TIMEOUT_SECONDS = 30 * 60;

export function detectTimeOfDay(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function clampSessionTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_TIMEOUT_SECONDS;
  return Math.max(300, Math.min(86400, Math.round(parsed)));
}

function plural(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function formatDurationSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total < 60) return 'less than a minute';

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return plural(minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes
      ? `${plural(hours, 'hour')}, ${plural(remainingMinutes, 'minute')}`
      : plural(hours, 'hour');
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days < 7) {
    return remainingHours
      ? `${plural(days, 'day')}, ${plural(remainingHours, 'hour')}`
      : plural(days, 'day');
  }

  if (days < 30) {
    const weeks = Math.floor(days / 7);
    const remainingDays = days % 7;
    return remainingDays
      ? `${plural(weeks, 'week')}, ${plural(remainingDays, 'day')}`
      : plural(weeks, 'week');
  }

  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  return remainingDays
    ? `${plural(months, 'month')}, ${plural(remainingDays, 'day')}`
    : plural(months, 'month');
}

function relationshipAge(startedAt) {
  if (!startedAt) return null;
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  return formatDurationSeconds(diffSeconds);
}

function localDateTime(date, timezone) {
  if (!date) return null;
  try {
    return new Date(date).toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date(date).toISOString();
  }
}

export function buildTemporalContextBlock({
  userTimezone = 'UTC',
  lastInteractionAt = null,
  relationshipStartedAt = null,
  lastPhotoSentAt = null,
  currentSessionStartedAt = null,
  previousSessionEndedAt = null,
  sessionGapSeconds = null,
} = {}) {
  const now = new Date();
  let localTimeStr;
  let localDayStr;
  let localHour;

  try {
    localTimeStr = now.toLocaleTimeString('en-US', {
      timeZone: userTimezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    localDayStr = now.toLocaleDateString('en-US', {
      timeZone: userTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    localHour = Number.parseInt(
      now.toLocaleString('en-US', { timeZone: userTimezone, hour: 'numeric', hour12: false }),
      10,
    );
  } catch {
    localTimeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    localDayStr = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    localHour = now.getHours();
  }

  const gapIsKnown = Number.isFinite(Number(sessionGapSeconds));
  const gapSeconds = gapIsKnown ? Math.max(0, Math.floor(Number(sessionGapSeconds))) : null;
  const relationshipLen = relationshipAge(relationshipStartedAt);
  const sessionStartedLocal = localDateTime(currentSessionStartedAt, userTimezone);
  const previousSessionEndedLocal = localDateTime(previousSessionEndedAt, userTimezone);
  const sessionAgeSeconds = currentSessionStartedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(currentSessionStartedAt).getTime()) / 1000))
    : null;
  const sinceLastPhotoSeconds = lastPhotoSentAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lastPhotoSentAt).getTime()) / 1000))
    : null;

  const lines = [
    'TEMPORAL_CONTEXT:',
    `- current_time: ${localTimeStr}`,
    `- current_day: ${localDayStr}`,
    `- time_of_day: ${detectTimeOfDay(localHour)}`,
    `- user_timezone: ${userTimezone}`,
    sessionStartedLocal ? `- current_session_started_at: ${sessionStartedLocal}` : null,
    sessionAgeSeconds !== null ? `- current_session_age: ${formatDurationSeconds(sessionAgeSeconds)}` : null,
    previousSessionEndedLocal ? `- previous_session_ended_at: ${previousSessionEndedLocal}` : null,
    gapSeconds !== null ? `- previous_session_gap_seconds: ${gapSeconds}` : null,
    gapSeconds !== null ? `- previous_session_gap: ${formatDurationSeconds(gapSeconds)}` : null,
    relationshipLen ? `- known_each_other: ${relationshipLen}` : null,
    sinceLastPhotoSeconds !== null ? `- last_photo_sent: ${formatDurationSeconds(sinceLastPhotoSeconds)} ago` : null,
    lastInteractionAt ? '- current_message_activity: active now' : null,
    '',
    'TEMPORAL_RULES:',
    '- previous_session_gap is frozen when the current session begins.',
    '- If asked how long you had not spoken before this conversation, answer from previous_session_gap_seconds.',
    '- Never replace that answer with "just now" merely because messages are currently being exchanged.',
    '- If previous_session_gap_seconds is absent, say that no reliable previous-session gap is available.',
    '- Adapt tone naturally to time of day and the length of the absence.',
  ].filter(value => value !== null).join('\n');

  return lines;
}

export async function loadTemporalProfile(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_profiles')
      .select([
        'last_interaction_at',
        'relationship_started_at',
        'last_photo_sent_at',
        'user_timezone',
        'current_session_started_at',
        'previous_session_ended_at',
        'session_gap_seconds',
      ].join(', '))
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.log('[TEMPORAL] load error:', error.message);
      return {};
    }
    return data || {};
  } catch (e) {
    console.log('[TEMPORAL] load error:', e?.message);
    return {};
  }
}

export async function beginOrTouchTemporalSession(
  supabase,
  userId,
  { userTimezone = null, sessionTimeoutSeconds = DEFAULT_SESSION_TIMEOUT_SECONDS } = {},
) {
  const timeout = clampSessionTimeout(sessionTimeoutSeconds);
  const now = new Date().toISOString();

  try {
    const { data, error } = await supabase.rpc('begin_or_touch_temporal_session', {
      p_user_id: userId,
      p_user_timezone: userTimezone,
      p_session_timeout_seconds: timeout,
    });

    if (error) {
      console.log('[TEMPORAL_SESSION] RPC error:', error.message);
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row) return row;
  } catch (e) {
    console.log('[TEMPORAL_SESSION] fallback:', e?.message);
  }

  const profile = await loadTemporalProfile(supabase, userId);
  await touchLastInteraction(supabase, userId);
  return {
    ...profile,
    user_timezone: userTimezone || profile?.user_timezone || 'UTC',
    last_interaction_at: now,
  };
}

export async function touchLastInteraction(supabase, userId) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('iris_profiles')
    .upsert(
      { user_id: userId, last_interaction_at: now, updated_at: now },
      { onConflict: 'user_id' },
    );

  if (error) {
    console.log('[TEMPORAL] touchLastInteraction error:', error.message);
    return false;
  }
  return true;
}

export async function touchLastPhotoSent(supabase, userId) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('iris_profiles')
    .upsert(
      { user_id: userId, last_photo_sent_at: now, updated_at: now },
      { onConflict: 'user_id' },
    );

  if (error) {
    console.log('[TEMPORAL] touchLastPhotoSent error:', error.message);
    return false;
  }
  return true;
}
