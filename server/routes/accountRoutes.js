import { Router } from 'express';
import { requireUserId } from '../middleware/auth.js';
import { ensurePersona, personaDisplayName } from '../persona/personaStore.js';

const router = Router();

// Every table that stores data about one user. Text-keyed tables do not cascade from auth.users.
const USER_TABLES = Object.freeze([
  { table: 'chat_attachments', column: 'user_id' },
  { table: 'iris_proactive_runs', column: 'user_id' },
  { table: 'chat_messages', column: 'user_id' },
  { table: 'episodic_memory', column: 'user_id' },
  { table: 'shared_experiences', column: 'user_id' },
  { table: 'user_profile', column: 'user_id' },
  { table: 'iris_thoughts', column: 'user_id' },
  { table: 'iris_autobiographical_memory', column: 'user_id' },
  { table: 'iris_self_model', column: 'user_id' },
  { table: 'iris_personality_evolution', column: 'user_id' },
  { table: 'iris_relationship', column: 'user_id' },
  { table: 'iris_internal_state', column: 'user_id' },
  { table: 'iris_visual_state', column: 'user_id' },
  { table: 'iris_physical_identity', column: 'user_id' },
  { table: 'iris_activity_state', column: 'user_id' },
  { table: 'iris_scheduled_actions', column: 'user_id' },
  { table: 'iris_people_messages', column: 'user_id' },
  { table: 'iris_people_memories', column: 'user_id' },
  { table: 'iris_people_relationships', column: 'user_id' },
  { table: 'iris_people_ai_profiles', column: 'user_id' },
  { table: 'iris_people', column: 'user_id' },
  { table: 'iris_persona', column: 'user_id' },
  { table: 'scene_context', column: 'user_id', text: true },
  { table: 'scene_facts', column: 'user_id', text: true },
  { table: 'pending_scene_facts', column: 'user_id', text: true },
]);

const MEDIA_BUCKET = 'iris-photos';
const MEDIA_PREFIXES = Object.freeze(['generated', 'iris-ref', 'chat', 'ui-avatar']);
const EXPORT_LIMIT = 5000;

async function listUserMedia(admin, userId) {
  const paths = [];
  for (const prefix of MEDIA_PREFIXES) {
    const stack = [`${prefix}/${userId}`];
    while (stack.length) {
      const folder = stack.pop();
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(folder, { limit: 1000 });
      if (error) throw error;
      for (const item of data || []) {
        const path = `${folder}/${item.name}`;
        if (item.id) paths.push(path);
        else stack.push(path);
      }
    }
  }
  return paths;
}

async function deleteUserMedia(admin, userId) {
  const paths = await listUserMedia(admin, userId);
  for (let index = 0; index < paths.length; index += 1000) {
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths.slice(index, index + 1000));
    if (error) throw error;
  }
  return paths.length;
}

async function deleteUserRows(admin, userId) {
  const summary = {};
  for (const { table, column, text } of USER_TABLES) {
    const { error, count } = await admin.from(table).delete({ count: 'exact' }).eq(column, text ? String(userId) : userId);
    if (error && error.code !== '42P01') throw new Error(`${table}: ${error.message}`);
    summary[table] = count || 0;
  }
  return summary;
}

router.get('/me/persona', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const persona = await ensurePersona(req.supabaseAdmin, userId);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ status: persona?.status || null, name: personaDisplayName(persona), language: persona?.language || null });
  } catch (error) {
    console.error('[PERSONA_STATUS_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'persona_status_failed' });
  }
});

// "Forget me": removes the companion and every memory, keeping only the login account.
router.delete('/me/data', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const rows = await deleteUserRows(req.supabaseAdmin, userId);
    const media = await deleteUserMedia(req.supabaseAdmin, userId);
    console.log('[ACCOUNT_DATA_DELETED]', { userId, media });
    return res.json({ ok: true, rows, media });
  } catch (error) {
    console.error('[ACCOUNT_DATA_DELETE_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'data_delete_failed' });
  }
});

router.delete('/me/account', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    await deleteUserRows(req.supabaseAdmin, userId);
    await deleteUserMedia(req.supabaseAdmin, userId);
    const { error } = await req.supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;
    console.log('[ACCOUNT_DELETED]', { userId });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[ACCOUNT_DELETE_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'account_delete_failed' });
  }
});

router.get('/me/export', async (req, res) => {
  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const data = {};
    for (const { table, column, text } of USER_TABLES) {
      const { data: rows, error } = await req.supabaseAdmin
        .from(table)
        .select('*')
        .eq(column, text ? String(userId) : userId)
        .limit(EXPORT_LIMIT);
      if (error && error.code !== '42P01') throw new Error(`${table}: ${error.message}`);
      // Embedding vectors are derived data and not meaningful to a person reading their export.
      data[table] = (rows || []).map(({ embedding: _embedding, ...row }) => row);
    }
    data.media = await listUserMedia(req.supabaseAdmin, userId);
    res.setHeader('Content-Disposition', 'attachment; filename="iris-export.json"');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ exported_at: new Date().toISOString(), user_id: userId, data });
  } catch (error) {
    console.error('[ACCOUNT_EXPORT_ERROR]', error?.message || error);
    return res.status(500).json({ error: 'export_failed' });
  }
});

export default router;
