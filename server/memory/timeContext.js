// server/memory/timeContext.js
// Temporal Awareness — Priority 1 of Iris Governance Engine
// Gives Iris real awareness of: current time, timezone, time since last message, relationship age

/**
 * Detects time of day from hour (0-23).
 */
export function detectTimeOfDay(hour) {
  if (hour >= 5  && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/**
 * Human-readable "time ago" string.
 */
function timeAgo(date) {
  if (!date) return null;
  const diffMs  = Date.now() - new Date(date).getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 2)   return 'just now';
  if (diffMin < 60)  return `${diffMin} minutes ago`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)    return `${diffH} hour${diffH > 1 ? 's' : ''} ago`;

  const diffD = Math.floor(diffH / 24);
  if (diffD === 1)   return 'yesterday';
  if (diffD < 7)     return `${diffD} days ago`;
  if (diffD < 30)    return `${Math.floor(diffD / 7)} week${Math.floor(diffD / 7) > 1 ? 's' : ''} ago`;

  const diffM = Math.floor(diffD / 30);
  return `${diffM} month${diffM > 1 ? 's' : ''} ago`;
}

/**
 * Human-readable relationship duration.
 */
function relationshipAge(startedAt) {
  if (!startedAt) return null;
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const diffD  = Math.floor(diffMs / 86400000);

  if (diffD < 1)  return 'today';
  if (diffD < 7)  return `${diffD} day${diffD > 1 ? 's' : ''}`;
  if (diffD < 30) return `${Math.floor(diffD / 7)} week${Math.floor(diffD / 7) > 1 ? 's' : ''}`;

  const diffM = Math.floor(diffD / 30);
  if (diffM < 12) return `${diffM} month${diffM > 1 ? 's' : ''}`;

  const diffY = Math.floor(diffM / 12);
  return `${diffY} year${diffY > 1 ? 's' : ''}`;
}

/**
 * Builds the full temporal context block for Iris's system prompt.
 *
 * @param {Object} opts
 * @param {string}  opts.userTimezone           - IANA timezone string e.g. 'Europe/Bratislava'
 * @param {string|null} opts.lastInteractionAt  - ISO timestamp of last user message
 * @param {string|null} opts.relationshipStartedAt - ISO timestamp when user first started chatting
 * @param {string|null} opts.lastPhotoSentAt    - ISO timestamp of last generated photo
 */
export function buildTemporalContextBlock({
  userTimezone = 'UTC',
  lastInteractionAt = null,
  relationshipStartedAt = null,
  lastPhotoSentAt = null,
} = {}) {
  // Current time in user's timezone
  const now = new Date();
  let localTimeStr, localDayStr, localHour;

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
      month: 'long',
      day: 'numeric',
    });
    localHour = parseInt(
      now.toLocaleString('en-US', { timeZone: userTimezone, hour: 'numeric', hour12: false }),
      10
    );
  } catch {
    // Fallback if timezone invalid
    localTimeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    localDayStr  = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    localHour    = now.getHours();
  }

  const timeOfDay       = detectTimeOfDay(localHour);
  const sinceLastMsg    = timeAgo(lastInteractionAt);
  const relationshipLen = relationshipAge(relationshipStartedAt);
  const sinceLastPhoto  = timeAgo(lastPhotoSentAt);

  // Classify absence duration for behavioral hints
  let absenceContext = '';
  if (lastInteractionAt) {
    const diffH = (Date.now() - new Date(lastInteractionAt).getTime()) / 3600000;
    if (diffH > 72)      absenceContext = 'User has been away for several days. Iris may feel their absence.';
    else if (diffH > 24) absenceContext = 'User was away for over a day. Iris noticed.';
    else if (diffH > 8)  absenceContext = 'User was away for several hours.';
  }

  const lines = [
    'TEMPORAL_CONTEXT:',
    `- current_time: ${localTimeStr}`,
    `- current_day: ${localDayStr}`,
    `- time_of_day: ${timeOfDay}`,
    `- user_timezone: ${userTimezone}`,
    sinceLastMsg    ? `- last_message: ${sinceLastMsg}` : null,
    relationshipLen ? `- known_each_other: ${relationshipLen}` : null,
    sinceLastPhoto  ? `- last_photo_sent: ${sinceLastPhoto}` : null,
    absenceContext  ? `- context: ${absenceContext}` : null,
  ].filter(Boolean).join('\n');

  return lines + '\n\nAdapt your tone, energy, and emotional warmth naturally to the time of day and how long it has been since you last spoke.';
}

/**
 * Loads temporal profile from Supabase iris_profiles.
 */
export async function loadTemporalProfile(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('iris_profiles')
      .select('last_interaction_at, relationship_started_at, last_photo_sent_at, user_timezone')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return {};
    return data;
  } catch {
    return {};
  }
}

/**
 * Updates last_interaction_at after each chat message.
 */
export async function touchLastInteraction(supabase, userId) {
  try {
    await supabase
      .from('iris_profiles')
      .upsert(
        { user_id: userId, last_interaction_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
  } catch (e) {
    console.log('[TEMPORAL] touchLastInteraction error:', e?.message);
  }
}

/**
 * Updates last_photo_sent_at after successful image generation.
 */
export async function touchLastPhotoSent(supabase, userId) {
  try {
    await supabase
      .from('iris_profiles')
      .upsert(
        { user_id: userId, last_photo_sent_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
  } catch (e) {
    console.log('[TEMPORAL] touchLastPhotoSent error:', e?.message);
  }
}
