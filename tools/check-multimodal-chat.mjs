import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExactLinkDirective, extractHttpUrls } from '../server/helpers/linkAccess.js';
import { MODELS } from '../server/lib/llmModels.js';
import { toModelHistory } from '../server/memory/chatHistory.js';

const urls = extractHttpUrls('Pozri https://example.com/a?x=1 a tiež https://example.org/photo.jpg.');
assert.deepEqual(urls, ['https://example.com/a?x=1', 'https://example.org/photo.jpg']);
assert.match(buildExactLinkDirective(urls), /open every exact user-provided URL/i);
assert.match(buildExactLinkDirective(urls), /never pretend/i);

assert.equal(MODELS.grok, 'grok-4.6');

const history = toModelHistory([
  {
    role: 'user',
    content: 'Čo je na tejto fotke?',
    attachments: [{ id: 'a', image_url: 'https://signed.example/a.jpg' }],
  },
]);
assert.equal(history[0].content[0].type, 'input_text');
assert.equal(history[0].content[1].type, 'input_image');
assert.equal(history[0].content[1].image_url, 'https://signed.example/a.jpg');

const chatRoute = readFileSync(new URL('../server/routes/chat.js', import.meta.url), 'utf8');
assert.match(chatRoute, /\/chat\/attachments\/prepare/);
assert.match(chatRoute, /attachmentIds\.length === 0 && looksLikeImageRequest/);
assert.match(chatRoute, /type: 'input_image'/);
assert.match(chatRoute, /responseArgs\.tools = \[\{ type: 'web_search' \}\]/);

const attachmentService = readFileSync(new URL('../server/media/chatAttachments.js', import.meta.url), 'utf8');
assert.match(attachmentService, /TEMPORARY_ATTACHMENT_DAYS = 30/);
assert.match(attachmentService, /createSignedUploadUrl/);
assert.match(attachmentService, /\.info\(row\.path\)/);
assert.match(attachmentService, /pendingOnly = true/);

const cleanupWorker = readFileSync(new URL('../server/media/attachmentCleanupWorker.js', import.meta.url), 'utf8');
assert.match(cleanupWorker, /\.remove\(supported\.map/);
assert.match(cleanupWorker, /expires_at/);

const inputSource = readFileSync(new URL('../app/components/ChatInput.tsx', import.meta.url), 'utf8');
assert.match(inputSource, /Môj vzhľad · trvalo/);
assert.match(inputSource, /Zmizne o 30 dní/);
assert.match(inputSource, /MAX_ATTACHMENTS = 4/);

const migration = readFileSync(new URL('../supabase/migrations/20260826135358_chat_attachments.sql', import.meta.url), 'utf8');
assert.match(migration, /retention in \('temporary', 'user_appearance'\)/);
assert.match(migration, /status = 'attached' and retention = 'user_appearance' and expires_at is null/);
assert.match(migration, /enable row level security/);

console.log('multimodal chat and retention regression checks passed');
