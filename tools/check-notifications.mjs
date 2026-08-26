import assert from 'node:assert/strict';
import fs from 'node:fs';

const webPushClient = fs.readFileSync(new URL('../app/lib/webPush.ts', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../app/components/PushBootstrap.tsx', import.meta.url), 'utf8');
const cognitionWorker = fs.readFileSync(new URL('../server/cognition/cognitionWorker.js', import.meta.url), 'utf8');
const reminderWorker = fs.readFileSync(new URL('../server/jobs/reminderWorker.js', import.meta.url), 'utf8');

assert.match(webPushClient, /restoreWebPush/, 'Granted web push permission must have an automatic recovery path.');
assert.match(webPushClient, /ensureWebPushSubscription\(accessToken, true\)/, 'Recovery must recreate a missing browser subscription.');
assert.match(webPushClient, /registerSubscriptionWithBackend/, 'Existing browser subscriptions must be refreshed on the backend.');
assert.match(bootstrap, /Platform\.OS === 'web'/, 'Push bootstrap must cover the PWA, not only native builds.');
assert.match(bootstrap, /visibilitychange/, 'PWA push must recover when Iris returns to the foreground.');
assert.match(bootstrap, /pageshow/, 'PWA push must recover after Safari restores the app page.');
assert.match(bootstrap, /AppState\.addEventListener/, 'Native push registration must refresh when the app becomes active.');
assert.match(cognitionWorker, /\.is\('disabled_at', null\)/, 'Proactive push must ignore disabled native tokens.');
assert.match(cognitionWorker, /DeviceNotRegistered/, 'Invalid Expo tokens must be retired after provider rejection.');
assert.match(reminderWorker, /\.is\('disabled_at', null\)/, 'Reminder delivery must ignore disabled native tokens.');

console.log('Notification recovery checks passed.');
