# Iris production deployment

## Required frontend build variables

Set these in Vercel for Production, Preview and Development:

- `EXPO_PUBLIC_API_URL=https://iris-mobile.onrender.com`
- `EXPO_PUBLIC_SUPABASE_URL=<Supabase project URL>`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon key>`

Build command: `npm run build:web`
Output directory: `dist`

Add the deployed callback URL to Supabase Auth redirect URLs:

- `https://<production-domain>/auth/callback`
- Add the exact Vercel preview callback only while testing a preview.

## Required backend variables

Render must retain the existing provider and Supabase secrets. Recommended additions:

- `CORS_ALLOWED_ORIGINS=https://<production-domain>`
- `IRIS_DAILY_CHAT_LIMIT=500`
- `IRIS_DAILY_IMAGE_LIMIT=25`
- `LLM_TIMEOUT_MS=120000`
- `IMAGE_GENERATION_TIMEOUT_MS=240000`
- `MEDIA_DOWNLOAD_TIMEOUT_MS=90000`

Never expose service-role, OpenAI, xAI or fal keys to Expo/Vercel public variables.

## Release order

1. Confirm CI is green.
2. Apply safe schema migrations through `20260729150200_user_entitlements.sql`.
3. Merge the release PR into `main`.
4. Wait for Render `/health` to return `{ "ok": true }` from the new commit.
5. Deploy the Vercel web project and test login, chat, history and image generation.
6. Apply `20260729150300_private_media_cutover.sql`.
7. Verify `iris-photos`, `iris-ref` and `iris-temp` are private.
8. Test a new image, an old history image, reference-photo replacement and native push registration.

## Rollback

If the new backend fails before private-media cutover, revert the merge commit. The safe schema additions are backward compatible.

If private-media cutover has already happened and signed media fails, temporarily restore read access only while repairing the backend:

```sql
update storage.buckets set public = true where id in ('iris-photos', 'iris-ref', 'iris-temp');
```

Do not recreate the unrestricted public SELECT policy unless absolutely necessary. Prefer fixing signed URL generation and turning the buckets private again.

## Billing/tiers

`user_entitlements` and server-side quotas are ready for manual tiers. A payment provider can later update the entitlement row from a verified webhook. Never let the mobile/web client write tier or limit fields directly.
