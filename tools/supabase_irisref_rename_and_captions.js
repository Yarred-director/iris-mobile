/**
 * LIVE MOVE VERSION
 * - Moves (renames) images in Supabase Storage bucket "iris-ref"
 * - Uploads caption .txt files next to each image
 *
 * Folders:
 * - face/
 * - Half/
 * - full/
 *
 * Naming output:
 * - iris_face_0001.png
 * - iris_half_0001.png
 * - iris_full_0001.png
 *
 * Caption output:
 * - irisv1, portrait photo, woman
 * - irisv1, half body photo, woman
 * - irisv1, full body photo, woman
 *
 * IMPORTANT:
 * - This is MOVE mode. Old filenames will disappear.
 * - You confirmed you have originals locally, so OK.
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUCKET = 'iris-ref';
const TOKEN = 'irisv1';
const DRY_RUN = false;

const FOLDERS = [
  { folder: 'face', kind: 'face', caption: `${TOKEN}, portrait photo, woman` },
  { folder: 'Half', kind: 'half', caption: `${TOKEN}, half body photo, woman` },
  { folder: 'full', kind: 'full', caption: `${TOKEN}, full body photo, woman` },
];

function pad4(n) {
  return String(n).padStart(4, '0');
}

function parseIndexFromName(name) {
  const base = name.split('/').pop() || name;
  const match = base.match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  return Number(match[1]);
}

function getExtLower(name) {
  const base = name.split('/').pop() || name;
  const match = base.match(/\.([a-zA-Z0-9]+)$/);
  if (!match) return null;
  return match[1].toLowerCase();
}

async function listAllFiles(prefix) {
  const out = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit, offset });

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const item of data) {
      if (!item.name) continue;
      out.push({
        name: item.name,
        fullPath: `${prefix}/${item.name}`.replace(/\/+/g, '/'),
      });
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return out;
}

async function moveFile(fromPath, toPath) {
  const { data, error } = await supabase.storage.from(BUCKET).move(fromPath, toPath);
  if (error) throw error;
  return data;
}

async function uploadText(path, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'text/plain;charset=utf-8' });

  if (error) throw error;
}

async function main() {
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Token: ${TOKEN}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE MOVE'}`);
  console.log('----------------------------------------');

  for (const cfg of FOLDERS) {
    console.log(`\nListing folder: ${cfg.folder}/`);
    const files = await listAllFiles(cfg.folder);

    const images = files.filter((f) => {
      const ext = getExtLower(f.fullPath);
      return ext && ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
    });

    if (images.length === 0) {
      console.log(`No images found in ${cfg.folder}/`);
      continue;
    }

    console.log(`Found ${images.length} images in ${cfg.folder}/`);

    const planned = images
      .map((f) => {
        const idx = parseIndexFromName(f.fullPath);
        const ext = getExtLower(f.fullPath) || 'png';
        return { ...f, idx, ext };
      })
      .sort((a, b) => {
        const ai = a.idx ?? 999999;
        const bi = b.idx ?? 999999;
        return ai - bi;
      });

    let counter = 1;

    for (const f of planned) {
      const newName = `iris_${cfg.kind}_${pad4(counter)}.${f.ext}`;
      const toPath = `${cfg.folder}/${newName}`.replace(/\/+/g, '/');

      const already = f.fullPath === toPath;

      if (!already) {
        if (DRY_RUN) {
          console.log(`WOULD MOVE: ${f.fullPath} -> ${toPath}`);
        } else {
          console.log(`MOVE: ${f.fullPath} -> ${toPath}`);
          await moveFile(f.fullPath, toPath);
        }
      } else {
        console.log(`OK: ${toPath}`);
      }

      const txtPath = toPath.replace(/\.[^.]+$/, '.txt');
      if (DRY_RUN) {
        console.log(`WOULD CREATE: ${txtPath}`);
      } else {
        await uploadText(txtPath, cfg.caption);
        console.log(`CAPTION: ${txtPath}`);
      }

      counter++;
    }

    console.log(`Finished folder: ${cfg.folder}/`);
  }

  console.log('\n✅ Done. Images renamed + captions uploaded.');
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err?.message || err);
  process.exit(1);
});